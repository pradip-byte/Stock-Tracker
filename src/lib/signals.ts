/**
 * Technical indicators, signals and the 0-100 technical score.
 * Everything here is a pure function of daily candles, and every value for
 * day i uses only data up to day i, so the same code can drive the Phase 3
 * backtest without look-ahead.
 */
import { macd as macdOf, rsi as rsiOf, sma } from "./indicators";
import type { Candle, Risk } from "./types";

type Nullable = (number | null)[];

export type Series = {
  rsi: Nullable;
  macd: Nullable;
  macdSignal: Nullable;
  macdHist: Nullable;
  sma20: Nullable;
  sma50: Nullable;
  sma200: Nullable;
  atr: Nullable;
  volRatio: Nullable;
};

export type Snapshot = {
  date: string;
  close: number;
  rsi14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr14: number | null;
  vol_ratio20: number | null;
  hi52: number;
  lo52: number;
  dist_hi52_pct: number;
  dist_lo52_pct: number;
  support: number[];
  resistance: number[];
  sig_bounce: boolean;
  sig_trend: boolean;
  sig_breakdown: boolean;
  spark: number[];
};

export type TechScore = {
  score: number;
  reasons: string[];
  target: number;
  stop: number;
  rewardRisk: number;
  risk: Risk;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number | null) => (n == null ? null : Math.round(n * 10000) / 10000);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Wilder ATR(14) as a series. */
