/**
 * Read side.
 *
 * Market data changes on a schedule (quotes every 15 minutes, everything else once
 * a day), so the page loaders below are cached with `unstable_cache`. A cached
 * function cannot read cookies, so it reads with the service client; each public
 * loader first checks that the proxy verified the session for this request.
 * Cron routes and server actions mark the tags stale when they change data:
 *   "quotes"  the quotes job        "eod"  end-of-day, fundamentals, backtest, AI and macro jobs
 * Data the user changes directly (paper trades, job history) is read live with
 * the user's own client, so RLS applies there.
 */
import { unstable_cache } from "next/cache";
import { adminDb } from "./supabase/admin";
import { analyseQuarters } from "./events";
import { MACRO_SERIES, type MacroEvent, type MacroPoint, type MacroView, type SectorMacroItem } from "./macro";
import { todayIST } from "./market";
import { breakdown, entryLabel, externalBand, limitStats, mapTrade, niftyPnl, pnlAt, summarise, type LimitStats, type MarkedTrade, type PaperBook, type PaperStats, type PaperTrade } from "./paper";
import { assertSignedIn, userDb } from "./supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INDEX_SYMBOLS,
  type BacktestWindow,
  type Candle,
  type AiRun,
  type DashboardData,
  type DatedRisk,
  type ExternalRead,
  type JobRun,
  type Quotes,
  type SignalKind,
  type SignalStats,
  type StockDetail,
  type StockRow,
} from "./types";

const n = (v: unknown): number | null => (v == null ? null : Number(v));
const arr = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): StockRow {
  const bounce = !!r.sig_bounce, breakdown = !!r.sig_breakdown, trend = !!r.sig_trend;
  return {
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    source: r.source,
    inWatchlist: !!r.in_watchlist,
    backfillStatus: r.backfill_status,
    backfillError: r.backfill_error,
    price: n(r.price) ?? n(r.ind_close),
    prevClose: n(r.prev_close),
    marketTime: r.market_time,
    indDate: r.ind_date,
    spark: arr(r.spark),
    hi52: n(r.hi52),
    lo52: n(r.lo52),
    distHi52: n(r.dist_hi52_pct),
    distLo52: n(r.dist_lo52_pct),
    rsi: n(r.rsi14),
    sma20: n(r.sma20),
    sma50: n(r.sma50),
    sma200: n(r.sma200),
    atr: n(r.atr14),
    volRatio: n(r.vol_ratio20),
    support: arr(r.support),
    resistance: arr(r.resistance),
    bounce,
    trend,
    breakdown,
    signal: bounce ? "Bounce" : breakdown ? "Breakdown" : trend ? "Trend" : null,
    tech: n(r.technical),
    techReasons: Array.isArray(r.technical_reasons) ? r.technical_reasons : [],
    risk: r.risk,
    rr: n(r.reward_risk),
    target: n(r.target),
    stop: n(r.stop),
    event: n(r.event),
    eventReasons: Array.isArray(r.event_reasons) ? r.event_reasons : [],
    nextResultDate: r.next_result_date,
    nextResultEstimate: !!r.next_result_is_estimate,
    nextResultSource: r.next_result_source,
    pe: n(r.pe),
    roe: n(r.roe),
    debtToEquity: n(r.debt_to_equity),
    profitMargin: n(r.profit_margin),
    fundamentalsAt: r.fundamentals_at,
    fiscalYearEndMonth: n(r.fiscal_year_end_month),
    nextResultUrl: r.next_result_url ?? null,
    external: n(r.external),
    overall: n(r.overall),
    shortVerdict: r.short_verdict,
    longVerdict: r.long_verdict,
    shortScore: n(r.verdict_reasons?.shortScore),
    longScore: n(r.verdict_reasons?.longScore),
    shortReasons: Array.isArray(r.verdict_reasons?.short) ? r.verdict_reasons.short : [],
    longReasons: Array.isArray(r.verdict_reasons?.long) ? r.verdict_reasons.long : [],
    odds: r.verdict_reasons?.odds ?? null,
    momRank: n(r.mom_rank),
    rs6: n(r.rs6),
    marketUp: r.market_up ?? null,
    entry: r.entry && typeof r.entry === "object" && typeof r.entry.rating === "string" ? r.entry : null,
  };
}

