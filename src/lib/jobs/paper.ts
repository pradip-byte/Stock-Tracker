/**
 * Paper trading engine. No real orders are placed anywhere.
 *
 * Fills: a trade is requested as 'pending' and filled by the first quote whose
 * exchange timestamp is LATER than the request: at that quote's price if the
 * market was open when it was requested, at that session's open if it was not.
 * A trade can therefore never fill at a price that existed before the request.
 *
 * Short-term exits (the target and stop behave like resting orders):
 *   - quote check: price at or above the target exits at the target; price at or
 *     below the stop exits at the quoted price.
 *   - end-of-day check on each completed session after the entry day: the stop is
 *     tested first (so a day that touched both counts as a loss), filling at the
 *     stop or at the open if the day opened beyond it; then the target likewise.
 *   - after `max_sessions` sessions the trade exits at that session's close.
 * Long-term trades stay open. Mine are flagged when the long-term verdict turns
 * Avoid; shadow ones are closed at the next open when that happens.
 *
 * Shadow book: at the end of each day, a notional equal-size trade is opened for
 * every stock that NEWLY became short-term Favourable with a Good entry, and for
 * every stock that newly became long-term Favourable. It fills at the next open.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMarketOpen, istParts, todayIST } from "../market";
import { mapTrade, pnlAt, type PaperBook, type PaperContext, type PaperHorizon, type PaperTrade } from "../paper";
import { tradeCostPct } from "../settings";
import { adminDb } from "../supabase/admin";

export const ST_MAX_SESSIONS = 20;
const NIFTY = "NIFTY50";

/** Notional size of each shadow trade, in rupees. */
export function shadowAmount(): number {
  const v = Number(process.env.SHADOW_TRADE_INR);
  return Number.isFinite(v) && v >= 1000 ? v : 100000;
}

type Q = { price: number; open: number | null; time: string | null };

async function quotesFor(db: SupabaseClient, symbols: string[]): Promise<Map<string, Q>> {
  const out = new Map<string, Q>();
  if (!symbols.length) return out;
  const { data } = await db.from("quotes_latest").select("symbol,price,day_open,market_time").in("symbol", [...new Set([...symbols, NIFTY])]);
  for (const q of data ?? []) out.set(q.symbol, { price: Number(q.price), open: q.day_open == null ? null : Number(q.day_open), time: q.market_time });
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contextOf(row: any, regime: string | null): PaperContext {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    shortVerdict: row.short_verdict ?? null,
    longVerdict: row.long_verdict ?? null,
    shortScore: num(row.verdict_reasons?.shortScore),
    longScore: num(row.verdict_reasons?.longScore),
    technical: num(row.technical),
    event: num(row.event),
    external: num(row.external),
    overall: num(row.overall),
    entryRating: row.entry?.rating ?? null,
    signal: row.sig_bounce ? "Bounce" : row.sig_breakdown ? "Breakdown" : row.sig_trend ? "Trend" : null,
    momRank: num(row.mom_rank),
    marketUp: row.market_up ?? null,
    regime,
    price: num(row.price) ?? num(row.ind_close),
  };
}

const ROW_COLS =
  "symbol,kind,price,ind_close,short_verdict,long_verdict,verdict_reasons,technical,event,external,overall,entry,sig_bounce,sig_trend,sig_breakdown,mom_rank,market_up,target,stop";

/** The current macro regime label, if the macro view has produced one. */
async function regimeLabel(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.from("macro_daily").select("regime").order("date", { ascending: false }).limit(1).maybeSingle();
  return error ? null : ((data?.regime as string | undefined) ?? null);
}

