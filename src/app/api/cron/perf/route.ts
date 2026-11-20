import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { getCandles, getDashboard, getMyActivePaper, getQuotes, getRows, getStockDetail, loadCandles, loadDashboard, loadQuotes, loadRows, loadStock } from "@/lib/data";
import { adminDb } from "@/lib/supabase/admin";
import { measure } from "@/lib/perf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Timing probe: runs the same data loaders a page runs and reports how long they
 * took and how many database calls they made. Returns numbers only, never data.
 * It measures the data work, not the sign-in check or the HTML render.
 *   /api/cron/perf?page=dashboard | stocks | stock | candles &symbol=INFY
 *   &fresh=1 skips the cache, to time the queries themselves
 */
async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL(request.url);
  const page = url.searchParams.get("page") ?? "dashboard";
  const symbol = (url.searchParams.get("symbol") ?? "INFY").toUpperCase();
  const fresh = url.searchParams.get("fresh") === "1";
  const db = adminDb();
  const m = await measure(async () => {
    // the layout loads quotes while the page loads its own data
    const quotes = fresh ? loadQuotes(db) : getQuotes();
    if (page === "stocks") await Promise.all([quotes, fresh ? loadRows(db) : getRows(), getMyActivePaper()]);
    else if (page === "stock") await Promise.all([quotes, fresh ? loadStock(db, symbol) : getStockDetail(symbol)]);
    else if (page === "candles") await (fresh ? loadCandles(db, symbol) : getCandles(symbol));
    else await Promise.all([quotes, fresh ? loadDashboard(db) : getDashboard()]);
    return null;
  });
  return NextResponse.json({ page, fresh, region: process.env.VERCEL_REGION ?? "local", ms: m.ms, queries: m.queries, calls: m.calls });
}

export const GET = handle;
