"use client";

import clsx from "clsx";
import { extent, max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { motion } from "motion/react";
import { crore, inr, pct, toneOf } from "@/lib/format";
import type { BacktestWindow, Quarter } from "@/lib/types";
import { Odometer } from "../motion/Odometer";
import { dur, ease, seq } from "../motion/tokens";

/** Line draws itself; coloured by direction over the window. */
export function Sparkline({
  data,
  width = 96,
  height = 26,
  delay = seq.charts,
}: {
  data: number[];
  width?: number;
  height?: number;
  delay?: number;
}) {
  const [lo = 0, hi = 1] = extent(data);
  const x = scaleLinear([0, data.length - 1], [2, width - 3]);
  const y = scaleLinear([lo, hi], [height - 3, 3]);
  const d = line<number>((_, i) => x(i), (v) => y(v))(data) ?? "";
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <motion.path
        d={d}
        fill="none"
        strokeWidth={1.25}
        strokeLinejoin="round"
        className={up ? "stroke-gain" : "stroke-loss"}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: dur.lg, ease: ease.inOut, delay, opacity: { duration: 0.01, delay } }}
      />
      <motion.circle
        cx={x(data.length - 1)}
        cy={y(data[data.length - 1])}
        r={1.8}
        className={up ? "fill-gain" : "fill-loss"}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: dur.xs, delay: delay + dur.lg }}
      />
    </svg>
  );
}

/** Index line with area wash and a previous-close reference. Stretches to its box. */
export function LineReveal({
  data,
  reference,
  delay = seq.charts,
  className,
}: {
  data: number[];
  reference: number;
  delay?: number;
  className?: string;
}) {
  const W = 600;
  const H = 160;
  const [lo = 0, hi = 1] = extent([...data, reference]);
  const pad = (hi - lo) * 0.12;
  const x = scaleLinear([0, data.length - 1], [0, W]);
  const y = scaleLinear([lo - pad, hi + pad], [H, 0]);
  const d = line<number>((_, i) => x(i), (v) => y(v)).curve(curveMonotoneX)(data) ?? "";
  const a = area<number>((_, i) => x(i), H, (v) => y(v)).curve(curveMonotoneX)(data) ?? "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="lr-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#FFBE25" stopOpacity="0.22" />
          <stop offset="1" stopColor="#FFBE25" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1={0}
        x2={W}
        y1={y(reference)}
        y2={y(reference)}
        className="stroke-steel"
        strokeWidth={1}
        strokeDasharray="2 5"
        vectorEffect="non-scaling-stroke"
      />
      <motion.path
        d={a}
        fill="url(#lr-fill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: dur.lg, ease: ease.out, delay: delay + 0.35 }}
      />
      <motion.path
        d={d}
        fill="none"
        className="stroke-amber"
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: dur.lg, ease: ease.inOut, delay, opacity: { duration: 0.01, delay } }}
      />
    </svg>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}
function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** 270-degree score gauge. The arc sweeps to the value. */
export function RadialGauge({
  value,
  label,
  size = 112,
  delay = seq.charts,
  primary = false,
}: {
  value: number;
  label: string;
  size?: number;
  delay?: number;
  primary?: boolean;
}) {
  const c = size / 2;
  const r = c - 7;
  const d = arcPath(c, c, r, -135, 135);
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div className="relative flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size * 0.86} viewBox={`0 0 ${size} ${size * 0.86}`} aria-hidden>
        <path d={d} fill="none" className="stroke-line" strokeWidth={primary ? 6 : 4} />
        {ticks.map((t) => {
          const deg = -135 + (t / 100) * 270;
          const [x0, y0] = polar(c, c, r - (primary ? 8 : 6), deg);
          const [x1, y1] = polar(c, c, r - (primary ? 12 : 9), deg);
          return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} className="stroke-steel" strokeWidth={1} />;
        })}
        <motion.path
          d={d}
          fill="none"
          className={primary ? "stroke-amber" : "stroke-ink"}
          strokeWidth={primary ? 6 : 4}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.max(0.001, value / 100) }}
          transition={{ duration: dur.lg, ease: ease.out, delay }}
        />
      </svg>
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: size * 0.3 }}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <Odometer
          value={value}
          decimals={0}
          rollIn
          delay={delay}
          flash={false}
          className={clsx("display", primary ? "text-5xl" : "text-3xl")}
        />
      </div>
      <span className="label -mt-1 text-[10px] text-steel">{label}</span>
    </div>
  );
}

