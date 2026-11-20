/**
 * Signal research: does a signal beat buying on any random day?
 *
 * Rules, applied to every signal and to the baseline alike:
 *  - A signal for day i uses data up to that day's close only.
 *  - The entry is the NEXT session's open. The exit is the close h sessions
 *    after the signal day (5, 20, 60 or 120).
 *  - A round-trip cost (setting, default 0.25%) is taken off every trade.
 *  - 2016-2022 is the in-sample period, where a variant may be chosen.
 *    2023 onward is out-of-sample and is reported separately. A trade counts
 *    as in-sample only if it also exits by the end of 2022.
 *  - Every result is split by market regime: Nifty 50 above or below its 200 DMA
 *    on the signal day.
 *
 * Two kinds of signal:
 *  - Trigger signals (breakout, bounce, trend, breakdown, post-result) count once,
 *    on the first day the condition switches on.
 *  - State signals (momentum rank, relative strength, near the 52-week high) are
 *    sampled every 20 sessions: every stock in the state on that day is one trade.
 *
 * Besides the plain edge over the baseline, each signal gets a month-matched edge:
 * its trades are compared with baseline trades entered in the same calendar month,
 * which removes the credit a signal would otherwise get for simply firing more
 * often in rising markets. The t-statistic is computed across those months.
 *
 * Holding periods that contain a one-day move beyond 30% are left out everywhere:
 * nearly all are demergers, relistings or bad ticks in the price history.
 *
 * Known limit: the universe is today's index members, so companies that fell out
 * of the index are missing. That lifts every return here, baseline included.
 */
import { momentum12, momentum6 } from "./factors";
import { sma } from "./indicators";
import { entryPlan, heldBreakout, volumeBreakoutAt } from "./entry";
import { computeSeries, snapshotAt, tradeFrame } from "./signals";
import type { Candle } from "./types";

export const R_HORIZONS = [5, 20, 60, 120] as const;
export type RHorizon = (typeof R_HORIZONS)[number];
export const PERIODS = ["in", "out"] as const;
export type Period = (typeof PERIODS)[number];
export const REGIMES = ["all", "up", "down"] as const;
export type Regime = (typeof REGIMES)[number];

export const IN_SAMPLE_END = "2022-12-31";
const WARMUP = 260;
const REBALANCE_EVERY = 20;
const MIN_UNIVERSE = 50;
const JUMP_LIMIT = 0.3;

export type SignalDef = { id: string; family: string; label: string; kind: "trigger" | "state" | "baseline" };

