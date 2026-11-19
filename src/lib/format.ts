/** Indian-grouped number: 1,23,456.78 */
export function inr(n: number, decimals = 2): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function pct(n: number, decimals = 2): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(decimals)}%`;
}

export function changePct(price: number, prevClose: number): number {
  return prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
}

/** Compact crore figure: 12,340 -> "12.3K Cr" */
export function crore(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-11-19" -> "19 NOV" (timezone-safe: parses the date part only) */
export function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
}

export function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export const toneOf = (n: number) => (n > 0 ? "text-gain" : n < 0 ? "text-loss" : "text-steel");
