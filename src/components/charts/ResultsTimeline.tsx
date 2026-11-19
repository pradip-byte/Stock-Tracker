"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { dayDiff, shortDate } from "@/lib/format";
import { dur, ease, seq } from "../motion/tokens";
import { StockLink, SymbolMark } from "../shell/StockLink";

type Item = { symbol: string; date: string; source: "NSE" | "Yahoo" };

const LANE = 30;
const SPAN = 30;

/** Results due in the next 30 days, laid out on a day axis. */
export function ResultsTimeline({
  items,
  unknown,
  today,
}: {
  items: Item[];
  unknown: string[];
  today: string;
}) {
  // Greedy lane packing so chips on nearby dates do not overlap.
  const laneEnd: number[] = [];
  const placed = items.map((it) => {
    const day = dayDiff(today, it.date);
    let lane = laneEnd.findIndex((end) => day >= end);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = day + 6.5;
    return { ...it, day, lane };
  });
  const lanes = Math.max(1, laneEnd.length);
  const addDays = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return (
    <div>
      <div className="relative mr-28" style={{ height: lanes * LANE + 34 }}>
        {/* axis */}
        <div className="absolute inset-x-0 h-px bg-line" style={{ top: lanes * LANE + 6 }} />
        {[0, 7, 14, 21, 30].map((d) => (
          <div key={d} className="absolute" style={{ left: `${(d / SPAN) * 100}%`, top: lanes * LANE + 2 }}>
            <span className={clsx("block h-2.5 w-px", d === 0 ? "bg-amber" : "bg-steel")} />
            <span className={clsx("num mt-1 block whitespace-nowrap text-[10px]", d === 0 ? "text-amber" : "text-steel")}>
              {d === 0 ? "TODAY" : shortDate(addDays(d))}
            </span>
          </div>
        ))}
        {/* leader lines sit under every chip */}
        {placed.map((it, i) => (
          <motion.span
            key={it.symbol}
            className={clsx("absolute w-px origin-bottom", it.day <= 7 ? "bg-amber" : "bg-line")}
            style={{ left: `${(it.day / SPAN) * 100}%`, top: it.lane * LANE, height: (lanes - it.lane) * LANE + 6 }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: dur.md, ease: ease.out, delay: seq.charts + i * 0.045 }}
          />
        ))}
        {placed.map((it, i) => (
          <motion.div
            key={it.symbol}
            className="absolute z-10"
            style={{ left: `${(it.day / SPAN) * 100}%`, top: it.lane * LANE }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.md, ease: ease.out, delay: seq.charts + 0.1 + i * 0.045 }}
          >
            <StockLink
              symbol={it.symbol}
              slot="results"
              className="metal-raised relative ml-px flex h-6 items-center gap-2 rounded-sm px-2 hover:text-amber"
            >
              <SymbolMark symbol={it.symbol} slot="results" className="label text-[11px]" />
              <span className="num whitespace-nowrap text-[10px] text-steel">{shortDate(it.date)}</span>
            </StockLink>
          </motion.div>
        ))}
      </div>
      <p className="num mt-3 border-t border-line pt-2.5 text-[10px] uppercase leading-relaxed tracking-wider text-steel">
        <span className="text-ink">Date unknown ({unknown.length})</span>
        <span className="mx-2 text-line">/</span>
        {unknown.join("  ·  ")}
      </p>
    </div>
  );
}
