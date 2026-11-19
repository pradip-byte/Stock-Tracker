"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { changePct, pct } from "@/lib/format";
import type { SectorGroup } from "@/lib/types";
import { dur, ease, seq } from "../motion/tokens";
import { useQuote } from "../shell/quotes";
import { StockLink, SymbolMark } from "../shell/StockLink";

/** Increments each time `value` changes after mount. */
function useChangeTick(value: number | undefined) {
  const prev = useRef(value);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setTick((t) => t + 1);
    }
  }, [value]);
  return tick;
}

function Cell({ symbol, delay }: { symbol: string; delay: number }) {
  const q = useQuote(symbol);
  const ch = q?.prevClose ? changePct(q.price, q.prevClose) : null;
  const tick = useChangeTick(q?.price);
  const strength = ch == null ? 0 : Math.round(10 + Math.min(1, Math.abs(ch) / 3) * 62);
  const colour = (ch ?? 0) >= 0 ? "var(--color-gain)" : "var(--color-loss)";
  return (
    <motion.div
      className="w-[84px]"
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: dur.md, ease: ease.out, delay }}
    >
      <StockLink symbol={symbol} slot="heat" className="block">
        <div
          key={tick}
          className={`flex h-12 flex-col justify-between rounded-sm p-1.5 ${tick ? "animate-pulse-once" : ""}`}
          style={{
            background: `color-mix(in srgb, ${colour} ${strength}%, var(--color-metal-2))`,
            boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.08)",
          }}
        >
          <SymbolMark symbol={symbol} slot="heat" className="label truncate text-[10px] text-ink" />
          <span className="num text-[10.5px] text-ink">{ch == null ? "—" : pct(ch)}</span>
        </div>
      </StockLink>
    </motion.div>
  );
}

/** Cells fade and scale in sector by sector, and pulse once when their value changes. */
export function SectorHeatmap({ sectors }: { sectors: SectorGroup[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-4">
      {sectors.map((s, si) => (
        <div key={s.sector} className="flex flex-col gap-1.5">
          <span className="label text-[10px] text-steel">
            {s.sector} <span className="text-line">/</span> {s.symbols.length}
          </span>
          <div className="flex flex-wrap gap-1">
            {s.symbols.map((sym, i) => (
              <Cell key={sym} symbol={sym} delay={seq.charts + Math.min(si, 12) * 0.05 + Math.min(i, 20) * 0.012} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
