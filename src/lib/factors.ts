/**
 * Factors that the signal research (src/lib/research.ts) found to hold up out-of-sample.
 * The same functions feed the research and the live verdicts, so the two cannot drift apart.
 */

/** Standard deviation of daily returns over (from, to]. Null with fewer than 20 returns. */
export function dailyVol(closes: number[], from: number, to: number): number | null {
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let k = from + 1; k <= to; k++) {
    const r = closes[k] / closes[k - 1] - 1;
    n++;
    s += r;
    s2 += r * r;
  }
  if (n < 20) return null;
  const v = s2 / n - (s / n) ** 2;
  return v > 0 ? Math.sqrt(v) : null;
}

/** 12-1 month momentum: return from 252 to 21 sessions ago, divided by the daily volatility of that stretch. */
export function momentum12(closes: number[], i: number): number | null {
  if (i < 252) return null;
  const v = dailyVol(closes, i - 252, i - 21);
  return v ? (closes[i - 21] / closes[i - 252] - 1) / v : null;
}

/** 6 month momentum: return over the last 126 sessions divided by its daily volatility. */
export function momentum6(closes: number[], i: number): number | null {
  if (i < 126) return null;
  const v = dailyVol(closes, i - 126, i);
  return v ? (closes[i] / closes[i - 126] - 1) / v : null;
}

/** Percent return over the last `back` sessions. */
export function returnOver(closes: number[], i: number, back: number): number | null {
  return i >= back && closes[i - back] > 0 ? (closes[i] / closes[i - back] - 1) * 100 : null;
}

/** Where a value sits in a list, 0 to 100: the share of the other values it beats. */
export function percentileRank(value: number, universe: number[]): number | null {
  if (universe.length < 30) return null;
  let below = 0;
  for (const x of universe) if (x < value) below++;
  return Math.round((below / universe.length) * 1000) / 10;
}
