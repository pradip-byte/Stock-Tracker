/**
 * Results analysis: growth, margins, post-result price reaction and the 0-100
 * event score. Pure functions. A value that cannot be computed from the data
 * on hand is null, never estimated.
 */
import { istParts } from "./market";
import type { Candle, Quarter } from "./types";

export type RawQuarter = {
  periodEnd: string;
  revenue: number | null;
  netProfit: number | null;
  eps: number | null;
  epsEstimate: number | null;
  reportedAt: string | null;
  reaction1d: number | null;
  reaction5d: number | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const CRORE = 1e7;

/** Indian fiscal year runs April to March: the quarter ending 30 Sep 2026 is Q2 FY27. */
export function fiscalLabel(periodEnd: string): string {
  const y = +periodEnd.slice(0, 4);
  const m = +periodEnd.slice(5, 7);
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  const fy = m <= 3 ? y : y + 1;
  return `Q${q} FY${String(fy).slice(2)}`;
}

function shiftMonths(periodEnd: string, months: number): string {
  const y = +periodEnd.slice(0, 4);
  const m = +periodEnd.slice(5, 7) + months;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const growth = (now: number | null, then: number | null): number | null =>
  now == null || then == null || then <= 0 ? null : r1((now / then - 1) * 100);

/** Adds YoY and QoQ growth and net margin. Growth needs the exact comparison quarter to be present. */
export function analyseQuarters(raw: RawQuarter[]): Quarter[] {
  const sorted = [...raw].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const byMonth = new Map(sorted.map((q) => [q.periodEnd.slice(0, 7), q]));
  return sorted.map((q) => {
    const yearAgo = byMonth.get(shiftMonths(q.periodEnd, -12));
    const prev = byMonth.get(shiftMonths(q.periodEnd, -3));
    return {
      periodEnd: q.periodEnd,
      label: fiscalLabel(q.periodEnd),
      revenue: q.revenue == null ? null : q.revenue / CRORE,
      profit: q.netProfit == null ? null : q.netProfit / CRORE,
      margin: q.revenue && q.netProfit != null ? r1((q.netProfit / q.revenue) * 100) : null,
      revenueYoY: growth(q.revenue, yearAgo?.revenue ?? null),
      profitYoY: growth(q.netProfit, yearAgo?.netProfit ?? null),
      revenueQoQ: growth(q.revenue, prev?.revenue ?? null),
      profitQoQ: growth(q.netProfit, prev?.netProfit ?? null),
      resultDate: q.reportedAt ? istParts(new Date(q.reportedAt)).date : null,
      reaction1d: q.reaction1d,
      reaction5d: q.reaction5d,
      epsSurprisePct:
        q.eps != null && q.epsEstimate ? r1(((q.eps - q.epsEstimate) / Math.abs(q.epsEstimate)) * 100) : null,
    };
  });
}

/**
 * Price move after a result. If it was announced after the 15:30 close, the
 * reaction starts on the next session; otherwise on the same day.
 * Both figures are measured from the last close before the reaction.
 */
export function postResultReaction(candles: Candle[], reportedAt: string): { d1: number | null; d5: number | null } {
  const p = istParts(new Date(reportedAt));
  const afterClose = p.minutes >= 15 * 60 + 30;
  const i = candles.findIndex((c) => (afterClose ? c.time > p.date : c.time >= p.date));
  if (i < 1) return { d1: null, d5: null };
  const base = candles[i - 1].close;
  const pct = (c: Candle | undefined) => (c ? Math.round((c.close / base - 1) * 1000) / 10 : null);
  return { d1: pct(candles[i]), d5: pct(candles[i + 4]) };
}

/** 0-100 event score from the growth trend and how the stock has reacted to past results. */
export function eventScore(quarters: Quarter[]): { score: number | null; reasons: string[] } {
  const usable = quarters.filter((q) => q.revenue != null && q.profit != null);
  if (usable.length < 2) {
    return { score: null, reasons: ["Not enough quarterly results from the data provider to score this stock."] };
  }
  const f: { pts: number; text: string }[] = [];
  const add = (pts: number, text: string) => f.push({ pts, text });
  const last = usable[usable.length - 1];

  if (last.revenueYoY != null) {
    const g = last.revenueYoY;
    add(g > 15 ? 12 : g > 5 ? 6 : g >= 0 ? 2 : -8, `Revenue ${g >= 0 ? "grew" : "fell"} ${Math.abs(g)}% year on year in ${last.label}.`);
  }
  if (last.profit != null && last.profit < 0) add(-8, `Loss-making in ${last.label}.`);
  else if (last.profitYoY != null) {
    const g = last.profitYoY;
    add(g > 20 ? 14 : g > 5 ? 7 : g >= 0 ? 2 : -10, `Net profit ${g >= 0 ? "grew" : "fell"} ${Math.abs(g)}% year on year in ${last.label}.`);
  }
  if (last.revenueYoY == null && last.profitYoY == null) {
    add(0, "Year-on-year growth is not available: the year-ago quarter is missing from the data.");
  }

  const seq = usable.slice(-3).map((q) => q.revenueQoQ).filter((g): g is number => g != null);
  if (seq.length >= 2) {
    if (seq.every((g) => g > 0)) add(5, `Revenue has risen quarter on quarter for the last ${seq.length} quarters.`);
    else if (seq.every((g) => g < 0)) add(-6, `Revenue has fallen quarter on quarter for the last ${seq.length} quarters.`);
  }

  const earlier = usable.slice(0, -1).map((q) => q.margin).filter((m): m is number => m != null);
  if (last.margin != null && earlier.length) {
    const avg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const diff = last.margin - avg;
    if (diff > 1) add(5, `Net margin widened to ${last.margin}% from an average of ${r1(avg)}%.`);
    else if (diff < -1) add(-5, `Net margin narrowed to ${last.margin}% from an average of ${r1(avg)}%.`);
  }

  const reactions = quarters.map((q) => q.reaction1d).filter((x): x is number => x != null);
  if (reactions.length >= 2) {
    const avg = reactions.reduce((a, b) => a + b, 0) / reactions.length;
    const ups = reactions.filter((x) => x > 0).length;
    const text = `The stock rose after ${ups} of the last ${reactions.length} results, averaging ${avg >= 0 ? "+" : "−"}${Math.abs(r1(avg))}% on the day.`;
    add(avg > 1.5 ? 8 : avg < -1.5 ? -8 : ups > reactions.length / 2 ? 3 : ups < reactions.length / 2 ? -3 : 0, text);
  }

  const surprises = quarters.map((q) => q.epsSurprisePct).filter((x): x is number => x != null);
  if (surprises.length >= 2) {
    const beats = surprises.filter((x) => x > 0).length;
    add(beats > surprises.length / 2 ? 4 : beats < surprises.length / 2 ? -4 : 0, `EPS beat analyst estimates in ${beats} of the last ${surprises.length} quarters.`);
  }

  const score = Math.round(Math.min(100, Math.max(0, 50 + f.reduce((a, b) => a + b.pts, 0))));
  const reasons = f
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, 5)
    .map((x) => x.text);
  return { score, reasons };
}
