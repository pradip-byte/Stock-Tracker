import { NextResponse } from "next/server";
import { getCandles } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Daily price history for one stock, fetched by the chart after the page has painted.
 * The proxy has already checked the session. Rows are compact arrays:
 * [date, open, high, low, close, volume].
 */
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const candles = await getCandles(decodeURIComponent(symbol).toUpperCase());
  return NextResponse.json(
    candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
    // history changes once a day; the browser may reuse it for five minutes
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
