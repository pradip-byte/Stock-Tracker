"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Candle } from "@/lib/types";

const Skeleton = ({ note }: { note?: string }) => (
  <div className="skeleton flex h-[460px] w-full items-end rounded-sm p-3" role="status" aria-label="Loading price chart">
    {note && <span className="num text-[11px] text-steel">{note}</span>}
  </div>
);

// the charting library is large and not needed for the first paint
const CandleChart = dynamic(() => import("./CandleChart").then((m) => m.CandleChart), { ssr: false, loading: () => <Skeleton /> });

/**
 * Price chart that loads after the page is visible: the chart code and the
 * ten-year history are fetched in the background while the rest of the page
 * is already readable.
 */
export function CandleChartLazy({ symbol, support, resistance }: { symbol: string; support: number[]; resistance: number[] }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    setCandles(null);
    setFailed(false);
    fetch(`/api/candles/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: [string, number, number, number, number, number][]) => {
        if (!stop) setCandles(rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume })));
      })
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, [symbol]);

  if (failed) return <Skeleton note="The price history could not be loaded. Reload the page to try again." />;
  if (!candles) return <Skeleton />;
  if (candles.length < 30) return <Skeleton note="Not enough price history for a chart yet." />;
  return <CandleChart daily={candles} support={support} resistance={resistance} />;
}
