/**
 * Job logic shared by the cron routes, the admin page and the local scripts.
 * Every run is recorded in job_runs. Provider calls are retried inside the
 * provider; a symbol that still fails is counted and logged, and the job moves on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addInto, backtestStock, emptyResult, fromRows, toRows, type BacktestResult } from "../backtest";
import { analyseQuarters, eventScore, fiscalLabel, postResultReaction } from "../events";
import { dayDiff } from "../format";
import { isAfterClose, isMarketOpen, istParts, todayIST } from "../market";
import { getProvider } from "../providers";
import { entryPlan, heldBreakout } from "../entry";
import { aiEnabled } from "../settings";
import { runMacroDaily } from "./macro";
import { fetchMarketNews } from "./news";
import { openShadowTrades, processPaper } from "./paper";
import { momentum12, percentileRank, returnOver } from "../factors";
import { computeSeries, snapshotAt, technicalScore } from "../signals";
import { adminDb } from "../supabase/admin";
import type { Candle, SignalKind } from "../types";
import { computeVerdict, type SignalOdds } from "../verdict";

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

  // verdicts: combine the technical read with results, fundamentals and the measured signal odds
  const { data: ctx } = await db
    .from("stock_latest")
    .select("sector,event,roe,debt_to_equity,pe,next_result_date,next_result_is_estimate")
    .eq("symbol", symbol)
    .maybeSingle();
  // momentum rank against every tracked stock's latest stored value, and the market regime
  const closes = candles.map((x) => x.close);
  const mom12 = momentum12(closes, n - 1);
  const market = await marketContext(db);
  const { data: uni } = await db.from("stock_latest").select("symbol,mom12").eq("kind", "equity").not("mom12", "is", null).limit(3000);
  const others = (uni ?? []).filter((x) => x.symbol !== symbol).map((x) => Number(x.mom12));
  const momRank = mom12 == null ? null : percentileRank(mom12, [...others, mom12]);
  const stock126 = returnOver(closes, n - 1, 126);
  const rs6 = stock126 != null && market?.ret126 != null ? Math.round((stock126 - market.ret126) * 100) / 100 : null;
  const { data: ext } = await db
    .from("external_signals")
    .select("score,run_at")
    .eq("symbol", symbol)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // With the paid AI jobs switched off there is no external score: old reads stay on the page, dated, but are not scored.
  // When they are on, a read older than 45 days no longer counts towards the verdict.
  const external = aiEnabled() && ext?.score != null && Date.now() - new Date(ext.run_at).getTime() < 45 * 86400000 ? Number(ext.score) : null;
  const active: SignalKind | null = last.sig_bounce ? "Bounce" : last.sig_breakdown ? "Breakdown" : last.sig_trend ? "Trend" : null;
  const odds = active ? await signalOdds(db, symbol, ctx?.sector ?? null, active) : null;
  const num = (x: unknown) => (x == null ? null : Number(x));
  const today = todayIST();
  const daysToResult = ctx?.next_result_date && ctx.next_result_date >= today ? dayDiff(today, ctx.next_result_date) : null;
  const v = computeVerdict({
    close: last.close,
    technical: t.score,
    bounce: last.sig_bounce,
    trend: last.sig_trend,
    breakdown: last.sig_breakdown,
    rewardRisk: t.rewardRisk,
    atrRisk: t.risk,
    sma50: last.sma50,
    sma200: last.sma200,
    distHi52: last.dist_hi52_pct,
    return1y: n > 251 ? (candles[n - 1].close / candles[n - 251].close - 1) * 100 : null,
    momRank,
    rs6,
    marketUp: market?.up ?? null,
    externalOff: !aiEnabled(),
    event: num(ctx?.event),
    external,
    roe: num(ctx?.roe),
    debtToEquity: num(ctx?.debt_to_equity),
    pe: num(ctx?.pe),
    isFinancial: /financ|bank/i.test(ctx?.sector ?? ""),
    daysToResult,
    resultIsEstimate: Boolean(ctx?.next_result_is_estimate),
    odds,
  });

  // entry rating: where the price sits relative to a sensible entry for the short-term view
  const plan = entryPlan({
    close: last.close,
    sma20: series.sma20[n - 1],
    sma20Ago: n > 6 ? series.sma20[n - 6] : null,
    atr: series.atr[n - 1],
    rsi: series.rsi[n - 1],
    uptrend: last.sig_trend,
    favourable: v.shortVerdict === "Favourable",
    freshBreakout: heldBreakout(candles, series.volRatio, n - 1, 3),
    recentBreakout: heldBreakout(candles, series.volRatio, n - 1, 10),
    breakdown: last.sig_breakdown,
    target: t.target,
    stop: t.stop,
  });
  if (market?.up === false && plan.rating !== "No setup") {
    plan.note += " Nifty 50 is below its 200 DMA: these setups did worse in that condition in testing.";
  }

  const { error: e2 } = await db.from("scores").upsert(
    {
      symbol,
      date: last.date,
      technical: t.score,
      technical_reasons: t.reasons,
      event: num(ctx?.event),
      external,
      overall: v.overall,
      short_verdict: v.shortVerdict,
      long_verdict: v.longVerdict,
      risk: v.risk,
      target: t.target,
      stop: t.stop,
      reward_risk: t.rewardRisk,
      mom12: mom12 == null ? null : Math.round(mom12 * 10000) / 10000,
      mom_rank: momRank,
      rs6,
      market_up: market?.up ?? null,
      entry: plan,
      verdict_reasons: {
        short: v.shortReasons,
        long: v.longReasons,
        shortScore: v.shortScore,
        longScore: v.longScore,
        odds: v.odds,
      },
      computed_at: now,
    },
    { onConflict: "symbol,date" },
  );
  if (e2) throw new Error(`scores upsert: ${e2.message}`);
}

type MarketContext = { up: boolean; ret126: number | null; date: string };
let marketCache: { at: number; value: MarketContext | null } | null = null;

/** Nifty 50 against its 200 DMA, and its 6 month return. Cached for five minutes within a process. */
export async function marketContext(db: SupabaseClient): Promise<MarketContext | null> {
  if (marketCache && Date.now() - marketCache.at < 5 * 60000) return marketCache.value;
  const { data } = await db.from("candles_daily").select("date,close").eq("symbol", "NIFTY50").order("date", { ascending: false }).limit(210);
  const rows = (data ?? []).map((r) => ({ date: r.date as string, close: Number(r.close) })).reverse();
  let value: MarketContext | null = null;
  if (rows.length >= 200) {
    const closes = rows.map((r) => r.close);
    const last = closes.length - 1;
    const avg200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    value = { up: closes[last] > avg200, ret126: returnOver(closes, last, 126), date: rows[last].date };
  }
  marketCache = { at: Date.now(), value };
  return value;
}