const KINDS: SignalKind[] = ["Bounce", "Trend", "Breakdown"];

/** Backtest rows for one scope, shaped per signal with the any-day baseline alongside. */
async function getBacktests(db: SupabaseClient, scope: "stock" | "sector" | "all", key: string | null): Promise<SignalStats[]> {
  if (!key) return [];
  const { data } = await db
    .from("signal_backtests")
    .select("signal,horizon_days,samples,hit_rate,avg_return")
    .eq("scope", scope)
    .eq("scope_key", key)
    .limit(50);
  const rows = data ?? [];
  if (!rows.length) return [];
  const base = (d: number) => n(rows.find((r) => r.signal === "Baseline" && r.horizon_days === d)?.hit_rate);
  return KINDS.map((kind) => ({
    kind,
    scope,
    scopeKey: key,
    windows: ([5, 20, 60] as const).map((days): BacktestWindow => {
      const r = rows.find((x) => x.signal === kind && x.horizon_days === days);
      const b = base(days);
      return {
        days,
        samples: r?.samples ?? 0,
        hitRate: n(r?.hit_rate),
        avgReturn: n(r?.avg_return),
        // for a breakdown warning a "hit" is a lower price, so compare with how often any day was followed by one
        baseline: b == null ? null : kind === "Breakdown" ? Math.round((100 - b) * 10) / 10 : b,
      };
    }),
  }));
}

const MARKET = { tags: ["eod", "quotes"], revalidate: 120 };

export async function loadRows(db: SupabaseClient): Promise<StockRow[]> {
  const { data, error } = await db.from("stock_latest").select("*").eq("kind", "equity").order("symbol").limit(2000);
  if (error) throw new Error(`stock_latest: ${error.message}`);
  return (data ?? []).map(mapRow);
}

const cachedRows = unstable_cache(() => loadRows(adminDb()), ["rows-v1"], MARKET);
export async function getRows(): Promise<StockRow[]> {
  await assertSignedIn();
  return cachedRows();
}

export async function loadQuotes(db: SupabaseClient): Promise<Quotes> {
  const { data } = await db.from("quotes_latest").select("symbol,price,prev_close,market_time").limit(2000);
  const out: Quotes = {};
  for (const q of data ?? []) {
    out[q.symbol] = { price: Number(q.price), prevClose: n(q.prev_close), marketTime: q.market_time };
  }
  return out;
}

const cachedQuotes = unstable_cache(() => loadQuotes(adminDb()), ["quotes-v1"], { tags: ["quotes"], revalidate: 60 });
export async function getQuotes(): Promise<Quotes> {
  await assertSignedIn();
  return cachedQuotes();
}

