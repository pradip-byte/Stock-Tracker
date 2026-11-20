import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runMacroDaily } from "@/lib/jobs/macro";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily macro numbers, breadth, regime label and event follow-up. Also runs at the end of the end-of-day job. */
async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const result = await runMacroDaily();
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