/** Request a paper trade. It is filled later by the next quote, never at the price on screen. */
export async function requestTrade(
  book: PaperBook,
  horizon: PaperHorizon,
  symbol: string,
  amount: number,
  db: SupabaseClient = adminDb(),
): Promise<{ ok: boolean; error?: string; id?: number }> {
  if (!Number.isFinite(amount) || amount < 100 || amount > 1e9) return { ok: false, error: "Enter an amount of at least ₹100." };
  const { data: row } = await db.from("stock_latest").select(ROW_COLS).eq("symbol", symbol).eq("kind", "equity").maybeSingle();
  if (!row) return { ok: false, error: `${symbol} is not tracked.` };
  const { data: active } = await db
    .from("paper_trades")
    .select("id")
    .eq("book", book)
    .eq("horizon", horizon)
    .eq("symbol", symbol)
    .in("status", ["pending", "open", "closing"])
    .limit(1);
  if (active?.length) return { ok: false, error: "There is already an open paper trade for this stock in this column." };

  // short-term trades carry the target and stop of an entry made now; they are re-based at the fill if the price has moved past them
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any;
  const entryNow = r.entry?.entryKind === "now";
  const target = horizon === "ST" ? Number(entryNow ? r.entry.target : r.target) || null : null;
  const stop = horizon === "ST" ? Number(entryNow ? r.entry.stop : r.stop) || null : null;
  const { data, error } = await db
    .from("paper_trades")
    .insert({
      book,
      horizon,
      symbol,
      amount: Math.round(amount * 100) / 100,
      // a shadow trade is decided on the day's close, so it always takes the next open
      fill_rule: book === "mine" && isMarketOpen() ? "quote" : "open",
      target,
      stop,
      max_sessions: horizon === "ST" ? ST_MAX_SESSIONS : null,
      cost_pct: tradeCostPct(),
      context: contextOf(r, await regimeLabel(db)),
    })
    .select("id")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, id: Number(data.id) };
}