export function atrSeries(c: Candle[], period = 14): Nullable {
  const out: Nullable = new Array(c.length).fill(null);
  let prev = 0;
  let seed = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    if (i <= period) {
      seed += tr;
      if (i === period) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function computeSeries(c: Candle[]): Series {
  const closes = c.map((x) => x.close);
  const m = macdOf(closes);
  const volAvg = sma(c.map((x) => x.volume), 20);
  return {
    rsi: rsiOf(closes),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    atr: atrSeries(c),
    // today's volume against the average of the 20 sessions before it
    volRatio: c.map((x, i) => (i >= 20 && volAvg[i - 1] ? x.volume / (volAvg[i - 1] as number) : null)),
  };
}

/**
 * Support and resistance from swing pivots.
 * A pivot low is a bar whose low is the lowest of the `wing` bars on each side
 * (so it is only confirmed `wing` bars later). Nearby pivots are merged into
 * one level. Returns levels nearest to the close first.
 */
export function pivotLevels(c: Candle[], at: number, lookback = 250, wing = 5) {
  const close = c[at].close;
  const start = Math.max(wing, at - lookback);
  const raw: number[] = [];
  for (let j = start; j <= at - wing; j++) {
    let isLow = true;
    let isHigh = true;
    for (let k = j - wing; k <= j + wing; k++) {
      if (k === j) continue;
      if (c[k].low < c[j].low) isLow = false;
      if (c[k].high > c[j].high) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) raw.push(c[j].low);
    if (isHigh) raw.push(c[j].high);
  }
  raw.sort((a, b) => a - b);
  // merge pivots that sit within 1.5% of each other
  const levels: { price: number; touches: number }[] = [];
  for (const p of raw) {
    const last = levels[levels.length - 1];
    if (last && (p - last.price) / last.price <= 0.015) {
      last.price = (last.price * last.touches + p) / (last.touches + 1);
      last.touches++;
    } else levels.push({ price: p, touches: 1 });
  }
  const support = levels
    .filter((l) => l.price < close)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((l) => r2(l.price));
  const resistance = levels
    .filter((l) => l.price > close)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)
    .map((l) => r2(l.price));
  return { support, resistance };
}

function isReversalCandle(c: Candle[], i: number): boolean {
  const k = c[i];
  const p = c[i - 1];
  const body = Math.abs(k.close - k.open);
  const range = k.high - k.low;
  if (range <= 0) return false;
  const lower = Math.min(k.open, k.close) - k.low;
  const upper = k.high - Math.max(k.open, k.close);
  const hammer = lower >= 2 * body && upper <= range * 0.35;
  const engulfing = p.close < p.open && k.close > k.open && k.close >= p.open && k.open <= p.close;
  const thrust = k.close > k.open && k.close > p.high;
  return hammer || engulfing || thrust;
}

/** Indicator values and signals for day `i`. Needs i >= 1. */
export function snapshotAt(c: Candle[], s: Series, i: number): Snapshot {
  const k = c[i];
  const close = k.close;
  const from = Math.max(0, i - 249);
  let hi52 = -Infinity;
  let lo52 = Infinity;
  for (let j = from; j <= i; j++) {
    if (c[j].high > hi52) hi52 = c[j].high;
    if (c[j].low < lo52) lo52 = c[j].low;
  }
  const { support, resistance } = pivotLevels(c, i);
  const rsi = s.rsi[i];
  const sma50 = s.sma50[i];
  const sma200 = s.sma200[i];
  const volRatio = s.volRatio[i];

  // ── Bounce-back: oversold, sitting on support or the 200 DMA, with a reversal candle or volume pickup
  const nearSupport = support.length > 0 && (close - support[0]) / close <= 0.03;
  const near200 = sma200 != null && Math.abs(close - sma200) / sma200 <= 0.03;
  const sigBounce =
    rsi != null && rsi < 35 && (nearSupport || near200) && (isReversalCandle(c, i) || (volRatio ?? 0) >= 1.5);

  // ── Trend: price > 50 DMA > 200 DMA
  const sigTrend = sma50 != null && sma200 != null && close > sma50 && sma50 > sma200;

  // ── Breakdown warning: lost a support level on volume, fresh close below the 200 DMA,
  //    or a new 20-day closing low inside a downtrend
  const prev = c[i - 1];
  const prevLevels = pivotLevels(c, i - 1).support;
  const lostSupport =
    prevLevels.length > 0 && prev.close >= prevLevels[0] && close < prevLevels[0] * 0.995 && (volRatio ?? 0) >= 1.2;
  const prev200 = s.sma200[i - 1];
  const lost200 = sma200 != null && prev200 != null && prev.close >= prev200 && close < sma200 * 0.99;
  let low20 = true;
  for (let j = Math.max(0, i - 19); j < i; j++) if (c[j].close <= close) low20 = false;
  const downtrendLow = sma50 != null && sma200 != null && close < sma50 && sma50 < sma200 && low20 && i >= 20;
  const sigBreakdown = lostSupport || lost200 || downtrendLow;

  return {
    date: k.time,
    close,
    rsi14: r4(rsi),
    macd: r4(s.macd[i]),
    macd_signal: r4(s.macdSignal[i]),
    macd_hist: r4(s.macdHist[i]),
    sma20: r4(s.sma20[i]),
    sma50: r4(sma50),
    sma200: r4(sma200),
    atr14: r4(s.atr[i]),
    vol_ratio20: volRatio == null ? null : Math.round(volRatio * 1000) / 1000,
    hi52: r2(hi52),
    lo52: r2(lo52),
    dist_hi52_pct: r2(((close - hi52) / hi52) * 100),
    dist_lo52_pct: r2(((close - lo52) / lo52) * 100),
    support,
    resistance,
    sig_bounce: sigBounce,
    sig_trend: sigTrend,
    sig_breakdown: sigBreakdown,
    spark: c.slice(Math.max(0, i - 29), i + 1).map((x) => r2(x.close)),
  };
}

/** Target from the nearest resistance, stop from the nearest support less half an ATR. */
export function tradeFrame(snap: Snapshot) {
  const close = snap.close;
  const atr = snap.atr14 ?? close * 0.02;
  const target = snap.resistance[0] && snap.resistance[0] > close * 1.005 ? snap.resistance[0] : close + 3 * atr;
  const sup = snap.support[0];
  const stop = sup != null && close - sup <= 3 * atr ? sup - 0.5 * atr : close - 2 * atr;
  const rewardRisk = (target - close) / Math.max(close - stop, close * 0.001);
  const atrPct = (atr / close) * 100;
  const risk: Risk = atrPct > 3.5 ? "High" : atrPct > 2.2 ? "Medium" : "Low";
  return { target: r2(target), stop: r2(stop), rewardRisk: r2(clamp(rewardRisk, 0, 20)), risk };
}

/** 0-100 technical score with the plain-English reasons behind it, biggest factors first. */
export function technicalScore(snap: Snapshot, prevHist: number | null, upDay: boolean): TechScore {
  const f: { pts: number; text: string }[] = [];
  const add = (pts: number, text: string) => f.push({ pts, text });
  const { close, sma50, sma200, rsi14: rsi, macd_hist: hist, vol_ratio20: vr } = snap;
  const frame = tradeFrame(snap);

  if (sma50 != null && sma200 != null) {
    if (close > sma50 && sma50 > sma200) add(16, "Uptrend intact: price is above the 50 DMA, which is above the 200 DMA.");
    else if (close < sma50 && sma50 < sma200) add(-14, "Downtrend: price is below the 50 DMA, which is below the 200 DMA.");
    else if (close > sma200) add(5, `Price is ${Math.abs(((close - sma200) / sma200) * 100).toFixed(1)}% above the 200 DMA, but the trend is mixed.`);
    else add(-6, `Price is ${Math.abs(((close - sma200) / sma200) * 100).toFixed(1)}% below the 200 DMA.`);
  } else add(0, "Not enough history for the 200 DMA yet.");

  if (rsi != null) {
    if (rsi < 30) add(4, `RSI is ${rsi.toFixed(0)}: deeply oversold, which often precedes a relief bounce.`);
    else if (rsi < 45) add(0, `RSI is ${rsi.toFixed(0)}: weak momentum.`);
    else if (rsi <= 65) add(5, `RSI is ${rsi.toFixed(0)}: healthy momentum without being stretched.`);
    else if (rsi <= 75) add(2, `RSI is ${rsi.toFixed(0)}: strong, getting warm.`);
    else add(-5, `RSI is ${rsi.toFixed(0)}: overbought, pullback risk is elevated.`);
  }

  if (hist != null) {
    const rising = prevHist != null && hist > prevHist;
    if (hist > 0) add(rising ? 9 : 6, `MACD is above its signal line${rising ? " and widening" : ""}.`);
    else add(rising ? -1 : -6, `MACD is below its signal line${rising ? ", though the gap is closing" : " and falling"}.`);
  }

  if (snap.dist_hi52_pct >= -5) add(6, `Within ${Math.abs(snap.dist_hi52_pct).toFixed(1)}% of the 52-week high.`);
  else if (snap.dist_lo52_pct <= 10 && !snap.sig_bounce) add(-5, `Only ${snap.dist_lo52_pct.toFixed(1)}% above the 52-week low.`);

  if (vr != null && vr >= 1.5) {
    add(upDay ? 5 : -5, `Volume was ${vr.toFixed(1)}x the 20-day average on ${upDay ? "an up" : "a down"} day.`);
  }

  if (snap.sig_bounce) add(14, "Bounce-back setup: oversold at support with a reversal candle or volume pickup.");
  if (snap.sig_breakdown) add(-18, "Breakdown warning: a support level or the 200 DMA has given way.");

  if (frame.rewardRisk >= 2) add(5, `Reward-to-risk is ${frame.rewardRisk.toFixed(1)}x to the next resistance.`);
  else if (frame.rewardRisk < 1) add(-4, `Reward-to-risk is only ${frame.rewardRisk.toFixed(1)}x: resistance is close, support is far.`);

  const score = Math.round(clamp(50 + f.reduce((a, b) => a + b.pts, 0), 0, 100));
  const reasons = f
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, 5)
    .map((x) => x.text);
  return { score, reasons, ...frame };
}
