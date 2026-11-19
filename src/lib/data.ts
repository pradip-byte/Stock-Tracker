/** Read side. Uses the signed-in user's client, so RLS decides what comes back. */
import { analyseQuarters } from "./events";
import { todayIST } from "./market";
import { userDb } from "./supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INDEX_SYMBOLS,
  type BacktestWindow,
  type Candle,
  type DashboardData,
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

export async function getRows(): Promise<StockRow[]> {
  const db = await userDb();
  const { data, error } = await db.from("stock_latest").select("*").eq("kind", "equity").order("symbol").limit(2000);
  if (error) throw new Error(`stock_latest: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function getQuotes(): Promise<Quotes> {
  const db = await userDb();
  const { data } = await db.from("quotes_latest").select("symbol,price,prev_close,market_time").limit(2000);
  const out: Quotes = {};
  for (const q of data ?? []) {
    out[q.symbol] = { price: Number(q.price), prevClose: n(q.prev_close), marketTime: q.market_time };
  }
  return out;
}

export async function getDashboard(): Promise<DashboardData> {
  const db = await userDb();
  const [all, nifty, signalBoard] = await Promise.all([
    getRows(),
    db.from("candles_daily").select("date,close").eq("symbol", INDEX_SYMBOLS[0]).order("date", { ascending: false }).limit(120),
    getBacktests(db, "all", "ALL"),
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
  };
}

export async function getStockDetail(symbol: string): Promise<StockDetail | null> {
  const db = await userDb();
  const { data: r, error } = await db.from("stock_latest").select("*").eq("symbol", symbol).eq("kind", "equity").maybeSingle();
  if (error) throw new Error(`stock_latest: ${error.message}`);
  if (!r) return null;
  // PostgREST caps a response at 1000 rows, so page through the 10-year history
  const candles: Candle[] = [];
  for (let from = 0; from < 6000; from += 1000) {
    const { data, error: e } = await db
      .from("candles_daily")
      .select("date,open,high,low,close,volume")
      .eq("symbol", symbol)
      .order("date", { ascending: true })
      .range(from, from + 999);
    if (e) throw new Error(`candles: ${e.message}`);
    for (const c of data ?? []) {
      candles.push({ time: c.date, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume });
    }
    if (!data || data.length < 1000) break;
  }
  const { data: eq } = await db
    .from("earnings")
    .select("period_end,revenue,net_profit,eps,eps_estimate,reported_at,reaction_1d,reaction_5d")
    .eq("symbol", symbol)
    .order("period_end", { ascending: true })
    .limit(40);
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
  const [stock, sector] = await Promise.all([getBacktests(db, "stock", symbol), getBacktests(db, "sector", r.sector)]);
  return { row: mapRow(r), candles, quarters, today: todayIST(), backtests: { stock, sector } };
}

export async function getJobRuns(limit = 60): Promise<JobRun[]> {
  const db = await userDb();
  const { data } = await db.from("job_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  return (data ?? []) as JobRun[];
}
