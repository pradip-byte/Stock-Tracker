/**
 * Job logic shared by the cron routes, the admin page and the local scripts.
 * Every run is recorded in job_runs. Provider calls are retried inside the
 * provider; a symbol that still fails is counted and logged, and the job moves on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAfterClose, isMarketOpen, istParts, todayIST } from "../market";
import { getProvider } from "../providers";
import { computeSeries, snapshotAt, technicalScore } from "../signals";
import { adminDb } from "../supabase/admin";
import type { Candle } from "../types";

type StockRef = { symbol: string; provider_symbol: string; kind: string; last_candle: string | null };
type Failure = { symbol: string; error: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ───────────────────────── job log ─────────────────────────

async function startJob(db: SupabaseClient, job: string): Promise<number | null> {
  const { data } = await db.from("job_runs").insert({ job, status: "running" }).select("id").single();
  return data?.id ?? null;
}

async function finishJob(
  db: SupabaseClient,
  id: number | null,
  r: { status: "ok" | "partial" | "error" | "skipped"; ok?: number; failures?: Failure[]; detail?: object; error?: string },
) {
  if (id == null) return;
  await db
    .from("job_runs")
    .update({
      status: r.status,
      finished_at: new Date().toISOString(),
      ok_count: r.ok ?? 0,
      fail_count: r.failures?.length ?? 0,
      detail: { ...(r.detail ?? {}), failures: r.failures?.slice(0, 40) ?? [] },
      error: r.error ?? null,
    })
    .eq("id", id);
}

export type JobResult = { status: string; ok: number; failed: number; detail?: object; error?: string };

// ───────────────────────── helpers ─────────────────────────

async function upsertCandles(db: SupabaseClient, symbol: string, candles: Candle[]) {
  for (let i = 0; i < candles.length; i += 500) {
    const rows = candles.slice(i, i + 500).map((c) => ({
      symbol,
      date: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const { error } = await db.from("candles_daily").upsert(rows, { onConflict: "symbol,date" });
    if (error) throw new Error(`candles upsert: ${error.message}`);
  }
}

/** Today's bar is still forming until the close has settled, so it is not stored before then. */
function dropUnfinishedBar(candles: Candle[]): Candle[] {
  const today = todayIST();
  const p = istParts();
  const weekday = p.dow >= 1 && p.dow <= 5;
  if (weekday && !isAfterClose() && candles.length && candles[candles.length - 1].time === today) {
    return candles.slice(0, -1);
  }
  return candles;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>, shouldStop?: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length && !shouldStop?.()) {
        const item = items[next++];
        await fn(item);
      }
    }),
  );
}

// ───────────────────────── indicators + score ─────────────────────────

