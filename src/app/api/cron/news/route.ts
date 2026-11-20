import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runNews } from "@/lib/jobs/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily news from free feeds: market headlines, then a dozen stocks not fetched in the last 20 hours. */
async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  // a dozen stocks per call, two seconds apart: the schedule spreads the full list over a few hours
  const result = await runNews({ budgetMs: 40000, maxStocks: 12 });
  // cached page data is refreshed on the next visit
  revalidateTag("eod", "max");
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