export async function loadDashboard(db: SupabaseClient): Promise<DashboardData> {
  const [all, nifty, signalBoard, macro] = await Promise.all([
    loadRows(db),
    db.from("candles_daily").select("date,close").eq("symbol", INDEX_SYMBOLS[0]).order("date", { ascending: false }).limit(120),
    getBacktests(db, "all", "ALL"),
    loadMacro(db),
  ]);
  const ready = all.filter((r) => r.backfillStatus === "done" && r.tech != null);
  const byTech = (a: StockRow, b: StockRow) => (b.tech ?? 0) - (a.tech ?? 0);

  const rank = { Favourable: 2, Neutral: 1, Avoid: 0 } as const;
  const shortSetups = ready
    .filter((r) => (r.bounce || r.trend) && !r.breakdown)
    .sort(
      (a, b) =>
        (rank[b.shortVerdict ?? "Avoid"] - rank[a.shortVerdict ?? "Avoid"]) ||
        (b.shortScore ?? 0) - (a.shortScore ?? 0) ||
        byTech(a, b),
    )
    .slice(0, 10);
  const longCandidates = ready
    .filter((r) => r.longVerdict === "Favourable")
    .sort((a, b) => (b.longScore ?? 0) - (a.longScore ?? 0))
    .slice(0, 6);
  const today = todayIST();
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const until = horizon.toISOString().slice(0, 10);
  const results = ready
    .filter((r) => r.nextResultDate && r.nextResultDate >= today && r.nextResultDate <= until)
    .sort((a, b) => a.nextResultDate!.localeCompare(b.nextResultDate!))
    .map((r) => ({ symbol: r.symbol, date: r.nextResultDate!, estimate: r.nextResultEstimate }));
  const fundamentalsAt = ready.reduce<string | null>((m, r) => (r.fundamentalsAt && (!m || r.fundamentalsAt < m) ? r.fundamentalsAt : m), null);
  const highRisk = ready
    .filter((r) => r.risk === "High" && (r.rr ?? 0) >= 1.5 && !r.breakdown)
    .sort((a, b) => (b.rr ?? 0) - (a.rr ?? 0))
    .slice(0, 6);

  const sectorNames = [...new Set(ready.map((r) => r.sector ?? "Other"))].sort();
  const eodDate = ready.reduce<string | null>((m, r) => (r.indDate && (!m || r.indDate > m) ? r.indDate : m), null);

  return {
    rows: Object.fromEntries(all.map((r) => [r.symbol, r])),
    niftySeries: (nifty.data ?? []).map((c) => ({ date: c.date, close: Number(c.close) })).reverse(),
    eodDate,
    today,
    fundamentalsAt,
    results,
    signalBoard,
    resultsUnknown: ready.filter((r) => !r.nextResultDate || r.nextResultDate < today).length,
    resultsLater: ready
      .filter((r) => r.nextResultDate && r.nextResultDate > until)
      .sort((a, b) => a.nextResultDate!.localeCompare(b.nextResultDate!))
      .slice(0, 8)
      .map((r) => ({ symbol: r.symbol, date: r.nextResultDate!, estimate: r.nextResultEstimate })),
    shortSetups: shortSetups.map((r) => r.symbol),
    longCandidates: longCandidates.map((r) => r.symbol),
    highRisk: highRisk.map((r) => r.symbol),
    sectors: sectorNames.map((sector) => ({
      sector,
      symbols: ready.filter((r) => (r.sector ?? "Other") === sector).map((r) => r.symbol),
    })),
    counts: {
      tracked: all.length,
      pending: all.length - ready.length,
      bounce: ready.filter((r) => r.bounce).length,
      trend: ready.filter((r) => r.trend).length,
      breakdown: ready.filter((r) => r.breakdown).length,
    },
    macro,
  };
}

const cachedDashboard = unstable_cache(() => loadDashboard(adminDb()), ["dashboard-v1"], MARKET);
export async function getDashboard(): Promise<DashboardData> {
  await assertSignedIn();
  return cachedDashboard();
}

/** Full daily history, oldest first. PostgREST caps a response at 1000 rows, so the pages are fetched side by side. */
export async function loadCandles(db: SupabaseClient, symbol: string): Promise<Candle[]> {
  const page = async (from: number) => {
    const { data, error } = await db
      .from("candles_daily")
      .select("date,open,high,low,close,volume")
      .eq("symbol", symbol)
      .order("date", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`candles: ${error.message}`);
    return data ?? [];
  };
  const pages = await Promise.all([page(0), page(1000), page(2000)]);
  // ten years is about 2,500 sessions; carry on only if the third page came back full
  for (let from = 3000; pages[pages.length - 1].length === 1000 && from < 8000; from += 1000) pages.push(await page(from));
  return pages.flat().map((c) => ({ time: c.date, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume }));
}

const cachedCandles = unstable_cache((symbol: string) => loadCandles(adminDb(), symbol), ["candles-v1"], { tags: ["eod"], revalidate: 900 });
export async function getCandles(symbol: string): Promise<Candle[]> {
  await assertSignedIn();
  return cachedCandles(symbol);
}

