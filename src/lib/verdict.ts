/**
 * Short-term and long-term verdicts. Pure functions.
 *
 * Both start at a neutral 50 and move by the factors below; each factor that
 * moves the number is also a candidate reason, and the 3-5 biggest are shown.
 *   65 and above  Favourable
 *   45 to 64      Neutral
 *   below 45      Avoid
 *
 * The weights follow the Phase 5 signal research (npm run research), which tested
 * each signal against buying on any random day, after costs, with 2023 onward held out:
 *  - 12-1 month momentum rank held up out-of-sample, so it carries real weight.
 *  - 6 month relative strength held up at longer horizons: a small long-term credit.
 *  - The trend signal showed no edge: no credit.
 *  - The bounce signal beat same-month peers over about a week but not the market: a small credit.
 *  - The breakdown warning did not predict lower prices: a small penalty and a risk flag,
 *    no forced Avoid.
 *  - Trend and breakout setups did worse when Nifty 50 was below its 200 DMA, in both
 *    periods: a positive technical score earns no credit then.
 *
 * These are mechanical readings of price history and reported numbers.
 * They are not predictions and not investment advice.
 */
import type { Risk, SignalKind, Verdict } from "./types";

export type SignalOdds = {
  signal: SignalKind;
  horizon: 20;
  hitRate: number; // percent
  avgReturn: number; // percent
  samples: number;
  scope: "stock" | "sector" | "all";
  baseline: number | null; // hit rate of any day, same scope
};

export type VerdictInput = {
  close: number;
  technical: number;
  bounce: boolean;
  trend: boolean;
  breakdown: boolean;
  rewardRisk: number;
  atrRisk: Risk;
  sma50: number | null;
  sma200: number | null;
  distHi52: number;
  return1y: number | null; // percent (shown, no longer scored)
  /** 12-1 month momentum rank among tracked stocks, 0 to 100. */
  momRank: number | null;
  /** 6 month return minus Nifty 50's, percentage points. */
  rs6: number | null;
  /** Nifty 50 above its 200 DMA. Null when unknown. */
  marketUp: boolean | null;
  event: number | null;
  external: number | null;
  roe: number | null;
  debtToEquity: number | null;
  pe: number | null;
  isFinancial: boolean;
  daysToResult: number | null;
  resultIsEstimate: boolean;
  odds: SignalOdds | null;
};

export type VerdictOutput = {
  shortVerdict: Verdict;
  longVerdict: Verdict;
  shortScore: number;
  longScore: number;
  overall: number;
  risk: Risk;
  shortReasons: string[];
  longReasons: string[];
  odds: SignalOdds | null;
};

type Factor = { pts: number; text: string };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toVerdict = (score: number): Verdict => (score >= 65 ? "Favourable" : score >= 45 ? "Neutral" : "Avoid");
const top = (f: Factor[], n = 5) =>
  f
    .filter((x) => x.text)
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, n)
    .map((x) => x.text);
const scopeWord = { stock: "this stock", sector: "its sector", all: "all tracked stocks" };

