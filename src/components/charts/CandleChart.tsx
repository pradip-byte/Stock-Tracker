"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { inr } from "@/lib/format";
import { aggregate, macd, rsi, sma } from "@/lib/indicators";
import type { Candle, Timeframe } from "@/lib/types";
import { easeInOut, easeOut, seq } from "../motion/tokens";
import { Skeleton } from "../ui/core";
import { Segmented } from "../ui/Segmented";

const C = {
  gain: "#3DDC97",
  loss: "#FF5C5C",
  amber: "#FFBE25",
  ink: "#EDEDED",
  steel: "#8B9096",
  line: "#2A2D31",
};
const WINDOW: Record<Timeframe, number> = { D: 130, W: 110, M: 60 };

type Nullable = (number | null)[];
type DataSet = {
  candles: Candle[];
  s50: Nullable;
  s200: Nullable;
  rsi: Nullable;
  macd: Nullable;
  signal: Nullable;
  hist: Nullable;
  start: number; // first animated bar
  lo: number;
  hi: number;
  volMax: number;
};

function buildSet(daily: Candle[], tf: Timeframe): DataSet {
  const candles = aggregate(daily, tf);
  const closes = candles.map((c) => c.close);
  const m = macd(closes);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const start = Math.max(0, candles.length - WINDOW[tf]);
  let lo = Infinity;
  let hi = -Infinity;
  let volMax = 0;
  for (let i = start; i < candles.length; i++) {
    lo = Math.min(lo, candles[i].low, s50[i] ?? Infinity, s200[i] ?? Infinity);
    hi = Math.max(hi, candles[i].high, s50[i] ?? -Infinity, s200[i] ?? -Infinity);
    volMax = Math.max(volMax, candles[i].volume);
  }
  return { candles, s50, s200, rsi: rsi(closes), macd: m.macd, signal: m.signal, hist: m.hist, start, lo, hi, volMax };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Phase = "grow" | "collapse" | "expand" | "final";
type SeriesRefs = {
  chart: IChartApi;
  candle: ISeriesApi<"Candlestick">;
  s50: ISeriesApi<"Line">;
  s200: ISeriesApi<"Line">;
  vol: ISeriesApi<"Histogram">;
  rsi: ISeriesApi<"Line">;
  hist: ISeriesApi<"Histogram">;
  macd: ISeriesApi<"Line">;
  signal: ISeriesApi<"Line">;
};

/**
 * Paints one animation frame. Returns true when the phase is finished.
 *  grow     first load: candles rise from the baseline with stagger, volume follows, lines draw last
 *  collapse timeframe switch, part 1: candles fold into their close
 *  expand   timeframe switch, part 2: the new bars unfold from their close
 */
function paint(s: SeriesRefs, set: DataSet, phase: Phase, t: number): boolean {
  const { candles, start } = set;
  const n = candles.length;
  const span = Math.max(1, n - start);
  const stagger = phase === "grow" ? 460 / span : phase === "expand" ? 200 / span : 0;
  const barDur = phase === "grow" ? 420 : phase === "expand" ? 380 : 160;
  const volLag = phase === "grow" ? 240 : phase === "expand" ? 90 : 0;
  const lineAt = phase === "grow" ? 760 : 320;
  const lineDur = 480;

  const prog = (i: number, lag = 0): number => {
    if (phase === "final" || i < start) return 1;
    const p = easeOut(clamp01((t - lag - (i - start) * stagger) / barDur));
    return phase === "collapse" ? 1 - p : p;
  };

  s.candle.setData(
    candles.map((c, i) => {
      const p = prog(i);
      if (p >= 1) return { ...c, time: c.time as Time };
      const from = phase === "grow" ? set.lo : c.close;
      return {
        time: c.time as Time,
        open: lerp(from, c.open, p),
        high: lerp(from, c.high, p),
        low: lerp(from, c.low, p),
        close: lerp(from, c.close, p),
      };
    }),
  );
  s.vol.setData(
    candles.map((c, i) => ({
      time: c.time as Time,
      value: c.volume * prog(i, volLag),
      color: c.close >= c.open ? "rgba(61,220,151,.42)" : "rgba(255,92,92,.42)",
    })),
  );

  const q = phase === "final" ? 1 : phase === "collapse" ? 0 : easeInOut(clamp01((t - lineAt) / lineDur));
  const upto = q <= 0 ? 0 : q >= 1 ? n : start + Math.ceil(q * span);
  const pts = (arr: Nullable) => {
    const out: { time: Time; value: number }[] = [];
    for (let i = 0; i < upto; i++) {
      const v = arr[i];
      if (v != null) out.push({ time: candles[i].time as Time, value: v });
    }
    return out;
  };
  s.s50.setData(pts(set.s50));
  s.s200.setData(pts(set.s200));
  s.rsi.setData(pts(set.rsi));
  s.macd.setData(pts(set.macd));
  s.signal.setData(pts(set.signal));
  s.hist.setData(
    pts(set.hist).map((p) => ({ ...p, color: p.value >= 0 ? "rgba(61,220,151,.6)" : "rgba(255,92,92,.6)" })),
  );

  if (phase === "final") return true;
  if (phase === "collapse") return t >= barDur;
  return t >= lineAt + lineDur;
}

export function CandleChart({
  daily,
  support,
  resistance,
}: {
  daily: Candle[];
  support: number[];
  resistance: number[];
}) {
  const reduce = useReducedMotion();
  const [tf, setTf] = useState<Timeframe>("D");
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Candle | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const refs = useRef<SeriesRefs | null>(null);
  const lock = useRef<{ lo: number; hi: number; volMax: number } | null>(null);
  const raf = useRef(0);
  const shown = useRef<DataSet | null>(null);

  const sets = useMemo(
    () => ({ D: buildSet(daily, "D"), W: buildSet(daily, "W"), M: buildSet(daily, "M") }),
    [daily],
  );

  // Create the chart once.
  useEffect(() => {
    let disposed = false;
    let chart: IChartApi | null = null;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !box.current) return;
      const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-jbmono").trim();
      chart = lc.createChart(box.current, {
        autoSize: true,
        layout: {
          background: { type: lc.ColorType.Solid, color: "transparent" },
          textColor: C.steel,
          fontFamily: mono || "monospace",
          fontSize: 10,
          attributionLogo: false,
          panes: { separatorColor: C.line, separatorHoverColor: "rgba(255,190,37,.12)", enableResize: false },
        },
        grid: {
          vertLines: { color: "rgba(42,45,49,.45)" },
          horzLines: { color: "rgba(42,45,49,.45)" },
        },
        rightPriceScale: { borderColor: C.line },
        timeScale: { borderColor: C.line, rightOffset: 3 },
        crosshair: {
          mode: lc.CrosshairMode.Normal,
          vertLine: { color: "rgba(255,190,37,.7)", width: 1, style: lc.LineStyle.Solid, labelBackgroundColor: C.amber },
          horzLine: { color: "rgba(255,190,37,.4)", width: 1, style: lc.LineStyle.Dashed, labelBackgroundColor: C.amber },
        },
      });

      const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
      const candle = chart.addSeries(
        lc.CandlestickSeries,
        {
          upColor: C.gain,
          downColor: C.loss,
          wickUpColor: C.gain,
          wickDownColor: C.loss,
          borderVisible: false,
          priceLineColor: "rgba(255,190,37,.6)",
          autoscaleInfoProvider: (original: () => unknown) =>
            lock.current
              ? { priceRange: { minValue: lock.current.lo, maxValue: lock.current.hi } }
              : (original() as never),
        },
        0,
      );
      const s50 = chart.addSeries(lc.LineSeries, { ...quiet, color: "rgba(237,237,237,.7)", lineWidth: 1 }, 0);
      const s200 = chart.addSeries(lc.LineSeries, { ...quiet, color: C.amber, lineWidth: 1 }, 0);
      const vol = chart.addSeries(
        lc.HistogramSeries,
        {
          ...quiet,
          priceFormat: { type: "volume" },
          autoscaleInfoProvider: (original: () => unknown) =>
            lock.current ? { priceRange: { minValue: 0, maxValue: lock.current.volMax } } : (original() as never),
        },
        1,
      );
      const rsiS = chart.addSeries(
        lc.LineSeries,
        {
          ...quiet,
          color: C.ink,
          lineWidth: 1,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        },
        2,
      );
      for (const price of [30, 70]) {
        rsiS.createPriceLine({ price, color: C.line, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: false });
      }
      const hist = chart.addSeries(lc.HistogramSeries, { ...quiet }, 3);
      const macdS = chart.addSeries(lc.LineSeries, { ...quiet, color: C.ink, lineWidth: 1 }, 3);
      const signal = chart.addSeries(lc.LineSeries, { ...quiet, color: C.amber, lineWidth: 1 }, 3);

      for (const [i, price] of support.entries()) {
        candle.createPriceLine({ price, color: "rgba(237,237,237,.5)", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: `SUP ${i + 1}` });
      }
      for (const [i, price] of resistance.entries()) {
        candle.createPriceLine({ price, color: "rgba(237,237,237,.5)", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: `RES ${i + 1}` });
      }

      const panes = chart.panes();
      [5, 1, 1.2, 1.2].forEach((f, i) => panes[i]?.setStretchFactor(f));

      chart.subscribeCrosshairMove((p) => {
        const g = glow.current;
        if (g) {
          g.style.opacity = p.point ? "1" : "0";
          if (p.point) g.style.transform = `translate3d(${p.point.x - 24}px,0,0)`;
        }
        const d = p.seriesData.get(candle) as (Candle & { time: Time }) | undefined;
        setHover(d && p.time ? { ...d, time: String(p.time), volume: 0 } : null);
      });

      refs.current = { chart, candle, s50, s200, vol, rsi: rsiS, hist, macd: macdS, signal };
      setReady(true);
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf.current);
      refs.current = null;
      chart?.remove();
    };
  }, [support, resistance]);

  // Run the reveal on first load and the morph on timeframe change.
  useEffect(() => {
    const s = refs.current;
    if (!ready || !s) return;
    const next = sets[tf];
    const prev = shown.current;
    cancelAnimationFrame(raf.current);

    const frame = (set: DataSet) => {
      const n = set.candles.length;
      s.chart.timeScale().setVisibleLogicalRange({ from: set.start - 0.5, to: n + 2.5 });
    };
    const run = (set: DataSet, phase: Phase, delay: number, then?: () => void) => {
      lock.current = { lo: set.lo, hi: set.hi, volMax: set.volMax };
      let t0 = 0;
      const tick = (now: number) => {
        if (!t0) t0 = now + delay;
        const done = paint(s, set, phase, Math.max(0, now - t0));
        if (!done) raf.current = requestAnimationFrame(tick);
        else if (then) then();
        else lock.current = null;
      };
      raf.current = requestAnimationFrame(tick);
    };

    shown.current = next;
    if (reduce) {
      paint(s, next, "final", 0);
      frame(next);
      lock.current = null;
    } else if (!prev || prev === next) {
      paint(s, next, "grow", 0);
      frame(next);
      run(next, "grow", seq.charts * 1000);
    } else {
      run(prev, "collapse", 0, () => {
        paint(s, next, "expand", 0);
        frame(next);
        run(next, "expand", 0);
      });
    }
    return () => cancelAnimationFrame(raf.current);
  }, [ready, tf, sets, reduce]);

  const last = sets[tf].candles[sets[tf].candles.length - 1];
  const o = hover ?? last;
  const up = o.close >= o.open;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-line px-3.5">
        <div className="num flex items-center gap-3 text-[11px] text-steel">
          <span className="text-ink">{hover ? hover.time : "LAST"}</span>
          {(["open", "high", "low", "close"] as const).map((k) => (
            <span key={k}>
              {k[0].toUpperCase()} <span className={up ? "text-gain" : "text-loss"}>{inr(o[k])}</span>
            </span>
          ))}
          <span className="hidden items-center gap-3 lg:flex">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-px w-3 bg-ink/70" /> 50 DMA
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-px w-3 bg-amber" /> 200 DMA
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-px w-3 border-t border-dashed border-ink/60" /> S/R
            </span>
          </span>
        </div>
        <Segmented options={["D", "W", "M"] as const} value={tf} onChange={setTf} label="Timeframe" />
      </div>
      <div className="relative min-h-0 flex-1">
        {!ready && (
          <div className="absolute inset-3 flex flex-col gap-2">
            <Skeleton className="flex-[5]" />
            <Skeleton className="flex-1" />
            <Skeleton className="flex-1" />
            <Skeleton className="flex-1" />
          </div>
        )}
        <div ref={box} className="absolute inset-0" />
        {/* soft amber glow that follows the crosshair */}
        <div
          ref={glow}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-12 opacity-0 transition-opacity duration-150"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,190,37,.13), transparent)" }}
        />
        <div className="num pointer-events-none absolute left-3 text-[9px] uppercase tracking-widest text-steel/70" style={{ top: "58.5%" }}>
          Volume
        </div>
        <div className="num pointer-events-none absolute left-3 text-[9px] uppercase tracking-widest text-steel/70" style={{ top: "70.5%" }}>
          RSI 14
        </div>
        <div className="num pointer-events-none absolute left-3 text-[9px] uppercase tracking-widest text-steel/70" style={{ top: "84.5%" }}>
          MACD 12 26 9
        </div>
      </div>
    </div>
  );
}
