/**
 * Market regime label from four inputs. Pure function.
 *
 *   Nifty 50 against its 200 DMA      above +1, below -1
 *   Breadth: stocks above 200 DMA     60% or more +1, 40% or less -1
 *   India VIX level                   under 15 +1, over 20 -1
 *   India VIX against its 20-day avg  10% or more below +1, 10% or more above -1
 *
 * Total of +2 or more is Risk-on, -2 or less is Risk-off, otherwise Neutral.
 *
 * The thresholds are conventional round numbers, not fitted to data. The signal
 * research found that market regime did NOT give a consistent answer across
 * periods, so the label is context for reading the page, and the only rule that
 * acts on it is the narrow one in verdict.ts (no trend credit below the 200 DMA).
 */

export type Regime = "Risk-on" | "Neutral" | "Risk-off";

export type RegimeInput = { key: string; label: string; value: string; points: number; note: string };

export type RegimeRead = { regime: Regime; score: number; inputs: RegimeInput[] };

export function regimeOf(v: {
  nifty: number | null;
  niftySma200: number | null;
  breadth200: number | null;
  vix: number | null;
  vixSma20: number | null;
}): RegimeRead | null {
  const inputs: RegimeInput[] = [];
  if (v.nifty != null && v.niftySma200 != null) {
    const gap = (v.nifty / v.niftySma200 - 1) * 100;
    inputs.push({
      key: "trend",
      label: "Nifty 50 vs 200 DMA",
      value: `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)}%`,
      points: gap > 0 ? 1 : -1,
      note: gap > 0 ? "Above its 200 DMA." : "Below its 200 DMA.",
    });
  }
  if (v.breadth200 != null) {
    inputs.push({
      key: "breadth",
      label: "Stocks above 200 DMA",
      value: `${v.breadth200.toFixed(0)}%`,
      points: v.breadth200 >= 60 ? 1 : v.breadth200 <= 40 ? -1 : 0,
      note: v.breadth200 >= 60 ? "Broad participation." : v.breadth200 <= 40 ? "Most stocks are below their long-term average." : "Mixed participation.",
    });
  }
  if (v.vix != null) {
    inputs.push({
      key: "vix",
      label: "India VIX",
      value: v.vix.toFixed(1),
      points: v.vix < 15 ? 1 : v.vix > 20 ? -1 : 0,
      note: v.vix < 15 ? "Low expected volatility." : v.vix > 20 ? "High expected volatility." : "Middling expected volatility.",
    });
  }
  if (v.vix != null && v.vixSma20 != null && v.vixSma20 > 0) {
    const d = (v.vix / v.vixSma20 - 1) * 100;
    inputs.push({
      key: "vixTrend",
      label: "VIX vs its 20-day average",
      value: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}%`,
      points: d <= -10 ? 1 : d >= 10 ? -1 : 0,
      note: d <= -10 ? "Volatility is easing." : d >= 10 ? "Volatility is rising." : "Volatility is steady.",
    });
  }
  // the label needs the trend input and at least two others
  if (inputs.length < 3 || !inputs.some((i) => i.key === "trend")) return null;
  const score = inputs.reduce((a, i) => a + i.points, 0);
  return { regime: score >= 2 ? "Risk-on" : score <= -2 ? "Risk-off" : "Neutral", score, inputs };
}

export const MACRO_SERIES = [
  { id: "BRENT", provider: "BZ=F", label: "Brent crude", unit: "$" },
  { id: "USDINR", provider: "INR=X", label: "USD/INR", unit: "₹" },
  { id: "SPX", provider: "^GSPC", label: "S&P 500", unit: "" },
  { id: "US10Y", provider: "^TNX", label: "US 10-year yield", unit: "%" },
] as const;
export type MacroSeriesId = (typeof MACRO_SERIES)[number]["id"];

export const MACRO_CATEGORIES = ["Geopolitics", "US politics and policy", "US Federal Reserve", "RBI", "Crude oil", "FII/DII flows", "Other"] as const;

export type SectorEffect = { sector: string; why: string };
export type SectorMove = { d1: number | null; d5: number | null; d20: number | null; stocks: number };

export type MacroEvent = {
  id: number;
  eventDate: string;
  title: string;
  category: string;
  summary: string;
  url: string;
  published: string;
  helped: SectorEffect[];
  hurt: SectorEffect[];
  nifty: { d1: number | null; d5: number | null; d20: number | null };
  sectorMoves: Record<string, SectorMove>;
};

export type SectorMacroItem = { event: MacroEvent; effect: "helps" | "hurts"; why: string; move: SectorMove | null };

export type MacroPoint = { value: number; date: string; chg1: number | null; chg20: number | null };

export type MacroView = {
  date: string | null;
  regime: Regime | null;
  score: number | null;
  inputs: RegimeInput[];
  breadth50: number | null;
  breadth200: number | null;
  breadthCount: number | null;
  series: { id: string; label: string; unit: string; point: MacroPoint | null }[];
  note: { runAt: string; summary: string; lowGrade: boolean; flows: { fii: string; dii: string; period: string; url: string | null } | null } | null;
  events: MacroEvent[];
};