/** Everything on a stock page except the price history, which the chart fetches after first paint. */
export async function loadStock(db: SupabaseClient, symbol: string): Promise<StockDetail | null> {
  const { data: r, error } = await db.from("stock_latest").select("*").eq("symbol", symbol).eq("kind", "equity").maybeSingle();
  if (error) throw new Error(`stock_latest: ${error.message}`);
  if (!r) return null;
  const [{ data: eq }, stock, sector, external, macro] = await Promise.all([
    db
      .from("earnings")
      .select("period_end,revenue,net_profit,eps,eps_estimate,reported_at,reaction_1d,reaction_5d")
      .eq("symbol", symbol)
      .order("period_end", { ascending: true })
      .limit(40),
    getBacktests(db, "stock", symbol),
    getBacktests(db, "sector", r.sector),
    getExternal(db, symbol),
    getSectorMacro(db, r.sector ?? null),
  ]);
  const quarters = analyseQuarters(
    (eq ?? []).map((q) => ({
      periodEnd: q.period_end,
      revenue: n(q.revenue),
      netProfit: n(q.net_profit),
      eps: n(q.eps),
      epsEstimate: n(q.eps_estimate),
      reportedAt: q.reported_at,
      reaction1d: n(q.reaction_1d),
      reaction5d: n(q.reaction_5d),
    })),
    n(r.fiscal_year_end_month),
  ).slice(-8);
  return { row: mapRow(r), quarters, today: todayIST(), backtests: { stock, sector }, external, macro };
}

const cachedStock = unstable_cache((symbol: string) => loadStock(adminDb(), symbol), ["stock-v1"], MARKET);
export async function getStockDetail(symbol: string): Promise<StockDetail | null> {
  await assertSignedIn();
  return cachedStock(symbol);
}

/** Risks are shown only when they carry a source link and date; older rows stored plain strings. */
const datedOnly = (v: unknown): DatedRisk[] =>
  (Array.isArray(v) ? v : []).filter((x): x is DatedRisk => typeof x === "object" && x !== null && typeof x.risk === "string" && typeof x.url === "string" && typeof x.published === "string");

async function getExternal(db: SupabaseClient, symbol: string): Promise<ExternalRead | null> {
  const { data: e } = await db
    .from("external_signals")
    .select("run_at,model,score,sentiment,confidence,payload,sources,sector_research_id")
    .eq("symbol", symbol)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!e) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (e.payload ?? {}) as Record<string, any>;
  let sector: ExternalRead["sector"] = null;
  if (e.sector_research_id) {
    const { data: sr } = await db.from("sector_research").select("sector,run_at,payload,sources").eq("id", e.sector_research_id).maybeSingle();
    if (sr) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sp = (sr.payload ?? {}) as Record<string, any>;
      sector = {
        name: sr.sector,
        runAt: sr.run_at,
        outlook: sp.outlook ?? "",
        outlookScore: Number(sp.outlook_score ?? 0),
        exportImport: sp.export_import_exposure ?? "",
        currencyCommodity: sp.currency_commodity_sensitivity ?? "",
        risks: datedOnly(sp.key_risks),
        sources: Array.isArray(sr.sources) ? sr.sources : [],
      };
    }
  }
  return {
    runAt: e.run_at,
    model: e.model,
    score: n(e.score),
    sentiment: Number(e.sentiment ?? 0),
    sentimentRationale: p.sentiment_rationale ?? "",
    confidence: Number(e.confidence ?? 0),
    searches: n(p.searches),
    lowGradeSources: p.low_grade_sources === true,
    keyNews: Array.isArray(p.key_news) ? p.key_news : [],
    guidance: p.last_quarter_guidance ?? { summary: "", tone: 0, url: null },
    expectations: p.next_result_expectations ?? { summary: "", tone: 0 },
    resultDate: p.next_result_date ?? { date: null, basis: "none", url: null, confirmed: false },
    companyRisks: datedOnly(p.company_risks),
    sources: Array.isArray(e.sources) ? e.sources : [],
    sector,
  };
}

