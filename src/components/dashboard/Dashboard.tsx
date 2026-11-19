"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import Link from "next/link";
import { changePct, inr, pct, toneOf } from "@/lib/format";
import { INDEX_SYMBOLS, type DashboardData, type StockRow } from "@/lib/types";
import { LineReveal, RangeSlider, Sparkline } from "../charts/primitives";
import { SectorHeatmap } from "../charts/SectorHeatmap";
import { Odometer } from "../motion/Odometer";
import { Rise, TypeIn } from "../motion/primitives";
import { dur, ease, seq } from "../motion/tokens";
import { useQuote, useQuotes } from "../shell/quotes";
import { StockLink, SymbolMark } from "../shell/StockLink";
import { Card, Pending, SignalTag, Stat } from "../ui/core";
import { Freshness } from "../ui/Freshness";

const isIndex = (s: string) => (INDEX_SYMBOLS as readonly string[]).includes(s);
const dash = <span className="num text-steel">—</span>;

function LiveChange({ symbol, className }: { symbol: string; className?: string }) {
  const q = useQuote(symbol);
  if (!q?.prevClose) return <span className={clsx("num text-steel", className)}>—</span>;
  const ch = changePct(q.price, q.prevClose);
  return <span className={clsx("num", toneOf(ch), className)}>{pct(ch)}</span>;
}

function LivePrice({ symbol, fallback, className }: { symbol: string; fallback: number | null; className?: string }) {
  const q = useQuote(symbol);
  const v = q?.price ?? fallback;
  if (v == null) return <span className={clsx("num text-steel", className)}>—</span>;
  return <Odometer value={v} className={clsx("num", className)} />;
}

/* ───────────────────────── Market pulse ───────────────────────── */

function Breadth() {
  const quotes = useQuotes();
  const list = Object.entries(quotes).filter(([s, q]) => !isIndex(s) && q.prevClose);
  const adv = list.filter(([, q]) => q.price > q.prevClose!).length;
  const dec = list.filter(([, q]) => q.price < q.prevClose!).length;
  const total = Math.max(1, adv + dec);
  return (
    <Stat label="Breadth / adv : dec">
      <div className="flex items-baseline gap-2">
        <Odometer value={adv} decimals={0} flash={false} className="display text-4xl text-gain" />
        <span className="display text-2xl text-steel">:</span>
        <Odometer value={dec} decimals={0} flash={false} className="display text-4xl text-loss" />
      </div>
      <div className="relative mt-1 h-1.5 w-full bg-loss/70">
        <motion.div
          className="absolute inset-0 origin-left bg-gain"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: adv / total }}
          transition={{ duration: dur.lg, ease: ease.out, delay: seq.charts }}
        />
      </div>
    </Stat>
  );
}

function Movers({ title, symbols }: { title: string; symbols: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label text-[10px] text-steel">{title}</span>
      {symbols.map((s) => (
        <StockLink key={s} symbol={s} slot={`mv-${title}`} className="flex items-center justify-between gap-3 hover:text-amber">
          <SymbolMark symbol={s} slot={`mv-${title}`} className="label truncate text-[12px]" />
          <LiveChange symbol={s} className="text-[11px]" />
        </StockLink>
      ))}
    </div>
  );
}

