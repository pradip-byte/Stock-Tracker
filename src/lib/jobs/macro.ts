/**
 * Macro view jobs.
 *
 * runMacroDaily: pulls the daily closes of Brent, USD/INR, S&P 500 and the US
 *   10-year yield, computes breadth from our own stocks, stores the session's
 *   macro row with the regime label and its inputs, then fills in what the
 *   market actually did after each logged event (1, 5 and 20 sessions).
 *
 * runMacroNote: the weekly AI note. Same model and source rules as the external
 *   job, at most 3 searches. Each event needs a dated source from the last 21
 *   days, and names the sectors it helps or hurts from our own sector list.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCost } from "../ai/pricing";
import { BLOCKED_DOMAINS, aiConfigured, runResearch, verifiedUrl, type SearchDomains } from "../ai/research";
import { MACRO_CATEGORIES, MACRO_SERIES, regimeOf, type SectorEffect, type SectorMove } from "../macro";
import { todayIST } from "../market";
import { getProvider } from "../providers";
import { adminDb } from "../supabase/admin";
import type { JobResult } from "./core";
import { RULES, dedupe, finishRun, recentDate, startRun } from "./external";

const NIFTY = "NIFTY50";
const VIX = "INDIAVIX";
export const MACRO_MAX_SEARCHES = 3;
const EVENT_MAX_AGE_DAYS = 21;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function job(db: SupabaseClient, name: string) {
  const { data } = await db.from("job_runs").insert({ job: name, status: "running" }).select("id").single();
  const id = (data?.id as number | undefined) ?? null;
  return async (status: string, ok: number, failures: { symbol: string; error: string }[], detail: object, error?: string): Promise<JobResult> => {
    if (id != null) {
      await db
        .from("job_runs")
        .update({ status, finished_at: new Date().toISOString(), ok_count: ok, fail_count: failures.length, detail: { ...detail, failures }, error: error ?? null })
        .eq("id", id);
    }
    return { status, ok, failed: failures.length, detail, error };
  };
}

async function closes(db: SupabaseClient, symbol: string, limit: number, upTo?: string): Promise<{ date: string; close: number }[]> {
  let q = db.from("candles_daily").select("date,close").eq("symbol", symbol).order("date", { ascending: false }).limit(limit);
  if (upTo) q = q.lte("date", upTo);
  const { data } = await q;
  return (data ?? []).map((r) => ({ date: r.date as string, close: Number(r.close) })).reverse();
}

// ───────────────────────── daily numbers and regime ─────────────────────────

export async function runMacroDaily(opts: { years?: number } = {}): Promise<JobResult> {
  const db = adminDb();
  const finish = await job(db, "macro");
  const failures: { symbol: string; error: string }[] = [];
  try {
    // 1. outside series, appended to their stored history
    let stored = 0;
    for (const s of MACRO_SERIES) {
      try {
        const { data: last } = await db.from("macro_series").select("date").eq("series", s.id).order("date", { ascending: false }).limit(1).maybeSingle();
        const from = last?.date ? new Date(new Date(`${last.date}T00:00:00Z`).getTime() - 10 * 86400000) : new Date(Date.now() - (opts.years ?? 10) * 365.25 * 86400000);
        const bars = await getProvider().getDailyHistory(s.provider, from);
        // today's bar for a market that is still trading is not final: keep only completed days
        const today = todayIST();
        const rows = bars.filter((b) => b.time < today && b.close > 0).map((b) => ({ series: s.id, date: b.time, close: b.close }));
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await db.from("macro_series").upsert(rows.slice(i, i + 500), { onConflict: "series,date" });
          if (error) throw new Error(error.message);
        }
        stored += rows.length;
      } catch (e) {
        failures.push({ symbol: s.id, error: msg(e) });
      }
    }

    // 2. the session's macro row
    const nifty = await closes(db, NIFTY, 210);
    if (nifty.length < 200) return await finish("error", 0, failures, {}, "Not enough Nifty 50 history for the 200 DMA");
    const date = nifty[nifty.length - 1].date;
    const niftyClose = nifty[nifty.length - 1].close;
    const sma200 = nifty.slice(-200).reduce((a, b) => a + b.close, 0) / 200;
    const vix = await closes(db, VIX, 25, date);
    const vixNow = vix.length ? vix[vix.length - 1].close : null;
    const vix20 = vix.length >= 20 ? vix.slice(-20).reduce((a, b) => a + b.close, 0) / 20 : null;

    const latest: Record<string, number | null> = {};
    for (const s of MACRO_SERIES) {
      const { data } = await db.from("macro_series").select("close").eq("series", s.id).lte("date", date).order("date", { ascending: false }).limit(1).maybeSingle();
      latest[s.id] = data ? Number(data.close) : null;
    }

    // breadth from stocks whose indicators are for this session
    const { data: rows } = await db.from("stock_latest").select("ind_date,ind_close,sma50,sma200").eq("kind", "equity").limit(3000);
    const live = (rows ?? []).filter((r) => r.ind_date === date && r.ind_close != null);
    const with50 = live.filter((r) => r.sma50 != null);
    const with200 = live.filter((r) => r.sma200 != null);
    const breadth50 = with50.length >= 30 ? r1((with50.filter((r) => Number(r.ind_close) > Number(r.sma50)).length / with50.length) * 100) : null;
    const breadth200 = with200.length >= 30 ? r1((with200.filter((r) => Number(r.ind_close) > Number(r.sma200)).length / with200.length) * 100) : null;

    const read = regimeOf({ nifty: niftyClose, niftySma200: sma200, breadth200, vix: vixNow, vixSma20: vix20 });
    const { error } = await db.from("macro_daily").upsert(
      {
        date,
        nifty: niftyClose,
        nifty_sma200: sma200,
        vix: vixNow,
        vix_sma20: vix20,
        brent: latest.BRENT,
        usdinr: latest.USDINR,
        spx: latest.SPX,
        us10y: latest.US10Y,
        breadth50,
        breadth200,
        breadth_count: with200.length,
        regime: read?.regime ?? null,
        regime_score: read?.score ?? null,
        inputs: read?.inputs ?? [],
        computed_at: new Date().toISOString(),
      },
      { onConflict: "date" },
    );
    if (error) throw new Error(`macro_daily upsert: ${error.message}`);

    // 3. what actually happened after each logged event
    const moved = await updateEventMoves(db);
    return await finish(failures.length ? "partial" : "ok", MACRO_SERIES.length - failures.length, failures, { date, regime: read?.regime ?? null, stored, breadthStocks: with200.length, eventsUpdated: moved });
  } catch (e) {
    return await finish("error", 0, failures, {}, msg(e));
  }
}

/**
 * For each event still missing a move, measure Nifty 50 and each named sector
 * (equal-weight average of our stocks in it) 1, 5 and 20 sessions after the last
 * close before the event date. Sessions that have not happened yet stay empty.
 */
