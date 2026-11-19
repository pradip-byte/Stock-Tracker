import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { refreshQuotes } from "@/lib/jobs/core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const result = await refreshQuotes();
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