/** One quarterly series. Bars grow from the baseline; the latest quarter is highlighted. */
export function QuarterBars({
  quarters,
  field,
  delay = seq.charts,
}: {
  quarters: Quarter[];
  field: "revenue" | "profit";
  delay?: number;
}) {
  const W = 420;
  const H = 118;
  const top = 16;
  const bottom = 30;
  const x = scaleBand(quarters.map((q) => q.label), [0, W]).paddingInner(0.28).paddingOuter(0.1);
  const y = scaleLinear([0, max(quarters, (q) => q[field]) ?? 1], [H - bottom, top]);
  const yoyKey = field === "revenue" ? "revenueYoY" : "profitYoY";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Quarterly ${field}`}>
      <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} className="stroke-line" />
      {quarters.map((q, i) => {
        const bx = x(q.label) ?? 0;
        const bw = x.bandwidth();
        const by = y(q[field]);
        const last = i === quarters.length - 1;
        const yoy = q[yoyKey];
        const d = delay + i * 0.045;
        return (
          <g key={q.label}>
            <motion.rect
              x={bx}
              y={by}
              width={bw}
              height={H - bottom - by}
              className={last ? "fill-amber" : "fill-steel/55"}
              style={{ transformBox: "fill-box", originY: 1 }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: dur.md, ease: ease.out, delay: d }}
            />
            <motion.text
              x={bx + bw / 2}
              y={by - 4}
              textAnchor="middle"
              className={clsx("num text-[9px]", last ? "fill-ink" : "fill-steel")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: dur.sm, delay: d + 0.2 }}
            >
              {crore(q[field])}
            </motion.text>
            <text x={bx + bw / 2} y={H - bottom + 11} textAnchor="middle" className="num fill-steel text-[8px]">
              {q.label.replace(" FY", "'")}
            </text>
            <text
              x={bx + bw / 2}
              y={H - bottom + 23}
              textAnchor="middle"
              className={clsx(
                "num text-[8.5px]",
                yoy == null ? "fill-line" : yoy >= 0 ? "fill-gain" : "fill-loss",
              )}
            >
              {yoy == null ? "·" : pct(yoy, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Backtest hit rates after 5/20/60 sessions, with average return alongside. */
export function HitRateBars({ windows, delay = seq.charts }: { windows: BacktestWindow[]; delay?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {windows.map((w, i) => (
        <div key={w.days} className="grid grid-cols-[28px_1fr_38px_56px] items-center gap-2">
          <span className="num text-[10px] text-steel">{w.days}D</span>
          <div className="relative h-2 bg-metal-2">
            <motion.div
              className="absolute inset-y-0 left-0 origin-left bg-amber"
              style={{ width: `${w.hitRate}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: dur.md, ease: ease.out, delay: delay + i * 0.07 }}
            />
            {/* coin-flip reference */}
            <span className="absolute inset-y-[-2px] left-1/2 w-px bg-ink/60" />
          </div>
          <span className="num text-right text-[11px] text-ink">{w.hitRate}%</span>
          <span className={clsx("num text-right text-[11px]", toneOf(w.avgReturn))}>{pct(w.avgReturn, 1)}</span>
        </div>
      ))}
    </div>
  );
}

/** 52-week range with the current price marker sliding into place. */
export function RangeSlider({
  low,
  high,
  value,
  delay = seq.charts,
  compact = false,
}: {
  low: number;
  high: number;
  value: number;
  delay?: number;
  compact?: boolean;
}) {
  const p = Math.min(1, Math.max(0, (value - low) / Math.max(high - low, 0.0001)));
  return (
    <div className={clsx("flex items-center gap-2", compact ? "w-28" : "w-full")}>
      {!compact && <span className="num text-[10px] text-steel">{inr(low)}</span>}
      <div className="relative h-3 flex-1" role="img" aria-label={`52-week range position ${Math.round(p * 100)}%`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        <motion.div
          className="absolute inset-x-0 top-1/2 h-px origin-left bg-steel"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: p }}
          transition={{ duration: dur.lg, ease: ease.out, delay }}
        />
        <motion.div
          className="absolute inset-0"
          initial={{ x: "0%" }}
          animate={{ x: `${p * 100}%` }}
          transition={{ duration: dur.lg, ease: ease.out, delay }}
        >
          <span className="absolute left-0 top-0 h-full w-0.5 -translate-x-1/2 bg-amber" />
        </motion.div>
      </div>
      {!compact && <span className="num text-[10px] text-steel">{inr(high)}</span>}
    </div>
  );
}