function Pulse({ data }: { data: DashboardData }) {
  const quotes = useQuotes();
  const nifty = quotes[INDEX_SYMBOLS[0]];
  const vix = quotes[INDEX_SYMBOLS[1]];
  const ch = nifty?.prevClose ? changePct(nifty.price, nifty.prevClose) : null;
  const vixCh = vix?.prevClose ? changePct(vix.price, vix.prevClose) : null;
  const ranked = Object.entries(quotes)
    .filter(([s, q]) => !isIndex(s) && q.prevClose)
    .map(([s, q]) => [s, changePct(q.price, q.prevClose!)] as const)
    .sort((a, b) => b[1] - a[1]);
  const gainers = ranked.slice(0, 4).map((r) => r[0]);
  const losers = ranked.slice(-4).reverse().map((r) => r[0]);
  const { counts } = data;
  const setups = counts.bounce + counts.trend;
  const series = data.niftySeries.map((p) => p.close);

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 flex flex-col justify-between gap-5 xl:col-span-5">
        <div>
          <Freshness mode="eod" at={data.eodDate} />
          <TypeIn
            className="display mt-3 text-[clamp(44px,5.4vw,84px)]"
            segments={[
              { text: `${setups} setups`, accent: true },
              { text: " in play. " },
              { text: `${counts.bounce} bounce`, accent: true },
              { text: ` signal${counts.bounce === 1 ? "" : "s"}, ` },
              { text: `${counts.breakdown} breakdown`, accent: true },
              { text: ` warning${counts.breakdown === 1 ? "" : "s"}.` },
            ]}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Card index={0} bodyClassName="p-3">
            <Breadth />
          </Card>
          <Card index={1} bodyClassName="p-3">
            <Stat label="India VIX">
              {vix ? (
                <Odometer value={vix.price} rollIn delay={seq.cards} flash={false} className="display text-4xl" />
              ) : (
                <span className="display text-4xl text-steel">—</span>
              )}
              {vixCh != null && <span className={clsx("num text-[11px]", toneOf(vixCh))}>{pct(vixCh)}</span>}
            </Stat>
          </Card>
          <Card index={2} bodyClassName="p-3">
            <Stat label="Tracked / in uptrend">
              <div className="flex items-baseline gap-2">
                <span className="display text-4xl">{counts.tracked}</span>
                <span className="display text-2xl text-steel">/</span>
                <span className="display text-4xl text-amber">{counts.trend}</span>
              </div>
              {counts.pending > 0 && (
                <Link href="/admin" className="num text-[11px] text-amber underline">
                  {counts.pending} awaiting backfill
                </Link>
              )}
            </Stat>
          </Card>
        </div>
      </div>

      <Card
        index={1}
        className="col-span-12 xl:col-span-7"
        title="Nifty 50"
        right={<Freshness mode="quote" at={nifty?.marketTime ?? null} />}
        bodyClassName="p-0"
      >
        {/* the one amber glow on this screen */}
        <div className="amber-glow -left-10 -top-16 h-72 w-[30rem]" />
        <div className="relative grid grid-cols-1 gap-6 p-4 pb-0 md:grid-cols-[1fr_auto]">
          <div>
            {nifty ? (
              <Odometer value={nifty.price} rollIn delay={seq.cards} className="display text-[clamp(56px,6.6vw,104px)]" />
            ) : (
              <span className="display text-[clamp(56px,6.6vw,104px)] text-steel">No quote</span>
            )}
            {nifty && ch != null && (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className={clsx("num text-sm", toneOf(ch))}>
                  {ch >= 0 ? "+" : "−"}
                  {inr(Math.abs(nifty.price - nifty.prevClose!))}
                </span>
                <span className={clsx("num text-sm", toneOf(ch))}>{pct(ch)}</span>
                <span className="num text-[11px] text-steel">prev close {inr(nifty.prevClose!)}</span>
              </div>
            )}
          </div>
          {gainers.length > 0 && (
            <div className="grid grid-cols-2 gap-5 md:w-72 md:border-l md:border-line md:pl-5">
              <Movers title="Top gainers" symbols={gainers} />
              <Movers title="Top losers" symbols={losers} />
            </div>
          )}
        </div>
        {series.length > 2 ? (
          <>
            <LineReveal data={series} reference={series[0]} className="mt-2 block h-36 w-full" />
            <span className="num absolute bottom-1.5 left-4 text-[9px] uppercase tracking-widest text-steel/80">
              Daily closes, last {series.length} sessions
            </span>
          </>
        ) : (
          <div className="h-36" />
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── Short-term setups ───────────────────────── */

const COLS =
  "grid grid-cols-[minmax(160px,1.6fr)_100px_96px_72px_44px_minmax(92px,.7fr)_60px_48px_minmax(100px,.9fr)_64px] items-center gap-3";

function ScoreBar({ value, delay }: { value: number; delay: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 bg-metal-2">
        <motion.div
          className="absolute inset-y-0 left-0 origin-left bg-amber"
          style={{ width: `${value}%` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: dur.md, ease: ease.out, delay }}
        />
      </div>
      <span className="num w-6 text-right text-[11px] text-ink">{value}</span>
    </div>
  );
}

function SetupRow({ r, i }: { r: StockRow; i: number }) {
  const d = seq.charts + i * 0.05;
  return (
    <Rise index={4 + i * 0.5}>
      <StockLink
        symbol={r.symbol}
        slot="setups"
        className={clsx(COLS, "sheen relative h-11 border-b border-line/70 px-3.5 hover:bg-metal-2/60")}
      >
        <span className="flex min-w-0 items-baseline gap-2.5">
          <SymbolMark symbol={r.symbol} slot="setups" className="display text-lg tracking-wide" />
          <span className="truncate text-[11px] text-steel">{r.name}</span>
        </span>
        {r.spark.length > 2 ? <Sparkline data={r.spark} delay={d} /> : dash}
        <LivePrice symbol={r.symbol} fallback={r.price} className="justify-self-end text-[12px]" />
        <LiveChange symbol={r.symbol} className="justify-self-end text-[12px]" />
        <span className={clsx("num justify-self-end text-[12px]", r.rsi != null && r.rsi < 35 ? "text-amber" : "text-ink")}>
          {r.rsi?.toFixed(0) ?? "—"}
        </span>
        <SignalTag kind={r.signal} />
        <span className="num justify-self-end text-[12px] text-steel" title="Measured hit rates arrive with the Phase 3 backtest">
          —
        </span>
        <span className="num justify-self-end text-[12px] text-ink">{r.rr != null ? `${r.rr.toFixed(1)}x` : "—"}</span>
        {r.tech != null ? <ScoreBar value={r.tech} delay={d} /> : dash}
        <span className="num justify-self-end text-[11px] text-steel">{r.risk ?? "—"}</span>
      </StockLink>
    </Rise>
  );
}

function Setups({ data }: { data: DashboardData }) {
  return (
    <Card
      index={3}
      className="col-span-12 xl:col-span-8"
      title="Top short-term setups"
      right={<Freshness mode="eod" at={data.eodDate} />}
      bodyClassName="overflow-x-auto"
    >
      <div className="min-w-[972px]">
        <div className={clsx(COLS, "label h-8 border-b border-line px-3.5 text-[10px] text-steel")}>
          <span>Stock</span>
          <span>30 sessions</span>
          <span className="justify-self-end">Price</span>
          <span className="justify-self-end">Chg</span>
          <span className="justify-self-end">RSI</span>
          <span>Signal</span>
          <span className="justify-self-end">Hit 20D</span>
          <span className="justify-self-end">R:R</span>
          <span>Tech score</span>
          <span className="justify-self-end">Risk</span>
        </div>
        {data.shortSetups.map((s, i) => (
          <SetupRow key={s} r={data.rows[s]} i={i} />
        ))}
        {data.shortSetups.length === 0 && (
          <p className="p-4 text-[12.5px] text-steel">No bounce or trend signals on the latest session.</p>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────── Side lists ───────────────────────── */

function LongTerm({ data }: { data: DashboardData }) {
  return (
    <Card
      index={4}
      className="col-span-12 md:col-span-6 xl:col-span-4"
      title="Long-term candidates"
      right={<Freshness mode="text" label="Trend only until Phase 2" />}
      bodyClassName=""
    >
      {data.longCandidates.map((s, i) => {
        const r = data.rows[s];
        return (
          <StockLink
            key={s}
            symbol={s}
            slot="long"
            className="sheen relative grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-line/70 px-3.5 py-2.5 last:border-b-0 hover:bg-metal-2/60"
          >
            <span className="min-w-0">
              <SymbolMark symbol={s} slot="long" className="display block text-lg tracking-wide" />
              {r.lo52 != null && r.hi52 != null && r.price != null && (
                <span className="mt-1 flex items-center gap-2">
                  <span className="label text-[9px] text-steel">52W</span>
                  <RangeSlider low={r.lo52} high={r.hi52} value={r.price} compact delay={seq.charts + i * 0.05} />
                </span>
              )}
            </span>
            <span className="num text-right text-[10px] uppercase leading-relaxed tracking-wider text-steel">
              {r.distHi52 != null && (
                <>
                  <span className="text-ink">{Math.abs(r.distHi52).toFixed(1)}%</span> off high
                </>
              )}
            </span>
            <span className="w-12 text-right">
              <span className="display block text-3xl">{r.tech ?? "—"}</span>
              <span className="label text-[9px] text-steel">Tech</span>
            </span>
          </StockLink>
        );
      })}
      {data.longCandidates.length === 0 && (
        <p className="p-4 text-[12.5px] text-steel">No established uptrends within 15% of a 52-week high.</p>
      )}
    </Card>
  );
}

function HighRisk({ data }: { data: DashboardData }) {
  const grid = "grid grid-cols-[1fr_88px_88px_88px_56px] items-center gap-3 px-3.5";
  return (
    <Card
      index={6}
      className="col-span-12 md:col-span-6 xl:col-span-5"
      title="High risk / high reward"
      right={<Freshness mode="eod" at={data.eodDate} />}
      bodyClassName="overflow-x-auto [&>*]:min-w-[440px]"
    >
      <div className={clsx(grid, "label h-8 border-b border-line text-[10px] text-steel")}>
        <span>Stock</span>
        <span className="justify-self-end">Price</span>
        <span className="justify-self-end">Target</span>
        <span className="justify-self-end">Stop</span>
        <span className="justify-self-end">R:R</span>
      </div>
      {data.highRisk.map((s) => {
        const r = data.rows[s];
        return (
          <StockLink
            key={s}
            symbol={s}
            slot="risk"
            className={clsx(grid, "sheen relative h-11 border-b border-line/70 last:border-b-0 hover:bg-metal-2/60")}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <SymbolMark symbol={s} slot="risk" className="display text-lg tracking-wide" />
              <span className="label truncate text-[9px] text-steel">ATR {r.atr && r.price ? ((r.atr / r.price) * 100).toFixed(1) : "—"}%</span>
            </span>
            <LivePrice symbol={s} fallback={r.price} className="justify-self-end text-[12px]" />
            <span className="num justify-self-end text-[12px] text-ink">{r.target != null ? inr(r.target) : "—"}</span>
            <span className="num justify-self-end text-[12px] text-steel">{r.stop != null ? inr(r.stop) : "—"}</span>
            <span className="display justify-self-end text-2xl text-amber">{r.rr?.toFixed(1) ?? "—"}</span>
          </StockLink>
        );
      })}
      {data.highRisk.length === 0 && (
        <p className="p-4 text-[12.5px] text-steel">
          No high-volatility stock currently offers 1.5x or better reward-to-risk.
        </p>
      )}
    </Card>
  );
}

function SignalsToday({ data }: { data: DashboardData }) {
  const { counts } = data;
  const ready = Math.max(1, counts.tracked - counts.pending);
  const rows = [
    { label: "Bounce-back", n: counts.bounce },
    { label: "Trend (price > 50 > 200 DMA)", n: counts.trend },
    { label: "Breakdown warning", n: counts.breakdown },
  ];
  return (
    <Card index={8} className="col-span-12 xl:col-span-4" title="Signals on the latest session" right={<Freshness mode="eod" at={data.eodDate} />}>
      <div className="flex flex-col gap-3.5">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label text-[11px] text-ink">{r.label}</span>
              <span className="num text-[11px] text-steel">
                <span className="text-ink">{r.n}</span> of {ready}
              </span>
            </div>
            <div className="relative h-2 bg-metal-2">
              <motion.div
                className="absolute inset-y-0 left-0 origin-left bg-amber"
                style={{ width: `${(r.n / ready) * 100}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: dur.md, ease: ease.out, delay: seq.charts + i * 0.08 }}
              />
            </div>
          </div>
        ))}
        <Pending phase={3} what="Measured hit rates and average returns for each signal, from the 10-year backtest." className="min-h-0" />
      </div>
    </Card>
  );
}

function Setup() {
  return (
    <Card index={0} title="No market data yet">
      <div className="max-w-prose text-[13px] leading-relaxed text-steel">
        <p className="text-ink">The database is reachable but holds no stocks with history.</p>
        <p className="mt-2">Run these once from the project folder, in order:</p>
        <pre className="num mt-3 rounded-sm border border-line bg-night p-3 text-[12px] leading-relaxed text-ink">
          npm run db:push{"\n"}npm run seed{"\n"}npm run backfill
        </pre>
        <p className="mt-3">
          Progress and any failures show on the <Link className="text-amber underline" href="/admin">admin page</Link>.
        </p>
      </div>
    </Card>
  );
}

export function Dashboard({ data }: { data: DashboardData }) {
  if (data.counts.tracked - data.counts.pending === 0) return <Setup />;
  return (
    <div className="flex flex-col gap-3">
      <Pulse data={data} />
      <div className="grid grid-cols-12 gap-3">
        <Setups data={data} />
        <LongTerm data={data} />
        <Card index={5} className="col-span-12 xl:col-span-7" title="Results in the next 30 days">
          <Pending phase={2} what="Result dates from NSE/BSE announcements with a Yahoo fallback, laid out on a 30-day timeline. Unknown dates will be shown as unknown." />
        </Card>
        <HighRisk data={data} />
        <Card index={7} className="col-span-12 xl:col-span-8" title="Sector heatmap" right={<Freshness mode="quote" />}>
          <SectorHeatmap sectors={data.sectors} />
        </Card>
        <SignalsToday data={data} />
      </div>
    </div>
  );
}