/** Recompute indicators for the last `days` sessions and the technical score for the latest one. */
export async function recomputeSymbol(db: SupabaseClient, symbol: string, days = 3): Promise<void> {
  const { data, error } = await db
    .from("candles_daily")
    .select("date,open,high,low,close,volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(560);
  if (error) throw new Error(`candles read: ${error.message}`);
  const candles: Candle[] = (data ?? [])
    .map((r) => ({ time: r.date, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume }))
    .reverse();
  if (candles.length < 30) return;

  const series = computeSeries(candles);
  const n = candles.length;
  const first = Math.max(21, n - days);
  const snaps = [];
  for (let i = first; i < n; i++) snaps.push(snapshotAt(candles, series, i));
  const now = new Date().toISOString();
  const { error: e1 } = await db
    .from("indicators_daily")
    .upsert(snaps.map((s) => ({ symbol, ...s, computed_at: now })), { onConflict: "symbol,date" });
  if (e1) throw new Error(`indicators upsert: ${e1.message}`);

  const last = snaps[snaps.length - 1];
  const t = technicalScore(last, series.macdHist[n - 2], candles[n - 1].close >= candles[n - 2].close);
  const { error: e2 } = await db.from("scores").upsert(
    {
      symbol,
      date: last.date,
      technical: t.score,
      technical_reasons: t.reasons,
      risk: t.risk,
      target: t.target,
      stop: t.stop,
      reward_risk: t.rewardRisk,
      computed_at: now,
    },
    { onConflict: "symbol,date" },
  );
  if (e2) throw new Error(`scores upsert: ${e2.message}`);
}

// ───────────────────────── backfill ─────────────────────────

/** Pull `years` of daily candles for one stock, then compute its indicators and score. */
export async function backfillSymbol(db: SupabaseClient, stock: StockRef, years = 10): Promise<number> {
  await db.from("stocks").update({ backfill_status: "running", backfill_error: null }).eq("symbol", stock.symbol);
  try {
    const from = new Date();
    from.setUTCFullYear(from.getUTCFullYear() - years);
    const candles = dropUnfinishedBar(await getProvider().getDailyHistory(stock.provider_symbol, from));
    if (!candles.length) throw new Error("provider returned no candles");
    await upsertCandles(db, stock.symbol, candles);
    if (stock.kind === "equity") await recomputeSymbol(db, stock.symbol, 60);
    await db
      .from("stocks")
      .update({
        backfill_status: "done",
        backfill_error: null,
        first_candle: candles[0].time,
        last_candle: candles[candles.length - 1].time,
      })
      .eq("symbol", stock.symbol);
    return candles.length;
  } catch (e) {
    await db.from("stocks").update({ backfill_status: "error", backfill_error: msg(e) }).eq("symbol", stock.symbol);
    throw e;
  }
}

// ───────────────────────── quotes (every 15 min in market hours) ─────────────────────────

export async function refreshQuotes(opts: { force?: boolean } = {}): Promise<JobResult> {
  const db = adminDb();
  const id = await startJob(db, "quotes");
  try {
    if (!opts.force && !isMarketOpen()) {
      await finishJob(db, id, { status: "skipped", detail: { reason: "outside NSE hours" } });
      return { status: "skipped", ok: 0, failed: 0, detail: { reason: "outside NSE hours" } };
    }
    const { data: stocks, error } = await db.from("stocks").select("symbol,provider_symbol");
    if (error) throw new Error(error.message);
    const bySym = new Map((stocks ?? []).map((s) => [s.provider_symbol as string, s.symbol as string]));
    const quotes = await getProvider().getQuotes([...bySym.keys()]);
    const now = new Date().toISOString();
    const rows = quotes
      .filter((q) => bySym.has(q.providerSymbol))
      .map((q) => ({
        symbol: bySym.get(q.providerSymbol)!,
        price: q.price,
        prev_close: q.prevClose,
        day_high: q.dayHigh,
        day_low: q.dayLow,
        volume: q.volume,
        market_time: q.marketTime,
        fetched_at: now,
      }));
    if (rows.length) {
      const { error: e } = await db.from("quotes_latest").upsert(rows, { onConflict: "symbol" });
      if (e) throw new Error(`quotes upsert: ${e.message}`);
    }
    const got = new Set(rows.map((r) => r.symbol));
    const failures: Failure[] = [...bySym.values()]
      .filter((s) => !got.has(s))
      .map((symbol) => ({ symbol, error: "no quote returned" }));
    const status = failures.length ? (rows.length ? "partial" : "error") : "ok";
    await finishJob(db, id, { status, ok: rows.length, failures });
    return { status, ok: rows.length, failed: failures.length };
  } catch (e) {
    await finishJob(db, id, { status: "error", error: msg(e) });
    return { status: "error", ok: 0, failed: 0, error: msg(e) };
  }
}

// ───────────────────────── end of day ─────────────────────────

/**
 * Append the latest candles and recompute indicators and scores.
 * Works through stocks that have not had today's run yet and stops when the
 * time budget is used up, so it is safe to call repeatedly until it reports
 * nothing remaining.
 */
export async function runEod(opts: { force?: boolean; budgetMs?: number } = {}): Promise<JobResult> {
  const db = adminDb();
  const id = await startJob(db, "eod");
  const started = Date.now();
  const budget = opts.budgetMs ?? 45000;
  try {
    const p = istParts();
    const weekday = p.dow >= 1 && p.dow <= 5;
    if (!opts.force && !(weekday && isAfterClose())) {
      const reason = weekday ? "before the close has settled (15:45 IST)" : "weekend";
      await finishJob(db, id, { status: "skipped", detail: { reason } });
      return { status: "skipped", ok: 0, failed: 0, detail: { reason } };
    }
    const today = p.date;
    // a forced run before the close must not mark stocks as done for the day
    const final = !weekday || isAfterClose();
    const { data, error } = await db
      .from("stocks")
      .select("symbol,provider_symbol,kind,last_candle,last_eod_run")
      .eq("backfill_status", "done")
      .or(`last_eod_run.is.null,last_eod_run.lt.${today}`)
      .order("symbol");
    if (error) throw new Error(error.message);
    const todo = (data ?? []) as (StockRef & { last_eod_run: string | null })[];
    if (!todo.length) {
      const reason = "every stock already has today's run";
      await finishJob(db, id, { status: "skipped", detail: { reason } });
      return { status: "skipped", ok: 0, failed: 0, detail: { reason } };
    }

    let ok = 0;
    const failures: Failure[] = [];
    const outOfTime = () => Date.now() - started > budget;
    await pool(
      todo,
      5,
      async (s) => {
        try {
          const from = new Date(`${s.last_candle ?? today}T00:00:00Z`);
          from.setUTCDate(from.getUTCDate() - 7); // re-pull a week to absorb late corrections
          const candles = dropUnfinishedBar(await getProvider().getDailyHistory(s.provider_symbol, from));
          if (candles.length) {
            await upsertCandles(db, s.symbol, candles);
            if (s.kind === "equity") await recomputeSymbol(db, s.symbol, 3);
          }
          await db
            .from("stocks")
            .update({ ...(final ? { last_eod_run: today } : {}), ...(candles.length ? { last_candle: candles[candles.length - 1].time } : {}) })
            .eq("symbol", s.symbol);
          ok++;
        } catch (e) {
          failures.push({ symbol: s.symbol, error: msg(e) });
        }
      },
      outOfTime,
    );

    const remaining = todo.length - ok - failures.length;
    const status = failures.length || remaining > 0 ? "partial" : "ok";
    const detail = { remaining, total: todo.length };
    await finishJob(db, id, { status, ok, failures, detail });
    // once every stock is done, record the closing quotes too
    if (remaining === 0 && todo.length > 0) await refreshQuotes({ force: true });
    return { status, ok, failed: failures.length, detail };
  } catch (e) {
    await finishJob(db, id, { status: "error", error: msg(e) });
    return { status: "error", ok: 0, failed: 0, error: msg(e) };
  }
}

// ───────────────────────── add a stock from the UI ─────────────────────────

export async function addStock(rawSymbol: string): Promise<{ ok: boolean; error?: string; symbol?: string }> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/\.NS$/, "");
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return { ok: false, error: "That does not look like an NSE symbol." };
  const db = adminDb();
  const provider = getProvider();
  const providerSymbol = provider.toProviderSymbol(symbol);
  const { data: existing } = await db.from("stocks").select("symbol").eq("symbol", symbol).maybeSingle();
  if (existing) return { ok: false, error: `${symbol} is already tracked.` };

  const id = await startJob(db, `add:${symbol}`);
  try {
    const [quote] = await provider.getQuotes([providerSymbol]);
    if (!quote) throw new Error(`${symbol} was not found on NSE via ${provider.name}.`);
    let sector: string | null = null;
    try {
      sector = (await provider.getFundamentals(providerSymbol)).sector;
    } catch {
      // sector is optional; leave it unknown rather than guess
    }
    const { error } = await db.from("stocks").insert({
      symbol,
      name: quote.name ?? symbol,
      sector,
      provider_symbol: providerSymbol,
      source: "user",
    });
    if (error) throw new Error(error.message);
    await db.from("quotes_latest").upsert({
      symbol,
      price: quote.price,
      prev_close: quote.prevClose,
      day_high: quote.dayHigh,
      day_low: quote.dayLow,
      volume: quote.volume,
      market_time: quote.marketTime,
    });
    const bars = await backfillSymbol(db, { symbol, provider_symbol: providerSymbol, kind: "equity", last_candle: null });
    await finishJob(db, id, { status: "ok", ok: 1, detail: { bars } });
    return { ok: true, symbol };
  } catch (e) {
    await finishJob(db, id, { status: "error", error: msg(e) });
    return { ok: false, error: msg(e), symbol };
  }
}
