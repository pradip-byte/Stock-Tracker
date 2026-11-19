import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Latest stored quotes for the signed-in user (the proxy has already checked the session). */
export async function GET() {
  return NextResponse.json(await getQuotes(), { headers: { "Cache-Control": "no-store" } });
}