export async function updateEventMoves(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
  const { data: events } = await db.from("macro_events").select("id,event_date,helped,hurt,nifty_20d").gte("event_date", since).is("nifty_20d", null).limit(200);
  if (!events?.length) return 0;
  const { data: stocks } = await db.from("stocks").select("symbol,sector").eq("kind", "equity").eq("backfill_status", "done");
  const bySector = new Map<string, string[]>();
  for (const s of stocks ?? []) {
    if (!s.sector) continue;
    if (!bySector.has(s.sector)) bySector.set(s.sector, []);
    bySector.get(s.sector)!.push(s.symbol);
  }
  const earliest = events.reduce((m, e) => (e.event_date < m ? e.event_date : m), "9999");
  const from = new Date(new Date(`${earliest}T00:00:00Z`).getTime() - 10 * 86400000).toISOString().slice(0, 10);
  const cache = new Map<string, { date: string; close: number }[]>();
  const series = async (symbol: string) => {
    if (!cache.has(symbol)) {
      const { data } = await db.from("candles_daily").select("date,close").eq("symbol", symbol).gte("date", from).order("date").limit(200);
      cache.set(symbol, (data ?? []).map((r) => ({ date: r.date as string, close: Number(r.close) })));
    }
    return cache.get(symbol)!;
  };
  /** Percent move from the last close before `date` to the close n sessions later, or null if not there yet. */
  const move = (bars: { date: string; close: number }[], date: string, n: number): number | null => {
    const first = bars.findIndex((b) => b.date >= date);
    if (first < 1 || first + n - 1 >= bars.length) return null;
    return r3((bars[first + n - 1].close / bars[first - 1].close - 1) * 100);
  };

  let updated = 0;
  for (const e of events) {
    const nifty = await series(NIFTY);
    const sectors = [...new Set([...(e.helped as SectorEffect[]), ...(e.hurt as SectorEffect[])].map((x) => x.sector))];
    const sectorMoves: Record<string, SectorMove> = {};
    for (const sec of sectors) {
      const symbols = bySector.get(sec) ?? [];
      const sums = { d1: [] as number[], d5: [] as number[], d20: [] as number[] };
      for (const sym of symbols) {
        const bars = await series(sym);
        for (const [k, n] of [["d1", 1], ["d5", 5], ["d20", 20]] as const) {
          const m = move(bars, e.event_date, n);
          if (m != null) sums[k].push(m);
        }
      }
      const avg = (xs: number[]) => (xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
      sectorMoves[sec] = { d1: avg(sums.d1), d5: avg(sums.d5), d20: avg(sums.d20), stocks: symbols.length };
    }
    const d1 = move(nifty, e.event_date, 1);
    if (d1 == null) continue; // no session after the event yet
    await db
      .from("macro_events")
      .update({ nifty_1d: d1, nifty_5d: move(nifty, e.event_date, 5), nifty_20d: move(nifty, e.event_date, 20), sector_moves: sectorMoves, moves_at: new Date().toISOString() })
      .eq("id", e.id);
    updated++;
  }
  return updated;
}

// ───────────────────────── weekly AI macro note ─────────────────────────

const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const text = (description: string) => ({ type: "string", description });

function noteSchema(sectors: string[]) {
  const effect = obj({
    sector: { type: "string", enum: sectors, description: "One sector from the list." },
    why: text("One short sentence on the mechanism."),
  });
  return obj({
    summary: text("Two or three plain sentences on what is driving Indian equities this week."),
    events: {
      type: "array",
      description: "Three to five events moving Indian markets, most important first. Include an event only if a search result from the last 21 days reports it.",
      items: obj({
        title: text("The event in a short headline."),
        category: { type: "string", enum: [...MACRO_CATEGORIES] },
        what_happened: text("One or two sentences on what happened and why it matters for Indian markets."),
        event_date: text("Date the event happened as YYYY-MM-DD."),
        url: text("URL of the search result that reports it, copied exactly."),
        published: text("Publication date of that search result as YYYY-MM-DD."),
        helped: { type: "array", items: effect, description: "Sectors this event helps, up to three. Empty if none clearly." },
        hurt: { type: "array", items: effect, description: "Sectors this event hurts, up to three. Empty if none clearly." },
      }),
    },
    flows: obj({
      fii_net: text("Net FII/FPI equity flow as stated by a search result, with its unit and sign, for example '-12,400 crore'. Empty string if no result gives a figure."),
      dii_net: text("Net DII equity flow as stated by a search result. Empty string if none."),
      period: text("The period those figures cover, for example 'November 2026 to date'. Empty string if none."),
      url: text("URL of the search result that gives the figures, or an empty string."),
    }),
    confidence: { type: "integer", description: "0 to 100: how well the search results support this note." },
  });
}

export async function runMacroNote(trigger: "weekly" | "manual" = "weekly"): Promise<JobResult & { costUsd?: number }> {
  const db = adminDb();
  const finish = await job(db, "macro-note");
  if (!aiConfigured()) return await finish("error", 0, [], {}, "ANTHROPIC_API_KEY is not set");
  try {
    // one note a week: a second call within six days is skipped unless asked for by hand
    const { data: lastNote } = await db.from("macro_notes").select("run_at").order("run_at", { ascending: false }).limit(1).maybeSingle();
    if (trigger === "weekly" && lastNote && Date.now() - new Date(lastNote.run_at).getTime() < 6 * 86400000) {
      return await finish("skipped", 0, [], { reason: "a macro note was written in the last 6 days" });
    }
    const { data: st } = await db.from("stocks").select("sector").eq("kind", "equity");
    const sectors = [...new Set((st ?? []).map((s) => s.sector as string).filter(Boolean))].sort();
    const today = todayIST();
    const prompt = `Today is ${today}. Find the three to five events that are moving Indian equity markets right now.

Use at most ${MACRO_MAX_SEARCHES} web searches. Look across: geopolitics, US politics and policy (tariffs, trade, sanctions), the US Federal Reserve, the RBI, crude oil, and FII/DII flows.

For each event, name the sectors it helps and the sectors it hurts, and say why in one sentence. Example of the reasoning wanted: crude oil rising is negative for oil marketing companies, paints and airlines, and positive for upstream oil producers. Choose sectors only from this list:
${sectors.join("; ")}

If a search result gives FII or DII net flow figures, report them with the period they cover. Do not estimate them.`;

    let cost = 0;
    const call = async (domains?: SearchDomains) => {
      const started = Date.now();
      const runId = await startRun(db, "macro", "Macro note", trigger);
      const res = await runResearch({ system: RULES, maxSearches: MACRO_MAX_SEARCHES, schema: noteSchema(sectors), prompt, domains });
      await finishRun(db, runId, started, res);
      cost += estimateCost(res.usage);
      return { res, runId };
    };
    const parse = (d: Record<string, unknown>, sources: ReturnType<typeof dedupe>) => {
      const effects = (v: unknown): SectorEffect[] =>
        (Array.isArray(v) ? v : [])
          .map((x) => ({ sector: String((x as SectorEffect)?.sector ?? ""), why: String((x as SectorEffect)?.why ?? "").slice(0, 240) }))
          .filter((x) => sectors.includes(x.sector) && x.why)
          .slice(0, 3);
      return (Array.isArray(d.events) ? d.events : [])
        .map((raw) => {
          const e = (raw ?? {}) as Record<string, unknown>;
          const url = verifiedUrl(e.url, sources);
          const src = sources.find((s) => s.url === url);
          const published = url ? recentDate(e.published, src?.pageAge ?? null, EVENT_MAX_AGE_DAYS) : null;
          const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(e.event_date ?? "")) ? String(e.event_date) : published;
          const category = (MACRO_CATEGORIES as readonly string[]).includes(String(e.category)) ? String(e.category) : "Other";
          return { title: String(e.title ?? "").slice(0, 200), category, summary: String(e.what_happened ?? "").slice(0, 500), url, published, eventDate, helped: effects(e.helped), hurt: effects(e.hurt) };
        })
        // a dated source the model actually saw, and an event date that is neither in the future nor older than the window
        .filter((e) => e.title && e.url && e.published && e.eventDate && e.eventDate <= today && e.eventDate >= new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10))
        .filter((e, i, all) => all.findIndex((m) => m.url === e.url) === i)
        .slice(0, 5);
    };

    let { res, runId } = await call();
    if (!res.ok) return { ...(await finish("error", 0, [{ symbol: "Macro note", error: res.error }], { est_cost_usd: cost }, res.error)), costUsd: cost };
    let sources = dedupe(res.sources);
    let events = parse(res.data, sources);
    let lowGrade = false;
    // nothing usable from the allowlisted sites: one retry with open search and the blocklist
    if (!events.length) {
      const open = await call({ blocked: BLOCKED_DOMAINS });
      if (open.res.ok) {
        res = open.res;
        runId = open.runId;
        sources = dedupe(res.sources);
        events = parse(res.data, sources);
        lowGrade = true;
      }
    }
    const d = res.ok ? res.data : {};
    const f = (d.flows ?? {}) as Record<string, unknown>;
    const flowUrl = verifiedUrl(f.url, sources);
    const flows =
      flowUrl && (String(f.fii_net ?? "").trim() || String(f.dii_net ?? "").trim())
        ? { fii: String(f.fii_net ?? "").trim().slice(0, 80), dii: String(f.dii_net ?? "").trim().slice(0, 80), period: String(f.period ?? "").trim().slice(0, 80), url: flowUrl }
        : null;

    const { data: note, error } = await db
      .from("macro_notes")
      .insert({ model: res.model, summary: String(d.summary ?? "").slice(0, 900), flows, sources, low_grade_sources: lowGrade, ai_run_id: runId })
      .select("id")
      .single();
    if (error) throw new Error(`macro_notes insert: ${error.message}`);
    if (events.length) {
      const { error: e2 } = await db.from("macro_events").insert(
        events.map((e) => ({ note_id: note.id, event_date: e.eventDate, title: e.title, category: e.category, summary: e.summary, url: e.url, published: e.published, helped: e.helped, hurt: e.hurt })),
      );
      if (e2) throw new Error(`macro_events insert: ${e2.message}`);
    }
    await updateEventMoves(db);
    const out = await finish(events.length ? "ok" : "partial", events.length, [], { events: events.length, flows: Boolean(flows), lowGrade, est_cost_usd: Math.round(cost * 1000) / 1000 });
    return { ...out, costUsd: cost };
  } catch (e) {
    return await finish("error", 0, [], {}, msg(e));
  }
}