export function computeVerdict(v: VerdictInput): VerdictOutput {
  // ───────────── short term: days to weeks ─────────────
  const s: Factor[] = [];
  const techPts = (v.technical - 50) * 0.4;
  if (v.marketUp === false && techPts > 0) {
    s.push({
      pts: 0.01,
      text: `Technical score is ${v.technical} out of 100, but Nifty 50 is below its 200 DMA: trend and breakout setups have not paid in that condition, so it earns no credit.`,
    });
  } else s.push({ pts: techPts, text: `Technical score is ${v.technical} out of 100.` });
  if (v.rewardRisk >= 2) s.push({ pts: 6, text: `Reward-to-risk is ${v.rewardRisk.toFixed(1)}x to the next resistance, with the stop under support.` });
  else if (v.rewardRisk < 1) s.push({ pts: -6, text: `Reward-to-risk is only ${v.rewardRisk.toFixed(1)}x: more room to the stop than to the target.` });

  if (v.momRank != null) {
    if (v.momRank >= 80) s.push({ pts: 4, text: `12-month momentum is in the top ${Math.max(1, Math.round(100 - v.momRank))}% of tracked stocks, the one factor that kept an edge in testing.` });
    else if (v.momRank < 20) s.push({ pts: -4, text: `12-month momentum is in the bottom ${Math.max(1, Math.round(v.momRank))}% of tracked stocks: weak momentum has lagged in testing.` });
  }

  if (v.bounce) {
    s.push({ pts: 3, text: "Bounce signal is active. In testing it beat other stocks over the next week by about 0.8%, but not the market after costs." });
  } else if (v.breakdown) {
    s.push({ pts: -3, text: "Breakdown warning is active. In testing it did not predict lower prices, so it is a risk flag rather than a sell call." });
  } else if (v.trend) {
    s.push({ pts: 0.01, text: "Trend signal is active. In testing it showed no edge over buying on any day, so it earns no credit." });
  }

  if (v.daysToResult != null && v.daysToResult <= 7) {
    s.push({
      pts: -3,
      text: `Results are due in ${v.daysToResult} day${v.daysToResult === 1 ? "" : "s"}${v.resultIsEstimate ? " (estimated date)" : ""}: the price can gap either way.`,
    });
  }
  const shortScore = Math.round(clamp(50 + s.reduce((a, b) => a + b.pts, 0), 0, 100));

  // ───────────── long term: one year and beyond ─────────────
  const l: Factor[] = [];
  if (v.sma50 != null && v.sma200 != null) {
    const gap = Math.abs((v.close / v.sma200 - 1) * 100).toFixed(1);
    if (v.close > v.sma200 && v.sma50 > v.sma200) l.push({ pts: 6, text: `Long-term trend is up: price is ${gap}% above the 200 DMA and the 50 DMA is above it too.` });
    else if (v.close < v.sma200 && v.sma50 < v.sma200) l.push({ pts: -6, text: `Long-term trend is down: price is ${gap}% below the 200 DMA and the 50 DMA is below it too.` });
    else l.push({ pts: v.close > v.sma200 ? 2 : -2, text: `Long-term trend is mixed: price is ${gap}% ${v.close > v.sma200 ? "above" : "below"} the 200 DMA.` });
  } else l.push({ pts: 0, text: "Less than 200 sessions of history, so there is no long-term trend reading yet." });

  if (v.event != null) l.push({ pts: (v.event - 50) * 0.4, text: `Event score is ${v.event} out of 100 (results growth, margins and past post-result moves).` });
  else l.push({ pts: 0, text: "No reliable quarterly results to judge the business trend." });

  if (v.roe != null) {
    if (v.roe >= 18) l.push({ pts: 8, text: `Return on equity is ${v.roe.toFixed(1)}%, which is high.` });
    else if (v.roe >= 12) l.push({ pts: 4, text: `Return on equity is ${v.roe.toFixed(1)}%.` });
    else if (v.roe < 8) l.push({ pts: -6, text: `Return on equity is ${v.roe.toFixed(1)}%, which is low.` });
  }
  if (v.debtToEquity != null && !v.isFinancial) {
    if (v.debtToEquity > 2) l.push({ pts: -6, text: `Debt is ${v.debtToEquity.toFixed(1)}x equity, which is heavy.` });
    else if (v.debtToEquity < 0.5) l.push({ pts: 3, text: `Debt is light at ${v.debtToEquity.toFixed(2)}x equity.` });
  }
  if (v.pe != null) {
    if (v.pe > 80) l.push({ pts: -5, text: `Trailing P/E is ${v.pe.toFixed(0)}x: a lot of growth is already priced in.` });
    else if (v.pe > 0 && v.pe < 25 && (v.event ?? 0) >= 55) l.push({ pts: 3, text: `Trailing P/E is ${v.pe.toFixed(0)}x with results trending well.` });
  }
  if (v.momRank != null) {
    const topPct = Math.max(1, Math.round(100 - v.momRank));
    if (v.momRank >= 90) l.push({ pts: 10, text: `12-month momentum (leaving out the latest month) is in the top ${topPct}% of tracked stocks. This was the strongest factor in testing, in and out of sample.` });
    else if (v.momRank >= 80) l.push({ pts: 7, text: `12-month momentum (leaving out the latest month) is in the top ${topPct}% of tracked stocks, a factor that held up in testing.` });
    else if (v.momRank >= 70) l.push({ pts: 4, text: `12-month momentum is in the top ${topPct}% of tracked stocks.` });
    else if (v.momRank < 20) l.push({ pts: -7, text: `12-month momentum is in the bottom ${Math.max(1, Math.round(v.momRank))}% of tracked stocks: the weakest fifth lagged in testing.` });
  } else l.push({ pts: 0, text: "Less than a year of history, so there is no momentum ranking yet." });
  if (v.rs6 != null && v.rs6 >= 20) l.push({ pts: 3, text: `Beat Nifty 50 by ${v.rs6.toFixed(0)} points over six months.` });
  if (v.external != null) l.push({ pts: (v.external - 50) * 0.25, text: `External score is ${v.external} out of 100 (news, guidance and sector outlook).` });
  const longScore = Math.round(clamp(50 + l.reduce((a, b) => a + b.pts, 0), 0, 100));

  // ───────────── overall score: weighted mean of the scores that exist ─────────────
  const parts: [number | null, number][] = [
    [v.technical, 0.45],
    [v.event, 0.3],
    [v.external, 0.25],
  ];
  const have = parts.filter(([x]) => x != null) as [number, number][];
  const overall = Math.round(have.reduce((a, [x, w]) => a + x * w, 0) / have.reduce((a, [, w]) => a + w, 0));

  // ───────────── risk: volatility, raised by an imminent result or a breakdown ─────────────
  const order: Risk[] = ["Low", "Medium", "High"];
  let level = order.indexOf(v.atrRisk);
  if (v.breakdown) level = 2;
  else if (v.daysToResult != null && v.daysToResult <= 7) level = Math.min(2, level + 1);

  return {
    shortVerdict: toVerdict(shortScore),
    longVerdict: toVerdict(longScore),
    shortScore,
    longScore,
    overall,
    risk: order[level],
    shortReasons: top(s),
    longReasons: top(l),
    odds: v.odds,
  };
}
