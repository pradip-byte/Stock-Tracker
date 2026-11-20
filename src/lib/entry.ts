/**
 * Entry rating: is this a sensible price to act on the short-term view?
 * Pure functions of daily data up to the close, shared by the live scores and
 * the research backtest.
 *
 *  Extended, don't chase   more than 3 ATR above the 20 DMA, or RSI above 75
 *  Good entry              uptrend, reward-to-risk of 2 or more, and either within
 *                          1 ATR of a rising 20 DMA or a volume breakout in the last 3 sessions
 *  Wait for pullback       short-term verdict is Favourable but price is more than 2 ATR
 *                          above the 20 DMA; a limit price and stop are suggested
 *  No setup                everything else
 *
 * Checked in that order. This describes price position only. It is not advice.
 */
import type { Candle } from "./types";

export const ENTRY_RATINGS = ["Good entry", "Wait for pullback", "Extended, don't chase", "No setup"] as const;
export type EntryRating = (typeof ENTRY_RATINGS)[number];

export type EntryInput = {
  close: number;
  sma20: number | null;
  /** The 20 DMA five sessions earlier, to tell whether it is rising. */
  sma20Ago: number | null;
  atr: number | null;
  rsi: number | null;
  /** Price above the 50 DMA, which is above the 200 DMA. */
  uptrend: boolean;
  /** Short-term verdict is Favourable. The backtest, which has no verdicts, passes the uptrend instead. */
  favourable: boolean;
  /** Level of a volume breakout in the last 3 sessions that the close still holds above. */
  freshBreakout: number | null;
  /** Level of a volume breakout in the last 10 sessions that the close still holds above. */
  recentBreakout: number | null;
  /** Target and stop of the standard trade frame (nearest resistance, support less half an ATR). */
  target: number;
  stop: number;
};

export type EntryPlan = {
  rating: EntryRating;
  /** Suggested entry: the last close for an entry now, or a limit price to wait for. */
  entry: number;
  entryKind: "now" | "limit";
  stop: number;
  target: number;
  rewardRisk: number | null;
  /** How far the close sits from the 20 DMA, in ATRs. */
  atrFrom20: number | null;
  note: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const rr = (entry: number, stop: number, target: number) => (stop < entry && target > entry ? r2(Math.min(20, (target - entry) / (entry - stop))) : null);

export function entryPlan(v: EntryInput): EntryPlan {
  const { close, sma20, atr } = v;
  const now = (rating: EntryRating, note: string): EntryPlan => ({
    rating,
    entry: r2(close),
    entryKind: "now",
    stop: v.stop,
    target: v.target,
    rewardRisk: rr(close, v.stop, v.target),
    atrFrom20: dist == null ? null : r2(dist),
    note,
  });
  const dist = sma20 != null && atr ? (close - sma20) / atr : null;
  if (sma20 == null || !atr || dist == null) return now("No setup", "Not enough history for the 20 DMA and ATR.");

  // a limit to wait for: the breakout level if there was a recent one above the 20 DMA, otherwise the 20 DMA
  const limit = v.recentBreakout != null && v.recentBreakout > sma20 && v.recentBreakout < close ? v.recentBreakout : sma20;
  const limitIs = limit === sma20 ? "the 20 DMA" : "the breakout level";
  const waitPlan = (rating: EntryRating, note: string): EntryPlan => {
    const entry = Math.min(limit, close);
    const stop = entry - 1.5 * atr;
    // if the usual target is not meaningfully above the limit, use three ATRs from the limit
    const target = v.target > entry + atr ? v.target : entry + 3 * atr;
    return { rating, entry: r2(entry), entryKind: "limit", stop: r2(stop), target: r2(target), rewardRisk: rr(entry, stop, target), atrFrom20: r2(dist), note };
  };

  if (dist > 3 || (v.rsi != null && v.rsi > 75)) {
    const why = dist > 3 ? `Price is ${dist.toFixed(1)} ATR above the 20 DMA` : `RSI is ${v.rsi!.toFixed(0)}`;
    return waitPlan("Extended, don't chase", `${why}. If it pulls back, ${limitIs} is the level to watch.`);
  }

  const nowRR = rr(close, v.stop, v.target);
  const near20 = v.sma20Ago != null && sma20 > v.sma20Ago && Math.abs(dist) <= 1;
  if (v.uptrend && nowRR != null && nowRR >= 2 && (near20 || v.freshBreakout != null)) {
    return now(
      "Good entry",
      near20
        ? `Uptrend, price within ${Math.abs(dist).toFixed(1)} ATR of a rising 20 DMA, reward-to-risk ${nowRR.toFixed(1)}x.`
        : `Uptrend with a volume breakout in the last 3 sessions, reward-to-risk ${nowRR.toFixed(1)}x.`,
    );
  }

  if (v.favourable && dist > 2) {
    return waitPlan("Wait for pullback", `Price is ${dist.toFixed(1)} ATR above the 20 DMA. A limit at ${limitIs} gives a better reward-to-risk.`);
  }

  const why = !v.uptrend
    ? "Not in an uptrend (price above the 50 DMA above the 200 DMA)."
    : nowRR == null || nowRR < 2
      ? `Reward-to-risk is ${nowRR == null ? "not defined" : `${nowRR.toFixed(1)}x`}, below 2.`
      : "Price is neither near a rising 20 DMA nor on a fresh breakout.";
  return now("No setup", why);
}

/**
 * Volume breakout on day i: close above the highest close of the prior 50 sessions,
 * volume at least `mult` times the 20-day average, close in the top third of the day's range.
 * Returns the level that was broken (the prior 50-session closing high), or null.
 */
export function volumeBreakoutAt(c: Candle[], volRatio: (number | null)[], i: number, mult = 1.5): number | null {
  if (i < 50) return null;
  const vr = volRatio[i];
  if (vr == null || vr < mult) return null;
  const range = c[i].high - c[i].low;
  if (!(range > 0) || (c[i].close - c[i].low) / range < 2 / 3) return null;
  let hi = 0;
  for (let k = i - 50; k < i; k++) if (c[k].close > hi) hi = c[k].close;
  return c[i].close > hi ? hi : null;
}

/** The most recent breakout level within `lookback` sessions (today included) that the close still holds above. */
export function heldBreakout(c: Candle[], volRatio: (number | null)[], i: number, lookback: number): number | null {
  for (let k = i; k > i - lookback && k >= 50; k--) {
    const level = volumeBreakoutAt(c, volRatio, k);
    if (level != null) return c[i].close > level ? level : null;
  }
  return null;
}