/**
 * Measured 20-session odds for a signal. Uses this stock's own history when it
 * has at least 8 past cases, otherwise its sector, otherwise all tracked stocks.
 */
async function signalOdds(db: SupabaseClient, symbol: string, sector: string | null, signal: SignalKind): Promise<SignalOdds | null> {
  const scopes: ["stock" | "sector" | "all", string | null][] = [
    ["stock", symbol],
    ["sector", sector],
    ["all", "ALL"],
  ];
  let fallback: SignalOdds | null = null;
  for (const [scope, key] of scopes) {
    if (!key) continue;
    const { data } = await db
      .from("signal_backtests")
      .select("signal,samples,hit_rate,avg_return")
      .eq("scope", scope)
      .eq("scope_key", key)
      .eq("horizon_days", 20)
      .in("signal", [signal, "Baseline"]);
    const row = data?.find((r) => r.signal === signal);
    if (!row || row.hit_rate == null) continue;
    const base = data?.find((r) => r.signal === "Baseline");
    const odds: SignalOdds = {
      signal,
      horizon: 20,
      hitRate: Number(row.hit_rate),
      avgReturn: Number(row.avg_return ?? 0),
      samples: row.samples,
      scope,
      baseline: base?.hit_rate == null ? null : Number(base.hit_rate),
    };
    if (odds.samples >= 8) return odds;
    fallback ??= odds;
  }
  return fallback;
}