/** AI calls from the last 62 days, newest first, for the spend panel. */
export async function getAiRuns(): Promise<AiRun[]> {
  const db = await userDb();
  const since = new Date(Date.now() - 62 * 86400000).toISOString();
  const { data } = await db
    .from("ai_runs")
    .select("id,kind,key,trigger,model,status,started_at,duration_ms,input_tokens,output_tokens,searches,cost_usd,error")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1000);
  return (data ?? []).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) })) as AiRun[];
}

export async function getJobRuns(limit = 60): Promise<JobRun[]> {
  const db = await userDb();
  const { data } = await db.from("job_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  return (data ?? []) as JobRun[];
}

// ───────────────────────── paper trading ─────────────────────────

export type PaperBySymbol = Record<string, { ST?: PaperTrade; LT?: PaperTrade }>;

/** The user's own pending, open and closing paper trades, keyed by symbol and column. */
export async function getMyActivePaper(): Promise<PaperBySymbol> {
  const db = await userDb();
  const { data } = await db.from("paper_trades").select("*").eq("book", "mine").in("status", ["pending", "open", "closing"]).limit(2000);
  const out: PaperBySymbol = {};
  for (const r of data ?? []) {
    const t = mapTrade(r);
    (out[t.symbol] ??= {})[t.horizon] = t;
  }
  return out;
}

export type Scoreboard = {
  book: PaperBook;
  overall: PaperStats;
  byHorizon: PaperStats[];
  bySignal: PaperStats[];
  byEntry: PaperStats[];
  byRegime: PaperStats[];
  byExternal: PaperStats[];
  recent: MarkedTrade[];
  pending: number;
  limits: LimitStats;
};

/** Every filled paper trade marked to the latest stored quote, summarised for one book. */
export async function getScoreboards(): Promise<{ boards: Scoreboard[]; quotesAt: string | null }> {
  const db = await userDb();
  const trades: PaperTrade[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await db.from("paper_trades").select("*").order("id", { ascending: false }).range(from, from + 999);
    trades.push(...(data ?? []).map(mapTrade));
    if (!data || data.length < 1000) break;
  }
  const quotes = await getQuotes();
  const nifty = quotes[INDEX_SYMBOLS[0]]?.price ?? null;
  let quotesAt: string | null = null;
  for (const q of Object.values(quotes)) if (q.marketTime && (!quotesAt || q.marketTime > quotesAt)) quotesAt = q.marketTime;

  const boards = (["mine", "shadow"] as const).map((book): Scoreboard => {
    const mine = trades.filter((t) => t.book === book);
    const marked: MarkedTrade[] = [];
    for (const t of mine) {
      if (t.entryPrice == null || t.qty == null) continue;
      if (t.status === "closed" && t.pnlInr != null && t.pnlPct != null) {
        marked.push({ trade: t, pnlInr: t.pnlInr, pnlPct: t.pnlPct, niftyInr: niftyPnl(t, t.niftyExit), closed: true });
      } else if (t.status === "open" || t.status === "closing") {
        const price = quotes[t.symbol]?.price;
        if (price == null) continue;
        const p = pnlAt({ amount: t.amount, qty: t.qty, entryPrice: t.entryPrice, costPct: t.costPct }, price);
        marked.push({ trade: t, pnlInr: p.inr, pnlPct: p.pct, niftyInr: niftyPnl(t, nifty), closed: false });
      }
    }
    const regimeOf = (t: PaperTrade) => t.context.regime ?? (t.context.marketUp == null ? "Unknown" : t.context.marketUp ? "Nifty above 200 DMA" : "Nifty below 200 DMA");
    return {
      book,
      overall: summarise("All trades", marked),
      byHorizon: breakdown(marked, (t) => (t.horizon === "ST" ? "Short term" : "Long term")),
      bySignal: breakdown(marked, (t) => t.context.signal ?? "No signal"),
      byEntry: breakdown(marked, entryLabel),
      byRegime: breakdown(marked, regimeOf),
      byExternal: breakdown(marked, externalBand),
      recent: marked.slice(0, 40),
      pending: mine.filter((t) => t.status === "pending").length,
      limits: limitStats(mine),
    };
  });
  return { boards, quotesAt };
}

// ───────────────────────── macro view ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any): MacroEvent {
  return {
    id: Number(e.id),
    eventDate: e.event_date,
    title: e.title,
    category: e.category,
    summary: e.summary ?? "",
    url: e.url,
    published: e.published,
    helped: Array.isArray(e.helped) ? e.helped : [],
    hurt: Array.isArray(e.hurt) ? e.hurt : [],
    nifty: { d1: n(e.nifty_1d), d5: n(e.nifty_5d), d20: n(e.nifty_20d) },
    sectorMoves: e.sector_moves ?? {},
  };
}