export const SIGNALS: SignalDef[] = [
  { id: "baseline", family: "Baseline", label: "Any day (baseline)", kind: "baseline" },
  { id: "mom12_top10", family: "Momentum 12-1", label: "12-1 month momentum / volatility, top 10%", kind: "state" },
  { id: "mom12_top20", family: "Momentum 12-1", label: "12-1 month momentum / volatility, top 20%", kind: "state" },
  { id: "mom12_top30", family: "Momentum 12-1", label: "12-1 month momentum / volatility, top 30%", kind: "state" },
  { id: "mom12_bottom20", family: "Momentum 12-1", label: "12-1 month momentum / volatility, bottom 20%", kind: "state" },
  { id: "mom6_top10", family: "Momentum 6m", label: "6 month momentum / volatility, top 10%", kind: "state" },
  { id: "mom6_top20", family: "Momentum 6m", label: "6 month momentum / volatility, top 20%", kind: "state" },
  { id: "mom6_top30", family: "Momentum 6m", label: "6 month momentum / volatility, top 30%", kind: "state" },
  { id: "mom6_bottom20", family: "Momentum 6m", label: "6 month momentum / volatility, bottom 20%", kind: "state" },
  { id: "hi52_5", family: "52-week high", label: "Within 5% of the 52-week high", kind: "state" },
  { id: "hi52_10", family: "52-week high", label: "Within 10% of the 52-week high", kind: "state" },
  { id: "hi52_far30", family: "52-week high", label: "More than 30% below the 52-week high", kind: "state" },
  { id: "volbo_15", family: "Volume breakout", label: "50-session closing high, volume 1.5x, close in top third", kind: "trigger" },
  { id: "volbo_20", family: "Volume breakout", label: "50-session closing high, volume 2x, close in top third", kind: "trigger" },
  { id: "rs3_0", family: "Relative strength 3m", label: "3 month return above Nifty 50", kind: "state" },
  { id: "rs3_10", family: "Relative strength 3m", label: "3 month return 10+ points above Nifty 50", kind: "state" },
  { id: "rs3_20", family: "Relative strength 3m", label: "3 month return 20+ points above Nifty 50", kind: "state" },
  { id: "rs6_0", family: "Relative strength 6m", label: "6 month return above Nifty 50", kind: "state" },
  { id: "rs6_10", family: "Relative strength 6m", label: "6 month return 10+ points above Nifty 50", kind: "state" },
  { id: "rs6_20", family: "Relative strength 6m", label: "6 month return 20+ points above Nifty 50", kind: "state" },
  { id: "drift", family: "Post-result drift", label: "Result day up and profit up year on year", kind: "trigger" },
  { id: "drift_neg", family: "Post-result drift", label: "Result day down and profit down year on year", kind: "trigger" },
  { id: "entry_good", family: "Entry rating", label: "Good entry: buy at the next open", kind: "trigger" },
  { id: "entry_wait_now", family: "Entry rating", label: "Wait for pullback: bought anyway at the next open", kind: "trigger" },
  { id: "entry_wait_limit", family: "Entry rating", label: "Wait for pullback: limit at the suggested price, filled within 10 sessions", kind: "trigger" },
  { id: "entry_ext_now", family: "Entry rating", label: "Extended: bought anyway at the next open", kind: "trigger" },
  { id: "entry_ext_limit", family: "Entry rating", label: "Extended: limit at the suggested price, filled within 10 sessions", kind: "trigger" },
  { id: "bounce", family: "Existing", label: "Bounce signal (existing)", kind: "trigger" },
  { id: "trend", family: "Existing", label: "Trend signal (existing)", kind: "trigger" },
  { id: "breakdown", family: "Existing", label: "Breakdown warning (existing)", kind: "trigger" },
];

// ───────────────────────── tallies ─────────────────────────

export type Cell = {
  n: number;
  wins: number;
  sum: number;
  sumWin: number;
  sumLoss: number; // negative or zero
  months: Map<string, { n: number; sum: number }>;
};
const newCell = (): Cell => ({ n: 0, wins: 0, sum: 0, sumWin: 0, sumLoss: 0, months: new Map() });
const cellKey = (signal: string, period: Period, regime: Regime, h: RHorizon) => `${signal}|${period}|${regime}|${h}`;

export class Tallies {
  cells = new Map<string, Cell>();
  cell(signal: string, period: Period, regime: Regime, h: RHorizon): Cell {
    const k = cellKey(signal, period, regime, h);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = newCell()));
    return c;
  }
  add(signal: string, period: Period, regime: "up" | "down", h: RHorizon, month: string, ret: number) {
    for (const rg of ["all", regime] as const) {
      const c = this.cell(signal, period, rg, h);
      c.n++;
      c.sum += ret;
      if (ret > 0) {
        c.wins++;
        c.sumWin += ret;
      } else c.sumLoss += ret;
      const m = c.months.get(month);
      if (m) {
        m.n++;
        m.sum += ret;
      } else c.months.set(month, { n: 1, sum: ret });
    }
  }
}

