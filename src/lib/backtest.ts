/**
 * Signal backtest over a stock's full daily history.
 *
 * An "event" is the first day a signal switches on (it was off the day before),
 * so a trend that stays on for 200 sessions counts once, not 200 times.
 * For each event we look at the close 5, 20 and 60 trading days later.
 *
 *  Bounce, Trend:  a hit means the price was HIGHER after the holding period.
 *  Breakdown:      a hit means the price was LOWER (the warning was right).
 *  Baseline:       every day in the same history, so each number can be compared
 *                  with what buying on any random day would have done.
 *
 * Signals for day i are computed from data up to day i only (see signals.ts),
 * and returns are close-to-close with no costs or slippage.
 */
import { computeSeries, snapshotAt } from "./signals";
import type { Candle } from "./types";

export const HORIZONS = [5, 20, 60] as const;
export const BT_SIGNALS = ["Bounce", "Trend", "Breakdown", "Baseline"] as const;
export type BtSignal = (typeof BT_SIGNALS)[number];
export type Horizon = (typeof HORIZONS)[number];

/** Running totals, so stocks can be pooled into sectors and the whole universe. */
export type Tally = { samples: number; hits: number; sumReturn: number };
export type BacktestResult = Record<BtSignal, Record<Horizon, Tally>>;

const WARMUP = 260; // sessions needed before the 200 DMA, 52-week range and pivots are meaningful

export function emptyResult(): BacktestResult {
  const out = {} as BacktestResult;
  for (const s of BT_SIGNALS) {
    out[s] = {} as Record<Horizon, Tally>;
    for (const h of HORIZONS) out[s][h] = { samples: 0, hits: 0, sumReturn: 0 };
  }
  return out;
}

export function addInto(target: BacktestResult, src: BacktestResult) {
  for (const s of BT_SIGNALS) {
    for (const h of HORIZONS) {
      target[s][h].samples += src[s][h].samples;
      target[s][h].hits += src[s][h].hits;
      target[s][h].sumReturn += src[s][h].sumReturn;
    }
  }
}

export function backtestStock(candles: Candle[]): BacktestResult {
  const out = emptyResult();
  const n = candles.length;
  if (n < WARMUP + 10) return out;
  const series = computeSeries(candles);
  const record = (signal: BtSignal, i: number) => {
    for (const h of HORIZONS) {
      if (i + h >= n) continue; // the holding period has not finished yet
      const ret = (candles[i + h].close / candles[i].close - 1) * 100;
      const t = out[signal][h];
      t.samples++;
      t.sumReturn += ret;
      if (signal === "Breakdown" ? ret < 0 : ret > 0) t.hits++;
    }
  };
  let prev = { bounce: false, trend: false, breakdown: false };
  for (let i = WARMUP; i < n; i++) {
    const s = snapshotAt(candles, series, i);
    const cur = { bounce: s.sig_bounce, trend: s.sig_trend, breakdown: s.sig_breakdown };
    if (i > WARMUP) {
      if (cur.bounce && !prev.bounce) record("Bounce", i);
      if (cur.trend && !prev.trend) record("Trend", i);
      if (cur.breakdown && !prev.breakdown) record("Breakdown", i);
    }
    record("Baseline", i);
    prev = cur;
  }
  return out;
}

export type BacktestRow = {
  scope: "stock" | "sector" | "all";
  scope_key: string;
  signal: BtSignal;
  horizon_days: Horizon;
  samples: number;
  hit_rate: number | null;
  avg_return: number | null;
};

export function toRows(scope: BacktestRow["scope"], key: string, r: BacktestResult): BacktestRow[] {
  const rows: BacktestRow[] = [];
  for (const s of BT_SIGNALS) {
    for (const h of HORIZONS) {
      const t = r[s][h];
      rows.push({
        scope,
        scope_key: key,
        signal: s,
        horizon_days: h,
        samples: t.samples,
        hit_rate: t.samples ? Math.round((t.hits / t.samples) * 1000) / 10 : null,
        avg_return: t.samples ? Math.round((t.sumReturn / t.samples) * 100) / 100 : null,
      });
    }
  }
  return rows;
}

/** Rebuild running totals from stored rows (used to pool stocks into sectors). */
export function fromRows(rows: Pick<BacktestRow, "signal" | "horizon_days" | "samples" | "hit_rate" | "avg_return">[]): BacktestResult {
  const out = emptyResult();
  for (const r of rows) {
    const t = out[r.signal]?.[r.horizon_days];
    if (!t || !r.samples) continue;
    t.samples += r.samples;
    t.hits += Math.round(((r.hit_rate ?? 0) / 100) * r.samples);
    t.sumReturn += (r.avg_return ?? 0) * r.samples;
  }
  return out;
}