/** Recompute indicators, scores and verdicts for every backfilled stock. */
export async function recomputeAll(onProgress?: (symbol: string, err?: string) => void): Promise<{ ok: number; failed: number }> {
  const db = adminDb();
  const { data } = await db.from("stocks").select("symbol").eq("kind", "equity").eq("backfill_status", "done").order("symbol");
  let ok = 0;
  let failed = 0;
  await pool(data ?? [], 5, async (s) => {
    try {
      await recomputeSymbol(db, s.symbol, 1);
      ok++;
      onProgress?.(s.symbol);
    } catch (e) {
      failed++;
      onProgress?.(s.symbol, msg(e));
    }
  });
  return { ok, failed };
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
        day_open: q.dayOpen,
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
    // paper trades fill and exit on fresh quotes; a failure here must not fail the quote job
    let paper: object | undefined;
    try {
      paper = await processPaper("quotes", db);
    } catch (e) {
      paper = { error: msg(e) };
    }
    await finishJob(db, id, { status, ok: rows.length, failures, detail: { paper } });
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
    if (remaining === 0 && todo.length > 0) {
      await refreshQuotes({ force: true });
      // on a finished session: paper exits from the day's bars, then new shadow trades for tomorrow's open
      if (final) {
        try {
          // evening pass over the market feeds (they hold only about a day of headlines), then the regime label,
          // so trades opened tonight record it
          await fetchMarketNews(db).catch(() => null);
          await runMacroDaily();
          const paper = await processPaper("eod", db);
          const shadow = await openShadowTrades(db);
          await db.from("job_runs").insert({ job: "paper", status: "ok", finished_at: new Date().toISOString(), ok_count: paper.filled + paper.closed + shadow.st.length + shadow.lt.length + shadow.limits.length, fail_count: 0, detail: { ...paper, shadowST: shadow.st, shadowLimits: shadow.limits, shadowLT: shadow.lt } });
        } catch (e) {
          await db.from("job_runs").insert({ job: "paper", status: "error", finished_at: new Date().toISOString(), error: msg(e) });
        }
      }
    }
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

// ───────────────────────── results and fundamentals (daily) ─────────────────────────

/** Fetch result dates, quarterly results and ratios for one stock, then score it. */
export async function refreshFundamentalsFor(db: SupabaseClient, symbol: string, providerSymbol: string): Promise<void> {
  const provider = getProvider();
  const [earn, fund] = await Promise.all([provider.getEarnings(providerSymbol), provider.getFundamentals(providerSymbol)]);

  // candles around the reported results, to measure how the price reacted
  const { data: cd, error: ce } = await db
    .from("candles_daily")
    .select("date,open,high,low,close,volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(520);
  if (ce) throw new Error(`candles read: ${ce.message}`);
  const candles: Candle[] = (cd ?? [])
    .map((r) => ({ time: r.date, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume }))
    .reverse();

  const now = new Date().toISOString();
  const rows = earn.quarters.map((q) => {
    const react = q.reportedAt ? postResultReaction(candles, q.reportedAt) : { d1: null, d5: null };
    return {
      symbol,
      period_end: q.periodEnd,
      fiscal_label: fiscalLabel(q.periodEnd, fund.fiscalYearEndMonth),
      result_date: q.reportedAt ? istParts(new Date(q.reportedAt)).date : null,
      reported_at: q.reportedAt,
      revenue: q.revenue,
      net_profit: q.netProfit,
      eps: q.eps,
      eps_estimate: q.epsEstimate,
      reaction_1d: react.d1,
      reaction_5d: react.d5,
      source: earn.source,
      fetched_at: now,
    };
  });
  if (rows.length) {
    const { error } = await db.from("earnings").upsert(rows, { onConflict: "symbol,period_end" });
    if (error) throw new Error(`earnings upsert: ${error.message}`);
  }

  // score from everything stored, so quarters collected on earlier runs still count
  const { data: all, error: ae } = await db
    .from("earnings")
    .select("period_end,revenue,net_profit,eps,eps_estimate,reported_at,reaction_1d,reaction_5d")
    .eq("symbol", symbol)
    .order("period_end", { ascending: true })
    .limit(40);
  if (ae) throw new Error(`earnings read: ${ae.message}`);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const quarters = analyseQuarters(
    (all ?? []).map((q) => ({
      periodEnd: q.period_end,
      revenue: num(q.revenue),
      netProfit: num(q.net_profit),
      eps: num(q.eps),
      epsEstimate: num(q.eps_estimate),
      reportedAt: q.reported_at,
      reaction1d: num(q.reaction_1d),
      reaction5d: num(q.reaction_5d),
    })),
    fund.fiscalYearEndMonth,
  ).slice(-8);
  const ev = eventScore(quarters);

  const { error: fe } = await db.from("fundamentals").upsert(
    {
      symbol,
      next_result_date: earn.nextResultDate,
      next_result_is_estimate: earn.nextResultDate ? earn.nextIsEstimate : false,
      next_result_source: earn.nextResultDate ? earn.source : null,
      pe: fund.pe,
      roe: fund.roe,
      debt_to_equity: fund.debtToEquity,
      profit_margin: fund.profitMargin,
      fiscal_year_end_month: fund.fiscalYearEndMonth,
      industry: fund.industry,
      website: fund.website,
      event_score: ev.score,
      event_reasons: ev.reasons,
      error: null,
      fetched_at: now,
    },
    { onConflict: "symbol" },
  );
  if (fe) throw new Error(`fundamentals upsert: ${fe.message}`);
  // the verdict depends on the event score and result date, so refresh it now
  await recomputeSymbol(db, symbol, 1);
}

/**
 * Refresh results and fundamentals for stocks not updated in the last 20 hours,
 * oldest first, within a time budget. Call repeatedly until nothing remains.
 */
export async function refreshFundamentals(
  opts: { force?: boolean; budgetMs?: number; symbols?: string[]; retryErrors?: boolean; onProgress?: (s: string, err?: string) => void } = {},
): Promise<JobResult> {
  const db = adminDb();
  const id = await startJob(db, "fundamentals");
  const started = Date.now();
  const budget = opts.budgetMs ?? 45000;
  try {
    const [{ data: stocks, error }, { data: have }] = await Promise.all([
      db.from("stocks").select("symbol,provider_symbol").eq("kind", "equity").eq("backfill_status", "done").order("symbol"),
      db.from("fundamentals").select("symbol,fetched_at,error"),
    ]);
    if (error) throw new Error(error.message);
    const seen = new Map((have ?? []).map((f) => [f.symbol as string, f.fetched_at as string]));
    const cutoff = new Date(Date.now() - 20 * 3600000).toISOString();
    const errored = new Set((have ?? []).filter((f) => f.error).map((f) => f.symbol as string));
    const todo = (stocks ?? [])
      .filter((s) => !opts.symbols || opts.symbols.includes(s.symbol))
      .filter((s) => opts.force || opts.symbols || !seen.has(s.symbol) || seen.get(s.symbol)! < cutoff || (opts.retryErrors && errored.has(s.symbol)))
      .sort((a, b) => (seen.get(a.symbol) ?? "").localeCompare(seen.get(b.symbol) ?? ""));
    if (!todo.length) {
      const reason = "every stock was refreshed in the last 20 hours";
      await finishJob(db, id, { status: "skipped", detail: { reason } });
      return { status: "skipped", ok: 0, failed: 0, detail: { reason } };
    }

    let ok = 0;
    const failures: Failure[] = [];
    await pool(
      todo,
      3,
      async (s) => {
        try {
          await refreshFundamentalsFor(db, s.symbol, s.provider_symbol);
          ok++;
          opts.onProgress?.(s.symbol);
        } catch (e) {
          failures.push({ symbol: s.symbol, error: msg(e) });
          opts.onProgress?.(s.symbol, msg(e));
          // record the failure and move it to the back of the queue; earlier values are kept
          await db.from("fundamentals").upsert({ symbol: s.symbol, error: msg(e), fetched_at: new Date().toISOString() }, { onConflict: "symbol" });
        }
      },
      () => Date.now() - started > budget,
    );
    const remaining = todo.length - ok - failures.length;
    const status = failures.length || remaining > 0 ? "partial" : "ok";
    const detail = { remaining, total: todo.length };
    await finishJob(db, id, { status, ok, failures, detail });
    return { status, ok, failed: failures.length, detail };
  } catch (e) {
    await finishJob(db, id, { status: "error", error: msg(e) });
    return { status: "error", ok: 0, failed: 0, error: msg(e) };
  }
}

// ───────────────────────── signal backtest (weekly) ─────────────────────────

async function allCandles(db: SupabaseClient, symbol: string): Promise<Candle[]> {
  const out: Candle[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    const { data, error } = await db
      .from("candles_daily")
      .select("date,open,high,low,close,volume")
      .eq("symbol", symbol)
      .order("date", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`candles read: ${error.message}`);
    for (const r of data ?? []) out.push({ time: r.date, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume });
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Backtest every signal on each stock's full history, then pool the results by
 * sector and across all stocks. Stocks tested in the last 6 days are skipped,
 * so the job can run in time-boxed batches until nothing remains.
 */
export async function runBacktest(
  opts: { force?: boolean; budgetMs?: number; onProgress?: (s: string, err?: string) => void } = {},
): Promise<JobResult> {
  const db = adminDb();
  const id = await startJob(db, "backtest");
  const started = Date.now();
  const budget = opts.budgetMs ?? 45000;
  try {
    const [{ data: stocks, error }, { data: done }] = await Promise.all([
      db.from("stocks").select("symbol,sector").eq("kind", "equity").eq("backfill_status", "done").order("symbol"),
      db.from("signal_backtests").select("scope_key,computed_at").eq("scope", "stock").eq("signal", "Baseline").eq("horizon_days", 5).limit(5000),
    ]);
    if (error) throw new Error(error.message);
    const seen = new Map((done ?? []).map((r) => [r.scope_key as string, r.computed_at as string]));
    const cutoff = new Date(Date.now() - 6 * 86400000).toISOString();
    const todo = (stocks ?? []).filter((s) => opts.force || !seen.has(s.symbol) || seen.get(s.symbol)! < cutoff);
    if (!todo.length) {
      const reason = "every stock was backtested in the last 6 days";
      await finishJob(db, id, { status: "skipped", detail: { reason } });
      return { status: "skipped", ok: 0, failed: 0, detail: { reason } };
    }

    let ok = 0;
    const failures: Failure[] = [];
    await pool(
      todo,
      4,
      async (s) => {
        try {
          const rows = toRows("stock", s.symbol, backtestStock(await allCandles(db, s.symbol)));
          const now = new Date().toISOString();
          const { error: e } = await db
            .from("signal_backtests")
            .upsert(rows.map((r) => ({ ...r, computed_at: now })), { onConflict: "scope,scope_key,signal,horizon_days" });
          if (e) throw new Error(`backtest upsert: ${e.message}`);
          ok++;
          opts.onProgress?.(s.symbol);
        } catch (e) {
          failures.push({ symbol: s.symbol, error: msg(e) });
          opts.onProgress?.(s.symbol, msg(e));
        }
      },
      () => Date.now() - started > budget,
    );
    const remaining = todo.length - ok - failures.length;

    // pool per-stock results into sectors and the whole universe once every stock is in
    if (remaining === 0) {
      const sectorOf = new Map((stocks ?? []).map((s) => [s.symbol as string, (s.sector as string | null) ?? "Other"]));
      const bySector = new Map<string, BacktestResult>();
      const all = emptyResult();
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error: e } = await db
          .from("signal_backtests")
          .select("scope_key,signal,horizon_days,samples,hit_rate,avg_return")
          .eq("scope", "stock")
          .order("scope_key")
          .order("signal")
          .order("horizon_days")
          .range(from, from + 999);
        if (e) throw new Error(`backtest read: ${e.message}`);
        for (const r of data ?? []) {
          const sector = sectorOf.get(r.scope_key);
          if (!sector) continue; // stock no longer tracked
          const one = fromRows([r as never]);
          if (!bySector.has(sector)) bySector.set(sector, emptyResult());
          addInto(bySector.get(sector)!, one);
          addInto(all, one);
        }
        if (!data || data.length < 1000) break;
      }
      const now = new Date().toISOString();
      const pooled = [...[...bySector].flatMap(([k, r]) => toRows("sector", k, r)), ...toRows("all", "ALL", all)];
      const { error: e } = await db
        .from("signal_backtests")
        .upsert(pooled.map((r) => ({ ...r, computed_at: now })), { onConflict: "scope,scope_key,signal,horizon_days" });
      if (e) throw new Error(`pooled upsert: ${e.message}`);
    }

    const status = failures.length || remaining > 0 ? "partial" : "ok";
    const detail = { remaining, total: todo.length };
    await finishJob(db, id, { status, ok, failures, detail });
    return { status, ok, failed: failures.length, detail };
  } catch (e) {
    await finishJob(db, id, { status: "error", error: msg(e) });
    return { status: "error", ok: 0, failed: 0, error: msg(e) };
  }
}