/** The latest regime read, the macro numbers with their 1- and 20-session changes, and the latest AI macro note. One round of parallel queries. */
export async function loadMacro(db: SupabaseClient): Promise<MacroView> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsOf = (data: any[] | null) => (data ?? []).map((r) => ({ date: r.date as string, close: Number(r.close) }));
  const fromCandles = async (symbol: string) => rowsOf((await db.from("candles_daily").select("date,close").eq("symbol", symbol).order("date", { ascending: false }).limit(21)).data);
  const fromSeries = async (id: string) => rowsOf((await db.from("macro_series").select("date,close").eq("series", id).order("date", { ascending: false }).limit(21)).data);
  const [{ data: d }, { data: note }, { data: recentEvents }, nifty, vix, ...outside] = await Promise.all([
    db.from("macro_daily").select("*").order("date", { ascending: false }).limit(1).maybeSingle(),
    db.from("macro_notes").select("id,run_at,summary,flows,low_grade_sources").order("run_at", { ascending: false }).limit(1).maybeSingle(),
    // the latest note's events are among the newest rows; fetched alongside rather than after the note
    db.from("macro_events").select("*").order("id", { ascending: false }).limit(12),
    fromCandles(INDEX_SYMBOLS[0]),
    fromCandles(INDEX_SYMBOLS[1]),
    ...MACRO_SERIES.map((x) => fromSeries(x.id)),
  ]);
  const point = (rows: { date: string; close: number }[]): MacroPoint | null => {
    if (!rows.length) return null;
    const last = rows[0];
    const ch = (k: number) => (rows[k] ? Math.round((last.close / rows[k].close - 1) * 10000) / 100 : null);
    return { value: last.close, date: last.date, chg1: ch(1), chg20: ch(20) };
  };
  const events = note ? (recentEvents ?? []).filter((x) => x.note_id === note.id).sort((a, b) => a.id - b.id).map(mapEvent) : [];
  return {
    date: d?.date ?? null,
    regime: d?.regime ?? null,
    score: n(d?.regime_score),
    inputs: Array.isArray(d?.inputs) ? d.inputs : [],
    breadth50: n(d?.breadth50),
    breadth200: n(d?.breadth200),
    breadthCount: n(d?.breadth_count),
    series: [
      { id: "NIFTY50", label: "Nifty 50", unit: "", point: point(nifty) },
      { id: "INDIAVIX", label: "India VIX", unit: "", point: point(vix) },
      ...MACRO_SERIES.map((s, i) => ({ id: s.id as string, label: s.label as string, unit: s.unit as string, point: point(outside[i]) })),
    ],
    note: note ? { runAt: note.run_at, summary: note.summary ?? "", lowGrade: !!note.low_grade_sources, flows: note.flows ?? null } : null,
    events,
  };
}

/** Macro events from the last 45 days that name this sector as helped or hurt. */
export async function getSectorMacro(db: SupabaseClient, sector: string | null): Promise<SectorMacroItem[]> {
  if (!sector) return [];
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const { data } = await db.from("macro_events").select("*").gte("event_date", since).order("event_date", { ascending: false }).limit(60);
  const out: SectorMacroItem[] = [];
  for (const e of (data ?? []).map(mapEvent)) {
    const helped = e.helped.find((x) => x.sector === sector);
    const hurt = e.hurt.find((x) => x.sector === sector);
    if (!helped && !hurt) continue;
    out.push({ event: e, effect: helped ? "helps" : "hurts", why: (helped ?? hurt)!.why, move: e.sectorMoves[sector] ?? null });
  }
  return out.slice(0, 6);
}
