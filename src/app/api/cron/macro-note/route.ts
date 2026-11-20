import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runMacroNote } from "@/lib/jobs/macro";

export const dynamic = "force-dynamic";
// One AI call with up to three web searches, and possibly one retry.
export const maxDuration = 300;

/** Weekly AI macro note. Spends money on the Anthropic API; skipped if one was written in the last 6 days. */
async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const result = await runMacroNote("weekly");
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
