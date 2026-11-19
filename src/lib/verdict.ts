/**
 * Short-term and long-term verdicts. Pure functions.
 *
 * Both start at a neutral 50 and move by the factors below; each factor that
 * moves the number is also a candidate reason, and the 3-5 biggest are shown.
 *   65 and above  Favourable
 *   45 to 64      Neutral
 *   below 45      Avoid
 * An active breakdown warning caps the short-term verdict at Avoid.
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
  return1y: number | null; // percent
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
  s.push({
    pts: (v.technical - 50) * 0.8,
    text: `Technical score is ${v.technical} out of 100.`,
  });
  if (v.rewardRisk >= 2) s.push({ pts: 6, text: `Reward-to-risk is ${v.rewardRisk.toFixed(1)}x to the next resistance, with the stop under support.` });
  else if (v.rewardRisk < 1) s.push({ pts: -6, text: `Reward-to-risk is only ${v.rewardRisk.toFixed(1)}x: more room to the stop than to the target.` });

  if (v.odds && v.odds.samples >= 8) {
    const o = v.odds;
    const name = o.signal === "Bounce" ? "bounce-back" : o.signal === "Trend" ? "trend" : "breakdown";
    if (o.signal === "Breakdown") {
      s.push({
        pts: -clamp((o.hitRate - 50) * 0.4, 0, 8),
        text: `Breakdown warning is active: after past warnings on ${scopeWord[o.scope]}, the price was lower 20 sessions later ${o.hitRate.toFixed(0)}% of the time (${o.samples} cases).`,
      });
    } else {
      const edge = o.baseline != null ? o.hitRate - o.baseline : o.hitRate - 50;
      s.push({
        pts: clamp(edge * 0.5, -8, 8),
        text: `Measured odds: the ${name} signal on ${scopeWord[o.scope]} was followed by a higher price 20 sessions later ${o.hitRate.toFixed(0)}% of the time (${o.samples} cases${o.baseline != null ? `, against ${o.baseline.toFixed(0)}% for any day` : ""}), average move ${o.avgReturn >= 0 ? "+" : "−"}${Math.abs(o.avgReturn).toFixed(1)}%.`,
      });
    }
  } else if (v.odds) {
    s.push({ pts: 0, text: `The active signal has only ${v.odds.samples} past cases, too few to measure its odds.` });
  }

  if (v.daysToResult != null && v.daysToResult <= 7) {
    s.push({
      pts: -3,
      text: `Results are due in ${v.daysToResult} day${v.daysToResult === 1 ? "" : "s"}${v.resultIsEstimate ? " (estimated date)" : ""}: the price can gap either way.`,
    });
  }
  let shortScore = Math.round(clamp(50 + s.reduce((a, b) => a + b.pts, 0), 0, 100));
  if (v.breakdown) shortScore = Math.min(shortScore, 44);

  // ───────────── long term: one year and beyond ─────────────
  const l: Factor[] = [];
  if (v.sma50 != null && v.sma200 != null) {
    const gap = Math.abs((v.close / v.sma200 - 1) * 100).toFixed(1);
    if (v.close > v.sma200 && v.sma50 > v.sma200) l.push({ pts: 12, text: `Long-term trend is up: price is ${gap}% above the 200 DMA and the 50 DMA is above it too.` });
    else if (v.close < v.sma200 && v.sma50 < v.sma200) l.push({ pts: -12, text: `Long-term trend is down: price is ${gap}% below the 200 DMA and the 50 DMA is below it too.` });
    else l.push({ pts: v.close > v.sma200 ? 3 : -4, text: `Long-term trend is mixed: price is ${gap}% ${v.close > v.sma200 ? "above" : "below"} the 200 DMA.` });
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
  if (v.return1y != null) {
    if (v.return1y > 20) l.push({ pts: 4, text: `Up ${v.return1y.toFixed(0)}% over the past year.` });
    else if (v.return1y < -20) l.push({ pts: -5, text: `Down ${Math.abs(v.return1y).toFixed(0)}% over the past year.` });
  }
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
