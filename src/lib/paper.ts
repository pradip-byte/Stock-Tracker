/**
 * Paper trading maths. Pure functions; no real orders exist anywhere in this app.
 *
 * Costs: the round-trip cost setting is split in two. Half is charged on the
 * amount at entry and half on the value at exit, so an open trade's return
 * already includes what it would cost to get out.
 */

export type PaperBook = "mine" | "shadow";
export type PaperHorizon = "ST" | "LT";
export type PaperStatus = "pending" | "open" | "closing" | "closed" | "cancelled" | "expired";

export type PaperContext = {
  shortVerdict?: string | null;
  longVerdict?: string | null;
  shortScore?: number | null;
  longScore?: number | null;
  technical?: number | null;
  event?: number | null;
  external?: number | null;
  overall?: number | null;
  entryRating?: string | null;
  signal?: string | null; // Bounce, Breakdown, Trend or null
  momRank?: number | null;
  marketUp?: boolean | null;
  regime?: string | null; // Risk-on / Neutral / Risk-off, once the macro view exists
  price?: number | null; // last price seen when the trade was requested (not the fill)
};

export type PaperTrade = {
  id: number;
  book: PaperBook;
  horizon: PaperHorizon;
  symbol: string;
  status: PaperStatus;
  amount: number;
  requestedAt: string;
  fillRule: "quote" | "open" | "limit";
  /** "limit" is a shadow order resting at a suggested pullback price. */
  variant: "market" | "limit";
  limitPrice: number | null;
  limitSessions: number | null;
  entryAt: string | null;
  entryPrice: number | null;
  qty: number | null;
  niftyEntry: number | null;
  target: number | null;
  stop: number | null;
  maxSessions: number | null;
  closeRequestedAt: string | null;
  exitAt: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  niftyExit: number | null;
  costPct: number;
  pnlInr: number | null;
  pnlPct: number | null;
  flag: string | null;
  context: PaperContext;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Profit or loss of a filled trade at a given price, after both halves of the cost. */
export function pnlAt(t: { amount: number; qty: number; entryPrice: number; costPct: number }, price: number): { inr: number; pct: number } {
  const gross = t.qty * (price - t.entryPrice);
  const costs = (t.amount * t.costPct) / 200 + (t.qty * price * t.costPct) / 200;
  const inr = gross - costs;
  return { inr: r2(inr), pct: Math.round((inr / t.amount) * 100000) / 1000 };
}

/** What the same money would have made in Nifty 50 between the same two moments, after the same cost. */
export function niftyPnl(t: { amount: number; niftyEntry: number | null; costPct: number }, niftyNow: number | null): number | null {
  if (!t.niftyEntry || !niftyNow) return null;
  const qty = t.amount / t.niftyEntry;
  return pnlAt({ amount: t.amount, qty, entryPrice: t.niftyEntry, costPct: t.costPct }, niftyNow).inr;
}

export const MIN_TRADES_TO_JUDGE = 30;

/** How often resting limit orders were reached. Orders still waiting are not in the rate. */
export type LimitStats = { placed: number; filled: number; expired: number; waiting: number; fillRate: number | null };

export function limitStats(trades: PaperTrade[]): LimitStats {
  const limits = trades.filter((t) => t.variant === "limit" && t.status !== "cancelled");
  const filled = limits.filter((t) => t.entryPrice != null).length;
  const expired = limits.filter((t) => t.status === "expired").length;
  const waiting = limits.filter((t) => t.status === "pending").length;
  return { placed: limits.length, filled, expired, waiting, fillRate: filled + expired ? Math.round((filled / (filled + expired)) * 1000) / 10 : null };
}

/** External (AI news read) score at entry, in the bands the scoreboard compares. */
export const externalBand = (t: PaperTrade) => {
  const x = t.context.external;
  return x == null ? "No read" : x < 45 ? "External below 45" : x <= 60 ? "External 45 to 60" : "External above 60";
};

/** Label used in the entry-rating breakdown: limit orders are kept apart from trades bought at the open. */
export const entryLabel = (t: PaperTrade) => `${t.context.entryRating ?? "Unknown"}${t.variant === "limit" ? ", limit order" : ""}`;

export type PaperStats = {
  label: string;
  closed: number;
  open: number;
  winRate: number | null;
  avgWin: number | null; // percent
  avgLoss: number | null; // percent, negative
  expectancy: number | null; // percent per closed trade
  closedPnl: number;
  openPnl: number;
  invested: number; // rupees put into every filled trade
  totalReturn: number | null; // (closed + open P&L) / invested, percent
  niftyPnl: number | null; // same money, same dates, in Nifty 50
  niftyReturn: number | null;
  enough: boolean;
};

/** A filled trade with its current mark: `pnl` is final for closed trades and live for open ones. */
export type MarkedTrade = { trade: PaperTrade; pnlInr: number; pnlPct: number; niftyInr: number | null; closed: boolean };

export function summarise(label: string, marked: MarkedTrade[]): PaperStats {
  const closed = marked.filter((m) => m.closed);
  const open = marked.filter((m) => !m.closed);
  const wins = closed.filter((m) => m.pnlInr > 0);
  const losses = closed.filter((m) => m.pnlInr <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const invested = sum(marked.map((m) => m.trade.amount));
  const closedPnl = sum(closed.map((m) => m.pnlInr));
  const openPnl = sum(open.map((m) => m.pnlInr));
  const withNifty = marked.filter((m) => m.niftyInr != null);
  const niftyTotal = withNifty.length ? sum(withNifty.map((m) => m.niftyInr as number)) : null;
  const niftyBase = sum(withNifty.map((m) => m.trade.amount));
  const exp = mean(closed.map((m) => m.pnlPct));
  return {
    label,
    closed: closed.length,
    open: open.length,
    winRate: closed.length ? r2((wins.length / closed.length) * 100) : null,
    avgWin: wins.length ? r2(mean(wins.map((m) => m.pnlPct))!) : null,
    avgLoss: losses.length ? r2(mean(losses.map((m) => m.pnlPct))!) : null,
    expectancy: exp == null ? null : r2(exp),
    closedPnl: r2(closedPnl),
    openPnl: r2(openPnl),
    invested: r2(invested),
    totalReturn: invested ? r2(((closedPnl + openPnl) / invested) * 100) : null,
    niftyPnl: niftyTotal == null ? null : r2(niftyTotal),
    niftyReturn: niftyTotal != null && niftyBase ? r2((niftyTotal / niftyBase) * 100) : null,
    enough: closed.length >= MIN_TRADES_TO_JUDGE,
  };
}

/** Group marked trades by a key and summarise each group, largest first. */
export function breakdown(marked: MarkedTrade[], key: (t: PaperTrade) => string): PaperStats[] {
  const groups = new Map<string, MarkedTrade[]>();
  for (const m of marked) {
    const k = key(m.trade);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  return [...groups.entries()].map(([k, v]) => summarise(k, v)).sort((a, b) => b.closed + b.open - (a.closed + a.open));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTrade(r: any): PaperTrade {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: Number(r.id),
    book: r.book,
    horizon: r.horizon,
    symbol: r.symbol,
    status: r.status,
    amount: Number(r.amount),
    requestedAt: r.requested_at,
    fillRule: r.fill_rule,
    variant: r.variant ?? "market",
    limitPrice: n(r.limit_price),
    limitSessions: n(r.limit_sessions),
    entryAt: r.entry_at,
    entryPrice: n(r.entry_price),
    qty: n(r.qty),
    niftyEntry: n(r.nifty_entry),
    target: n(r.target),
    stop: n(r.stop),
    maxSessions: n(r.max_sessions),
    closeRequestedAt: r.close_requested_at,
    exitAt: r.exit_at,
    exitPrice: n(r.exit_price),
    exitReason: r.exit_reason,
    niftyExit: n(r.nifty_exit),
    costPct: Number(r.cost_pct),
    pnlInr: n(r.pnl_inr),
    pnlPct: n(r.pnl_pct),
    flag: r.flag,
    context: (r.context ?? {}) as PaperContext,
  };
}
