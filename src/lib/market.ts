/** NSE session helpers. All times are IST (UTC+5:30, no DST). Exchange holidays are not known here. */
const IST_OFFSET_MIN = 330;
const OPEN_MIN = 9 * 60 + 15;
const CLOSE_MIN = 15 * 60 + 30;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function istParts(d: Date = new Date()) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return {
    date: t.toISOString().slice(0, 10),
    dow: t.getUTCDay(),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    day: t.getUTCDate(),
    month: t.getUTCMonth(),
    hh: String(t.getUTCHours()).padStart(2, "0"),
    mm: String(t.getUTCMinutes()).padStart(2, "0"),
  };
}

export const todayIST = (d?: Date) => istParts(d).date;

export function isMarketOpen(d?: Date): boolean {
  const p = istParts(d);
  return p.dow >= 1 && p.dow <= 5 && p.minutes >= OPEN_MIN && p.minutes <= CLOSE_MIN;
}

/** True on a weekday once the closing auction has settled (15:45 IST). */
export function isAfterClose(d?: Date): boolean {
  const p = istParts(d);
  return p.dow >= 1 && p.dow <= 5 && p.minutes >= CLOSE_MIN + 15;
}

/** "19 NOV 14:21 IST" */
export function fmtIST(iso: string | Date): string {
  const p = istParts(typeof iso === "string" ? new Date(iso) : iso);
  return `${String(p.day).padStart(2, "0")} ${MONTHS[p.month]} ${p.hh}:${p.mm} IST`;
}

/** Exchange timestamp of a daily bar (provider gives the session open in UTC) -> IST calendar date. */
export const istDateOf = (d: Date) => istParts(d).date;

function prevWeekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/**
 * The most recent session we should already have data for, ignoring exchange
 * holidays (so data is flagged stale on a holiday rather than passed off as current).
 * `fromMinutes` is the IST minute of day from which today's data is expected.
 */
export function expectedSession(now: Date, fromMinutes: number): string {
  const p = istParts(now);
  const weekday = p.dow >= 1 && p.dow <= 5;
  return weekday && p.minutes >= fromMinutes ? p.date : prevWeekday(p.date);
}

export type FreshState = "live" | "close" | "eod" | "stale" | "none";

/** Quote freshness: live within 20 minutes during market hours, otherwise must be from the latest session. */
export function quoteState(at: string | null, now: Date): FreshState {
  if (!at) return "none";
  const t = new Date(at);
  if (istParts(t).date < expectedSession(now, 9 * 60 + 30)) return "stale";
  if (isMarketOpen(now)) return now.getTime() - t.getTime() <= 20 * 60000 ? "live" : "stale";
  return "close";
}

/** End-of-day data freshness. `date` is the session the indicators were computed for. */
export function eodState(date: string | null, now: Date): FreshState {
  if (!date) return "none";
  return date >= expectedSession(now, 17 * 60 + 30) ? "eod" : "stale";
}
