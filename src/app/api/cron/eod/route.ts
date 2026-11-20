import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runEod } from "@/lib/jobs/core";

export const dynamic = "force-dynamic";
// The last batch of the day also refreshes quotes, the macro row, paper trades and the shadow book.
export const maxDuration = 120;

async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const result = await runEod({ budgetMs: 45000 });
  // cached page data is refreshed on the next visit
  revalidateTag("eod", "max");
  revalidateTag("quotes", "max");
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