/** Ask to close an open trade (filled by the next quote), or cancel one that has not filled yet. */
export async function requestClose(id: number, reason = "manual", db: SupabaseClient = adminDb()): Promise<{ ok: boolean; error?: string }> {
  const { data: t } = await db.from("paper_trades").select("id,status").eq("id", id).maybeSingle();
  if (!t) return { ok: false, error: "Trade not found." };
  if (t.status === "pending") {
    const { error } = await db.from("paper_trades").update({ status: "cancelled", exit_reason: "cancelled before fill" }).eq("id", id).eq("status", "pending");
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (t.status !== "open") return { ok: false, error: "This trade is not open." };
  const { error } = await db
    .from("paper_trades")
    .update({ status: "closing", close_requested_at: new Date().toISOString(), close_rule: isMarketOpen() ? "quote" : "open", close_reason: reason })
    .eq("id", id)
    .eq("status", "open");
  return error ? { ok: false, error: error.message } : { ok: true };
}

type Counts = { filled: number; closed: number; flagged: number; opened: number };

function closePatch(t: PaperTrade, price: number, at: string, reason: string, nifty: number | null) {
  const p = pnlAt({ amount: t.amount, qty: t.qty!, entryPrice: t.entryPrice!, costPct: t.costPct }, price);
  return { status: "closed", exit_at: at, exit_price: Math.round(price * 10000) / 10000, exit_reason: reason, nifty_exit: nifty, pnl_inr: p.inr, pnl_pct: p.pct, flag: null };
}

/** 15:30 IST on a session date, as an ISO timestamp. */
const closeTime = (date: string) => new Date(`${date}T10:00:00Z`).toISOString();

/**
 * Fill pending trades, apply exits and flags. `mode` "quotes" runs after a quote
 * refresh; "eod" also walks completed daily bars for target, stop and time exits.
 */
export async function processPaper(mode: "quotes" | "eod", db: SupabaseClient = adminDb()): Promise<Counts> {
  const counts: Counts = { filled: 0, closed: 0, flagged: 0, opened: 0 };
  const { data } = await db.from("paper_trades").select("*").in("status", ["pending", "open", "closing"]).limit(5000);
  const trades = (data ?? []).map(mapTrade);
  if (!trades.length) return counts;
  const quotes = await quotesFor(db, trades.map((t) => t.symbol));
  const nifty = quotes.get(NIFTY) ?? null;
  const after = (q: Q | null | undefined, iso: string | null) => q?.time != null && iso != null && q.time > iso;

  for (const t of trades) {
    const q = quotes.get(t.symbol);
    try {
      // 1. fills
      if (t.status === "pending") {
        if (!after(q, t.requestedAt)) continue;
        const price = t.fillRule === "open" ? (q!.open ?? q!.price) : q!.price;
        if (!(price > 0)) continue;
        // re-base a target or stop the fill has already gone through, keeping its distance from the reference price
        let { target, stop } = t;
        const ref = t.context.price ?? price;
        if (target != null && stop != null && (stop >= price || target <= price)) {
          target = Math.round((price + (target - ref)) * 100) / 100;
          stop = Math.round((price - (ref - stop)) * 100) / 100;
          if (stop >= price || target <= price) {
            target = Math.round(price * 1.06 * 100) / 100;
            stop = Math.round(price * 0.97 * 100) / 100;
          }
        }
        const niftyPrice = nifty && after(nifty, t.requestedAt) ? (t.fillRule === "open" ? (nifty.open ?? nifty.price) : nifty.price) : (nifty?.price ?? null);
        await db
          .from("paper_trades")
          .update({ status: "open", entry_at: q!.time, entry_price: price, qty: t.amount / price, nifty_entry: niftyPrice, target, stop })
          .eq("id", t.id)
          .eq("status", "pending");
        counts.filled++;
        continue;
      }

      if (t.entryPrice == null || t.qty == null || t.entryAt == null) continue;

      // 2. a requested close fills at the next quote after the request
      if (t.status === "closing") {
        if (!after(q, t.closeRequestedAt)) continue;
        const { data: raw } = await db.from("paper_trades").select("close_rule,close_reason").eq("id", t.id).single();
        const price = raw?.close_rule === "open" ? (q!.open ?? q!.price) : q!.price;
        await db.from("paper_trades").update(closePatch(t, price, q!.time!, raw?.close_reason ?? "manual", nifty?.price ?? null)).eq("id", t.id).eq("status", "closing");
        counts.closed++;
        continue;
      }

      // 3. short-term exits
      if (t.horizon === "ST" && t.target != null && t.stop != null) {
        if (after(q, t.entryAt)) {
          if (q!.price >= t.target) {
            await db.from("paper_trades").update(closePatch(t, t.target, q!.time!, "target", nifty?.price ?? null)).eq("id", t.id).eq("status", "open");
            counts.closed++;
            continue;
          }
          if (q!.price <= t.stop) {
            await db.from("paper_trades").update(closePatch(t, q!.price, q!.time!, "stop", nifty?.price ?? null)).eq("id", t.id).eq("status", "open");
            counts.closed++;
            continue;
          }
        }
        if (mode === "eod") {
          const entryDate = istParts(new Date(t.entryAt)).date;
          const { data: bars } = await db.from("candles_daily").select("date,open,high,low,close").eq("symbol", t.symbol).gte("date", entryDate).order("date").limit(60);
          const { data: nBars } = await db.from("candles_daily").select("date,close").eq("symbol", NIFTY).gte("date", entryDate).order("date").limit(60);
          const niftyClose = new Map((nBars ?? []).map((b) => [b.date as string, Number(b.close)]));
          let sessions = 0;
          for (const b of bars ?? []) {
            sessions++;
            const o = Number(b.open), h = Number(b.high), l = Number(b.low), c = Number(b.close);
            const nif = niftyClose.get(b.date) ?? null;
            // the entry day's bar includes prices from before the fill, so only later sessions are tested against the levels
            if (b.date > entryDate) {
              if (l <= t.stop) {
                await db.from("paper_trades").update(closePatch(t, Math.min(o, t.stop), closeTime(b.date), "stop", nif)).eq("id", t.id).eq("status", "open");
                counts.closed++;
                break;
              }
              if (h >= t.target) {
                await db.from("paper_trades").update(closePatch(t, Math.max(o, t.target), closeTime(b.date), "target", nif)).eq("id", t.id).eq("status", "open");
                counts.closed++;
                break;
              }
            }
            if (t.maxSessions != null && sessions >= t.maxSessions) {
              await db.from("paper_trades").update(closePatch(t, c, closeTime(b.date), "time", nif)).eq("id", t.id).eq("status", "open");
              counts.closed++;
              break;
            }
          }
        }
        continue;
      }

      // 4. long-term: flag mine, close shadow, when the long-term verdict is Avoid
      if (t.horizon === "LT" && mode === "eod") {
        const { data: row } = await db.from("stock_latest").select("long_verdict").eq("symbol", t.symbol).maybeSingle();
        const avoid = row?.long_verdict === "Avoid";
        if (t.book === "shadow" && avoid) {
          await requestClose(t.id, "long-term verdict turned Avoid", db);
        } else if (t.book === "mine") {
          const flag = avoid ? "Long-term verdict is now Avoid" : null;
          if (flag !== t.flag) {
            await db.from("paper_trades").update({ flag }).eq("id", t.id);
            if (flag) counts.flagged++;
          }
        }
      }
    } catch {
      // one bad row must not stop the rest; it is retried on the next run
    }
  }
  return counts;
}

/**
 * Open shadow trades for stocks that newly qualify, comparing today's score with
 * the previous session's. A previous score from before the entry rating existed
 * is ignored, so the first run does not open a trade for everything at once.
 */
export async function openShadowTrades(db: SupabaseClient = adminDb(), opts: { dryRun?: boolean } = {}): Promise<{ st: string[]; lt: string[] }> {
  const since = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
  const scores: { symbol: string; date: string; short_verdict: string | null; long_verdict: string | null; entry: { rating?: string } | null }[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db
      .from("scores")
      .select("symbol,date,short_verdict,long_verdict,entry")
      .gte("date", since)
      .order("symbol")
      .order("date", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`scores read: ${error.message}`);
    scores.push(...((data ?? []) as typeof scores));
    if (!data || data.length < 1000) break;
  }
  const bySymbol = new Map<string, typeof scores>();
  for (const s of scores) {
    if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, []);
    bySymbol.get(s.symbol)!.push(s);
  }
  const latest = scores.reduce((m, s) => (s.date > m ? s.date : m), "");
  const { data: act } = await db.from("paper_trades").select("symbol,horizon").eq("book", "shadow").in("status", ["pending", "open", "closing"]).limit(5000);
  const active = new Set((act ?? []).map((a) => `${a.symbol}|${a.horizon}`));
  const { data: eq } = await db.from("stocks").select("symbol").eq("kind", "equity");
  const equities = new Set((eq ?? []).map((e) => e.symbol as string));

  const st: string[] = [];
  const lt: string[] = [];
  const stOk = (s: (typeof scores)[number]) => s.short_verdict === "Favourable" && s.entry?.rating === "Good entry";
  for (const [symbol, list] of bySymbol) {
    const [now, prev] = list;
    if (!equities.has(symbol) || !now || !prev || now.date !== latest || latest !== todayOrLastSession(latest)) continue;
    if (!now.entry || !prev.entry) continue; // scored before the entry rating existed
    if (stOk(now) && !stOk(prev) && !active.has(`${symbol}|ST`)) st.push(symbol);
    if (now.long_verdict === "Favourable" && prev.long_verdict !== "Favourable" && !active.has(`${symbol}|LT`)) lt.push(symbol);
  }
  if (!opts.dryRun) {
    for (const s of st) await requestTrade("shadow", "ST", s, shadowAmount(), db);
    for (const s of lt) await requestTrade("shadow", "LT", s, shadowAmount(), db);
  }
  return { st, lt };
}

/** Shadow trades are only opened from scores no older than four days, so a long outage cannot open stale ones. */
function todayOrLastSession(latest: string): string {
  const age = (new Date(`${todayIST()}T00:00:00Z`).getTime() - new Date(`${latest}T00:00:00Z`).getTime()) / 86400000;
  return age <= 4 ? latest : "";
}
