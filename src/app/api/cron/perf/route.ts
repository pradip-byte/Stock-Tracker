import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { getDashboard, getMyActivePaper, getQuotes, getRows, getStockDetail } from "@/lib/data";
import { measure } from "@/lib/perf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Timing probe: runs the same data loaders a page runs and reports how long they
 * took and how many database calls they made. Returns numbers only, never data.
 * It measures the data work, not the sign-in check or the HTML render.
 *   /api/cron/perf?page=dashboard | stocks | stock&symbol=INFY
 */
async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL(request.url);
  const page = url.searchParams.get("page") ?? "dashboard";
  const symbol = (url.searchParams.get("symbol") ?? "INFY").toUpperCase();
  const m = await measure(async () => {
    // the layout loads quotes first, then the page loads its own data
    await getQuotes();
    if (page === "stocks") await Promise.all([getRows(), getMyActivePaper()]);
    else if (page === "stock") await getStockDetail(symbol);
    else await getDashboard();
    return null;
  });
  return NextResponse.json({ page, region: process.env.VERCEL_REGION ?? "local", ms: m.ms, queries: m.queries, calls: m.calls });
}

export const GET = handle;
