import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runExternalWeekly } from "@/lib/jobs/external";

export const dynamic = "force-dynamic";
// One AI call with two web searches can take a minute, so this route needs a long limit.
// If your Vercel plan caps functions lower, run `npm run external` locally instead.
export const maxDuration = 300;

async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  // stop starting new calls after 150 seconds so the last one can finish inside the limit
  const result = await runExternalWeekly({ budgetMs: 150000 });
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