export type Stat = {
  signal: string;
  period: Period;
  regime: Regime;
  horizon: RHorizon;
  samples: number;
  hitRate: number | null; // % of trades that made money after costs
  avgReturn: number | null; // % per trade after costs; this is the expectancy
  avgWin: number | null;
  avgLoss: number | null;
  edge: number | null; // avgReturn minus the baseline's, same period, regime and horizon
  hitEdge: number | null; // hit rate minus the baseline's
  matchedEdge: number | null; // average over months of (signal mean - baseline mean in that month)
  tStat: number | null; // of matchedEdge across months
  months: number;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function summarise(t: Tallies): Stat[] {
  const out: Stat[] = [];
  for (const def of SIGNALS) {
    for (const period of PERIODS) {
      for (const regime of REGIMES) {
        for (const horizon of R_HORIZONS) {
          const c = t.cell(def.id, period, regime, horizon);
          const b = t.cell("baseline", period, regime, horizon);
          const mean = c.n ? c.sum / c.n : null;
          const bMean = b.n ? b.sum / b.n : null;
          // month-matched comparison
          const diffs: number[] = [];
          for (const [m, v] of c.months) {
            const bm = b.months.get(m);
            if (bm && bm.n) diffs.push(v.sum / v.n - bm.sum / bm.n);
          }
          let matched: number | null = null;
          let tStat: number | null = null;
          if (diffs.length >= 2) {
            matched = diffs.reduce((a, x) => a + x, 0) / diffs.length;
            const sd = Math.sqrt(diffs.reduce((a, x) => a + (x - matched!) ** 2, 0) / (diffs.length - 1));
            tStat = sd > 0 ? matched / (sd / Math.sqrt(diffs.length)) : null;
          }
          const losses = c.n - c.wins;
          out.push({
            signal: def.id,
            period,
            regime,
            horizon,
            samples: c.n,
            hitRate: c.n ? r2((c.wins / c.n) * 100) : null,
            avgReturn: mean == null ? null : r2(mean),
            avgWin: c.wins ? r2(c.sumWin / c.wins) : null,
            avgLoss: losses ? r2(c.sumLoss / losses) : null,
            edge: mean == null || bMean == null || def.kind === "baseline" ? null : r2(mean - bMean),
            hitEdge: c.n && b.n && def.kind !== "baseline" ? r2((c.wins / c.n - b.wins / b.n) * 100) : null,
            matchedEdge: matched == null || def.kind === "baseline" ? null : r2(matched),
            tStat: tStat == null || def.kind === "baseline" ? null : r2(tStat),
            months: diffs.length,
          });
        }
      }
    }
  }
  return out;
}

// ───────────────────────── per-stock inputs ─────────────────────────

export type ResultEvent = { reportedAt: string; profitYoY: number | null };
export type StockData = { symbol: string; candles: Candle[]; results: ResultEvent[] };

type Prepared = {
  symbol: string;
  c: Candle[];
  idx: Map<string, number>;
  mom12: (number | null)[];
  mom6: (number | null)[];
  ret63: (number | null)[];
  ret126: (number | null)[];
  hiDist: (number | null)[]; // % below the 52-week high (0 = at the high)
  /** Running count of days with a one-day move beyond 30%: demergers, relistings and bad ticks, plus a few real collapses. */
  jumps: number[];
};

function prepare(s: StockData): Prepared {
  const c = s.candles;
  const closes = c.map((x) => x.close);
  const n = c.length;
  const mom12: (number | null)[] = new Array(n).fill(null);
  const mom6: (number | null)[] = new Array(n).fill(null);
  const ret63: (number | null)[] = new Array(n).fill(null);
  const ret126: (number | null)[] = new Array(n).fill(null);
  const hiDist: (number | null)[] = new Array(n).fill(null);
  const jumps: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    jumps[i] = (i ? jumps[i - 1] : 0) + (i && Math.abs(closes[i] / closes[i - 1] - 1) > JUMP_LIMIT ? 1 : 0);
    if (i >= 63) ret63[i] = (closes[i] / closes[i - 63] - 1) * 100;
    if (i >= 126) {
      ret126[i] = (closes[i] / closes[i - 126] - 1) * 100;
      mom6[i] = momentum6(closes, i);
    }
    if (i >= 252) {
      // 12 months back to 1 month back: the latest month is left out
      mom12[i] = momentum12(closes, i);
      let hi = 0;
      for (let k = i - 251; k <= i; k++) if (c[k].high > hi) hi = c[k].high;
      hiDist[i] = hi > 0 ? (1 - closes[i] / hi) * 100 : null;
    }
  }
  return { symbol: s.symbol, c, idx: new Map(c.map((x, i) => [x.time, i])), mom12, mom6, ret63, ret126, hiDist, jumps };
}

// ───────────────────────── the run ─────────────────────────

export type ResearchOptions = { costPct: number; onProgress?: (symbol: string) => void };

export function runResearch(stocks: StockData[], nifty: Candle[], opts: ResearchOptions): { stats: Stat[]; meta: Record<string, unknown> } {
  const t = new Tallies();
  const limitOrders: Record<string, number> = {};
  const limitFills: Record<string, number> = {};
  const cost = opts.costPct;

  // market regime by date: Nifty close against its own 200 DMA, known at that day's close
  const nClose = nifty.map((x) => x.close);
  const n200 = sma(nClose, 200);
  const nIdx = new Map(nifty.map((x, i) => [x.time, i]));
  const regimeAt = (date: string): "up" | "down" | null => {
    const i = nIdx.get(date);
    if (i == null || n200[i] == null) return null;
    return nClose[i] > (n200[i] as number) ? "up" : "down";
  };
  const niftyRet = (date: string, back: number): number | null => {
    const i = nIdx.get(date);
    return i == null || i < back ? null : (nClose[i] / nClose[i - back] - 1) * 100;
  };

  /** Record one trade: signal at index i of this stock, entry at the next open. */
  const record = (signal: string, p: Prepared, i: number, fillPrice?: number) => {
    const c = p.c;
    const date = c[i].time;
    const regime = regimeAt(date);
    if (!regime || i + 1 >= c.length) return;
    const entry = fillPrice ?? c[i + 1].open;
    if (!(entry > 0)) return;
    const month = date.slice(0, 7);
    for (const h of R_HORIZONS) {
      if (i + h >= c.length) continue; // holding period not finished
      if (p.jumps[i + h] > p.jumps[i]) continue; // the window holds a one-day move beyond 30%: left out for signals and baseline alike
      const exitDate = c[i + h].time;
      let period: Period;
      if (date > IN_SAMPLE_END) period = "out";
      else if (exitDate <= IN_SAMPLE_END) period = "in";
      else continue; // straddles the boundary: belongs to neither
      t.add(signal, period, regime, h, month, (c[i + h].close / entry - 1) * 100 - cost);
    }
  };

  const prepared = stocks.filter((s) => s.candles.length >= WARMUP + 30).map(prepare);

  // 1. per-stock pass: baseline and trigger signals
  for (const s of stocks) {
    const p = prepared.find((x) => x.symbol === s.symbol);
    if (!p) continue;
    const c = p.c;
    const series = computeSeries(c);
    let prev = { bounce: false, trend: false, breakdown: false, bo15: false, bo20: false, rating: "" };
    /** A limit order left for up to 10 sessions: filled on the first day the low reaches it, at the limit or the open if lower. */
    const limitFill = (signal: string, i: number, limit: number) => {
      limitOrders[signal] = (limitOrders[signal] ?? 0) + 1;
      for (let f = i + 1; f <= i + 10 && f < c.length; f++) {
        if (c[f].low <= limit) {
          limitFills[signal] = (limitFills[signal] ?? 0) + 1;
          // counted as if the signal day were the day before the fill, so the holding period starts at the fill
          record(signal, p, f - 1, Math.min(limit, c[f].open));
          return;
        }
      }
    };
    for (let i = WARMUP; i < c.length; i++) {
      record("baseline", p, i);
      const snap = snapshotAt(c, series, i);
      const bo15 = volumeBreakoutAt(c, series.volRatio, i, 1.5) != null;
      const bo20 = volumeBreakoutAt(c, series.volRatio, i, 2) != null;
      // entry rating, with the uptrend standing in for a Favourable verdict (verdicts cannot be rebuilt historically)
      const frame = tradeFrame(snap);
      const plan = entryPlan({
        close: c[i].close,
        sma20: series.sma20[i],
        sma20Ago: series.sma20[i - 5],
        atr: series.atr[i],
        rsi: series.rsi[i],
        uptrend: snap.sig_trend,
        favourable: snap.sig_trend,
        freshBreakout: heldBreakout(c, series.volRatio, i, 3),
        recentBreakout: heldBreakout(c, series.volRatio, i, 10),
        breakdown: snap.sig_breakdown,
        target: frame.target,
        stop: frame.stop,
      });
      const cur = { bounce: snap.sig_bounce, trend: snap.sig_trend, breakdown: snap.sig_breakdown, bo15, bo20, rating: plan.rating as string };
      if (i > WARMUP) {
        if (cur.bounce && !prev.bounce) record("bounce", p, i);
        if (cur.trend && !prev.trend) record("trend", p, i);
        if (cur.breakdown && !prev.breakdown) record("breakdown", p, i);
        if (cur.bo15 && !prev.bo15) record("volbo_15", p, i);
        if (cur.bo20 && !prev.bo20) record("volbo_20", p, i);
        if (cur.rating !== prev.rating) {
          if (plan.rating === "Good entry") record("entry_good", p, i);
          // "extended" is only tested inside an uptrend, to compare like with like
          if (plan.rating === "Wait for pullback" || (plan.rating === "Extended, don't chase" && snap.sig_trend)) {
            const id = plan.rating === "Wait for pullback" ? "entry_wait" : "entry_ext";
            record(`${id}_now`, p, i);
            limitFill(`${id}_limit`, i, plan.entry);
          }
        }
      }
      prev = cur;
    }

    // post-result drift: the signal is known at the close of the first session that reacts to the result
    for (const r of s.results) {
      if (r.profitYoY == null) continue;
      const d = new Date(new Date(r.reportedAt).getTime() + 330 * 60000); // IST
      const date = d.toISOString().slice(0, 10);
      const afterClose = d.getUTCHours() * 60 + d.getUTCMinutes() >= 15 * 60 + 30;
      const i = c.findIndex((x) => (afterClose ? x.time > date : x.time >= date));
      if (i < 1) continue;
      const reaction = c[i].close / c[i - 1].close - 1;
      if (reaction > 0 && r.profitYoY > 0) record("drift", p, i);
      if (reaction < 0 && r.profitYoY < 0) record("drift_neg", p, i);
    }
    opts.onProgress?.(s.symbol);
  }

  // 2. cross-sectional pass on rebalance days: state signals
  let rebalances = 0;
  for (let d = WARMUP; d < nifty.length; d += REBALANCE_EVERY) {
    const date = nifty[d].time;
    const here: { p: Prepared; i: number }[] = [];
    for (const p of prepared) {
      const i = p.idx.get(date);
      if (i != null && i >= WARMUP) here.push({ p, i });
    }
    if (here.length < MIN_UNIVERSE) continue;
    rebalances++;
    const rank = (key: "mom12" | "mom6", prefix: string) => {
      const vals = here.filter((x) => x.p[key][x.i] != null).sort((a, b) => (b.p[key][b.i] as number) - (a.p[key][a.i] as number));
      const m = vals.length;
      if (m < MIN_UNIVERSE) return;
      vals.forEach((x, k) => {
        const pct = (k + 0.5) / m;
        if (pct <= 0.1) record(`${prefix}_top10`, x.p, x.i);
        if (pct <= 0.2) record(`${prefix}_top20`, x.p, x.i);
        if (pct <= 0.3) record(`${prefix}_top30`, x.p, x.i);
        if (pct > 0.8) record(`${prefix}_bottom20`, x.p, x.i);
      });
    };
    rank("mom12", "mom12");
    rank("mom6", "mom6");
    const n3 = niftyRet(date, 63);
    const n6 = niftyRet(date, 126);
    for (const { p, i } of here) {
      const hd = p.hiDist[i];
      if (hd != null) {
        if (hd <= 5) record("hi52_5", p, i);
        if (hd <= 10) record("hi52_10", p, i);
        if (hd > 30) record("hi52_far30", p, i);
      }
      const r3 = p.ret63[i];
      if (r3 != null && n3 != null) {
        const x = r3 - n3;
        if (x > 0) record("rs3_0", p, i);
        if (x >= 10) record("rs3_10", p, i);
        if (x >= 20) record("rs3_20", p, i);
      }
      const r6 = p.ret126[i];
      if (r6 != null && n6 != null) {
        const x = r6 - n6;
        if (x > 0) record("rs6_0", p, i);
        if (x >= 10) record("rs6_10", p, i);
        if (x >= 20) record("rs6_20", p, i);
      }
    }
  }

  const first = prepared.reduce((a, p) => (p.c[WARMUP].time < a ? p.c[WARMUP].time : a), "9999");
  const last = nifty[nifty.length - 1]?.time;
  return {
    stats: summarise(t),
    meta: { limitOrders, limitFills, stocks: prepared.length, firstSignalDate: first, lastDate: last, rebalances, costPct: cost, inSampleEnd: IN_SAMPLE_END },
  };
}
