"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ViewTransition, useState, useTransition } from "react";
import { removeStockAction, setWatchlistAction } from "@/app/actions";
import { changePct, dayDiff, inr, pct, shortDate, toneOf } from "@/lib/format";
import { fmtIST } from "@/lib/market";
import type { Quarter, SignalStats, StockDetail, StockRow } from "@/lib/types";
import { CandleChart } from "../charts/CandleChart";
import { HitRateBars, QuarterBars, RadialGauge, RangeSlider } from "../charts/primitives";
import { Odometer } from "../motion/Odometer";
import { Rise, TypeIn } from "../motion/primitives";
import { dur, ease, seq } from "../motion/tokens";
import { useQuote } from "../shell/quotes";
import { vtName } from "../shell/StockLink";
import { ExternalCard } from "./ExternalCard";
import { Button, Card, Stat, VerdictStamp } from "../ui/core";
import { Freshness } from "../ui/Freshness";

function RewardRisk({ price, stop, target }: { price: number; stop: number; target: number }) {
  const valid = stop < price && target > price;
  const rr = valid ? (target - price) / (price - stop) : null;
  const p = valid ? Math.min(0.95, Math.max(0.05, (price - stop) / (target - stop))) : 0.5;
  const down = (stop / price - 1) * 100;
  const up = (target / price - 1) * 100;
  return (
    <div>
      <div className="flex items-end justify-between">
        <Stat label="Reward vs risk at the current price">
          <span className="display text-5xl text-amber">
            {rr != null ? rr.toFixed(1) : "—"}
            <span className="text-2xl text-steel"> : 1</span>
          </span>
        </Stat>
        <span className="num text-right text-[10px] uppercase leading-relaxed tracking-wider text-steel">
          Target = nearest resistance
          <br />
          Stop = nearest support less 0.5 ATR
        </span>
      </div>
      {valid ? (
        <div className="relative mt-4 h-2.5 bg-metal-2">
          <motion.div
            className="absolute inset-y-0 left-0 origin-right bg-loss/55"
            style={{ width: `${p * 100}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: dur.md, ease: ease.out, delay: seq.charts }}
          />
          <motion.div
            className="absolute inset-y-0 right-0 origin-left bg-gain/55"
            style={{ width: `${(1 - p) * 100}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: dur.md, ease: ease.out, delay: seq.charts }}
          />
          <span className="absolute inset-y-[-4px] w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${p * 100}%` }} />
        </div>
      ) : (
        <p className="num mt-4 text-[11px] text-amber">Price has moved outside the stop/target range set at the last close.</p>
      )}
      <div className="num mt-2 grid grid-cols-3 text-[11px]">
        <span>
          <span className="block text-[9px] uppercase tracking-wider text-steel">Stop</span>
          {inr(stop)} <span className="text-loss">{pct(down, 1)}</span>
        </span>
        <span className="text-center">
          <span className="block text-[9px] uppercase tracking-wider text-steel">Price</span>
          {inr(price)}
        </span>
        <span className="text-right">
          <span className="block text-[9px] uppercase tracking-wider text-steel">Target</span>
          {inr(target)} <span className="text-gain">{pct(up, 1)}</span>
        </span>
      </div>
    </div>
  );
}

function EmptyGauge({ label, phase }: { label: string; phase: number }) {
  return (
    <div className="flex w-[92px] flex-col items-center gap-1" title={`Arrives in Phase ${phase}`}>
      <div className="flex size-[70px] items-center justify-center rounded-full border border-dashed border-line">
        <span className="num text-[10px] text-steel">P{phase}</span>
      </div>
      <span className="label text-[10px] text-steel/70">{label}</span>
    </div>
  );
}

const na = <span className="num text-sm text-steel">not available</span>;

function Results({
  row,
  quarters,
  upcoming,
  daysToResult,
}: {
  row: StockRow;
  quarters: Quarter[];
  upcoming: boolean;
  daysToResult: number | null;
}) {
  const ratio = (v: number | null, unit: string, d = 1) =>
    v == null ? (
      na
    ) : (
      <span className="num text-[15px] text-ink">
        {v.toFixed(d)}
        <span className="text-steel">{unit}</span>
      </span>
    );
  const reported = quarters.filter((q) => q.resultDate).slice(-4).reverse();
  const last = [...quarters].reverse().find((q) => q.margin != null);
  return (
    <Card
      index={8}
      className="col-span-12"
      title="Results and fundamentals"
      right={<Freshness mode="text" label={row.fundamentalsAt ? `Yahoo / checked ${fmtIST(row.fundamentalsAt)}` : "Not fetched yet"} />}
    >
      {!row.fundamentalsAt ? (
        <p className="text-[12.5px] text-steel">
          Not fetched yet. Run <span className="num text-ink">npm run fundamentals</span> or wait for the daily job.
        </p>
      ) : (
        <div className="grid grid-cols-12 gap-x-6 gap-y-5">
          <div className="col-span-12 grid grid-cols-3 content-start gap-x-4 gap-y-4 lg:col-span-3 lg:grid-cols-2">
            <Stat label="Next result">
              <span className={clsx("display text-3xl", !upcoming && "text-steel")}>
                {upcoming ? shortDate(row.nextResultDate!) : "Unknown"}
              </span>
              <span className={clsx("num text-[10px]", upcoming && daysToResult! <= 30 ? "text-amber" : "text-steel")}>
                {upcoming
                  ? `in ${daysToResult} days${row.nextResultEstimate ? " / estimate" : ""} / ${row.nextResultSource}`
                  : "no upcoming date published"}
              </span>
            </Stat>
            <Stat label="P/E (trailing)">{ratio(row.pe, "x")}</Stat>
            <Stat label="ROE">{ratio(row.roe, "%")}</Stat>
            <Stat label="Debt / equity">{ratio(row.debtToEquity, "x", 2)}</Stat>
            <Stat label="Net margin (TTM)">{ratio(row.profitMargin, "%")}</Stat>
            <Stat label={`Net margin ${last?.label ?? ""}`}>{ratio(last?.margin ?? null, "%")}</Stat>
          </div>

          {quarters.length === 0 ? (
            <p className="col-span-12 text-[12.5px] text-steel lg:col-span-9">The provider has no quarterly results for this stock.</p>
          ) : (
            <>
              <div className="col-span-12 md:col-span-6 lg:col-span-3">
                <span className="label text-[10px] text-steel">Revenue / Rs crore / YoY below</span>
                <QuarterBars quarters={quarters} field="revenue" />
              </div>
              <div className="col-span-12 md:col-span-6 lg:col-span-3">
                <span className="label text-[10px] text-steel">Net profit / Rs crore / YoY below</span>
                <QuarterBars quarters={quarters} field="profit" delay={seq.charts + 0.15} />
              </div>
              <div className="col-span-12 lg:col-span-3">
                <span className="label text-[10px] text-steel">Price reaction to past results</span>
                <div className="num mt-2 grid grid-cols-[1fr_70px_60px_60px] gap-x-2 text-[9px] uppercase tracking-wider text-steel">
                  <span>Quarter</span>
                  <span>Announced</span>
                  <span className="text-right">1 day</span>
                  <span className="text-right">5 days</span>
                </div>
                {reported.map((q) => (
                  <div key={q.periodEnd} className="num grid grid-cols-[1fr_70px_60px_60px] gap-x-2 border-t border-line/70 py-1.5 text-[11px]">
                    <span className="text-ink">{q.label}</span>
                    <span className="text-steel">{shortDate(q.resultDate!)}</span>
                    <span className={clsx("text-right", q.reaction1d == null ? "text-steel" : toneOf(q.reaction1d))}>
                      {q.reaction1d == null ? "—" : pct(q.reaction1d, 1)}
                    </span>
                    <span className={clsx("text-right", q.reaction5d == null ? "text-steel" : toneOf(q.reaction5d))}>
                      {q.reaction5d == null ? "—" : pct(q.reaction5d, 1)}
                    </span>
                  </div>
                ))}
                {reported.length === 0 && <p className="mt-2 text-[12px] text-steel">No announcement dates available.</p>}
              </div>
              {quarters.some((q) => q.checkData) && (
                <p className="num col-span-12 border-t border-line pt-2.5 text-[10px] uppercase leading-relaxed tracking-wider text-amber">
                  Check data:{" "}
                  {quarters
                    .filter((q) => q.checkData)
                    .map((q) => `${q.label} (${q.checkData})`)
                    .join("; ")}
                  . Shown with a dashed outline and left out of growth figures and the event score.
                </p>
              )}
              {quarters.length < 8 && (
              <p className="num col-span-12 border-t border-line pt-2.5 text-[10px] uppercase leading-relaxed tracking-wider text-steel">
                <span className="text-amber">{quarters.length} of 8 quarters available.</span> Yahoo carries only the most recent quarters
                for NSE stocks; history builds up here as each new result is stored. YoY shows only where the year-ago quarter exists.
              </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ReasonList({ title, items, start, empty = "Not computed yet." }: { title: string; items: string[]; start: number; empty?: string }) {
  return (
    <div>
      <span className="label text-[10px] text-amber">{title}</span>
      <ol className="mt-1.5 flex flex-col">
        {items.map((r, i) => (
          <motion.li
            key={i}
            className="flex gap-3 border-t border-line/70 py-2 text-[12.5px] leading-snug text-ink"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: dur.sm, ease: ease.out, delay: seq.charts + (start + i) * 0.04 }}
          >
            <span className="num pt-px text-[10px] text-steel">{String(i + 1).padStart(2, "0")}</span>
            {r}
          </motion.li>
        ))}
        {items.length === 0 && <li className="border-t border-line/70 py-2 text-[12.5px] text-steel">{empty}</li>}
      </ol>
    </div>
  );
}

const SIGNALS: { key: "bounce" | "trend" | "breakdown"; kind: "Bounce" | "Trend" | "Breakdown"; label: string; rule: string }[] = [
  { key: "bounce", kind: "Bounce", label: "Bounce-back", rule: "RSI under 35, within 3% of support or the 200 DMA, with a reversal candle or 1.5x volume." },
  { key: "trend", kind: "Trend", label: "Trend", rule: "Price above the 50 DMA, and the 50 DMA above the 200 DMA." },
  { key: "breakdown", kind: "Breakdown", label: "Breakdown warning", rule: "Support lost on volume, a fresh close under the 200 DMA, or a 20-day closing low in a downtrend." },
];

function Tech({ row, price }: { row: StockRow; price: number }) {
  const vs = (level: number | null) => (level == null ? null : (price / level - 1) * 100);
  const items: { label: string; value: string; sub?: number | null }[] = [
    { label: "RSI (14)", value: row.rsi?.toFixed(1) ?? "—" },
    { label: "ATR (14)", value: row.atr != null ? inr(row.atr) : "—" },
    { label: "Volume vs 20D", value: row.volRatio != null ? `${row.volRatio.toFixed(2)}x` : "—" },
    { label: "20 DMA", value: row.sma20 != null ? inr(row.sma20) : "—", sub: vs(row.sma20) },
    { label: "50 DMA", value: row.sma50 != null ? inr(row.sma50) : "—", sub: vs(row.sma50) },
    { label: "200 DMA", value: row.sma200 != null ? inr(row.sma200) : "—", sub: vs(row.sma200) },
    { label: "52W high", value: row.hi52 != null ? inr(row.hi52) : "—", sub: vs(row.hi52) },
    { label: "52W low", value: row.lo52 != null ? inr(row.lo52) : "—", sub: vs(row.lo52) },
    { label: "Risk (ATR %)", value: row.risk ?? "—" },
  ];
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3.5">
      {items.map((it) => (
        <Stat key={it.label} label={it.label}>
          <span className="num text-[14px] text-ink">{it.value}</span>
          {it.sub != null && <span className={clsx("num -mt-1 text-[10px]", toneOf(it.sub))}>{pct(it.sub, 1)}</span>}
        </Stat>
      ))}
    </div>
  );
}

function Controls({ row }: { row: StockRow }) {
  const router = useRouter();
  const [watch, setWatch] = useState(row.inWatchlist);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        aria-pressed={watch}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const next = !watch;
            setWatch(next);
            const res = await setWatchlistAction(row.symbol, next);
            if (!res.ok) setWatch(!next);
          })
        }
        className={clsx(watch && "text-amber")}
      >
        <span className={clsx("inline-block size-1.5 rotate-45", watch ? "bg-amber" : "border border-steel")} />
        {watch ? "On watchlist" : "Add to watchlist"}
      </Button>
      {confirm ? (
        <>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await removeStockAction(row.symbol);
                if (res.ok) router.push("/stocks");
              })
            }
            className="text-amber"
          >
            {pending ? "Removing" : "Confirm: delete stock and its history"}
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={() => setConfirm(true)}>
          Remove
        </Button>
      )}
    </div>
  );
}

export function StockView({ detail }: { detail: StockDetail }) {
  const { row, candles, quarters, today, backtests } = detail;
  const upcoming = row.nextResultDate != null && row.nextResultDate >= today;
  const daysToResult = upcoming ? dayDiff(today, row.nextResultDate!) : null;
  const q = useQuote(row.symbol);
  const price = q?.price ?? row.price;
  const prevClose = q?.prevClose ?? row.prevClose;
  const ch = price != null && prevClose ? changePct(price, prevClose) : null;
  const ready = row.backfillStatus === "done" && candles.length > 30;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Header ── */}
      <div className="grid grid-cols-12 items-end gap-x-6 gap-y-5 pb-2">
        <div className="col-span-12 lg:col-span-5">
          <Link href="/" className="label inline-flex items-center gap-2 text-[11px] text-steel hover:text-amber">
            <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden>
              <path d="M4 0 0 4l4 4M0 4h14" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Dashboard
          </Link>
          <ViewTransition name={vtName(row.symbol)}>
            <h1 className="display mt-2 w-fit text-[clamp(56px,7vw,112px)]">{row.symbol}</h1>
          </ViewTransition>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <TypeIn as="p" className="text-sm text-ink" segments={[{ text: row.name }]} />
            {row.sector && (
              <span className="label rounded-sm border border-line px-1.5 py-1 text-[10px] text-steel">{row.sector}</span>
            )}
            <span className="label rounded-sm border border-line px-1.5 py-1 text-[10px] text-steel">NSE</span>
          </div>
        </div>

        <Rise index={0} className="relative col-span-12 sm:col-span-7 lg:col-span-4">
          {/* the one amber glow on this screen */}
          <div className="amber-glow -left-16 -top-14 h-56 w-96" />
          <div className="relative">
            <Freshness mode="quote" at={q?.marketTime ?? row.marketTime} />
            <div className="mt-1">
              {price != null ? (
                <Odometer value={price} rollIn delay={seq.cards} className="display text-[clamp(48px,5.4vw,88px)]" />
              ) : (
                <span className="display text-[clamp(48px,5.4vw,88px)] text-steel">No quote</span>
              )}
            </div>
            {price != null && prevClose != null && ch != null && (
              <div className="mt-1 flex items-center gap-3">
                <span className={clsx("num text-sm", toneOf(ch))}>
                  {ch >= 0 ? "+" : "−"}
                  {inr(Math.abs(price - prevClose))}
                </span>
                <span className={clsx("num text-sm", toneOf(ch))}>{pct(ch)}</span>
              </div>
            )}
            {price != null && row.lo52 != null && row.hi52 != null && (
              <div className="mt-3 max-w-sm">
                <span className="label text-[9px] text-steel">52-week range</span>
                <RangeSlider low={Math.min(row.lo52, price)} high={Math.max(row.hi52, price)} value={price} />
              </div>
            )}
          </div>
        </Rise>

        <div className="col-span-12 flex flex-col items-start gap-3 sm:col-span-5 lg:col-span-3 lg:items-end">
          <Controls row={row} />
          {row.shortVerdict && row.longVerdict ? (
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <VerdictStamp verdict={row.shortVerdict} horizon="Short term / days to weeks" risk={row.risk ?? undefined} delay={seq.charts} />
              <VerdictStamp verdict={row.longVerdict} horizon="Long term / 1 year+" delay={seq.charts + 0.14} />
            </div>
          ) : (
            <span className="num text-[10px] uppercase tracking-wider text-steel">No verdict computed yet</span>
          )}
        </div>
      </div>

      {!ready ? (
        <Card index={1} title="History not loaded">
          <p className="max-w-prose text-[13px] leading-relaxed text-steel">
            {row.backfillStatus === "error" ? (
              <>
                The backfill for this stock failed: <span className="text-amber">{row.backfillError}</span>. Retry with{" "}
                <span className="num text-ink">npm run backfill -- --symbol {row.symbol}</span>.
              </>
            ) : (
              <>
                Candles for this stock have not been backfilled yet (status: {row.backfillStatus}). Run{" "}
                <span className="num text-ink">npm run backfill</span>.
              </>
            )}
          </p>
        </Card>
      ) : (
        <>
          {/* ── Chart + scores ── */}
          <div className="grid grid-cols-12 gap-3">
            <Card index={1} className="col-span-12 h-[620px] xl:col-span-8" bodyClassName="p-0 h-full">
              <CandleChart daily={candles} support={row.support} resistance={row.resistance} />
            </Card>

            <div className="col-span-12 flex flex-col gap-3 xl:col-span-4">
              <Card index={2} title="Scores" right={<Freshness mode="eod" at={row.indDate} />}>
                <div className="flex items-center justify-around gap-2">
                  {row.tech != null ? (
                    <RadialGauge value={row.tech} label="Technical" size={156} primary />
                  ) : (
                    <EmptyGauge label="Technical" phase={1} />
                  )}
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                      {row.event != null ? (
                        <RadialGauge value={row.event} label="Event" size={92} delay={seq.charts + 0.1} />
                      ) : (
                        <div className="flex w-[92px] flex-col items-center justify-center gap-1 text-center">
                          <span className="num text-[10px] text-steel">no data</span>
                          <span className="label text-[10px] text-steel/70">Event</span>
                        </div>
                      )}
                      {detail.external?.score != null ? (
                        <RadialGauge value={detail.external.score} label="External" size={92} delay={seq.charts + 0.14} />
                      ) : (
                        <div className="flex w-[92px] flex-col items-center justify-center gap-1 text-center">
                          <span className="num text-[10px] text-steel">no AI read</span>
                          <span className="label text-[10px] text-steel/70">External</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3">
                      {row.overall != null ? (
                        <RadialGauge value={row.overall} label="Overall" size={92} delay={seq.charts + 0.18} />
                      ) : (
                        <EmptyGauge label="Overall" phase={3} />
                      )}
                      <div className="flex w-[92px] flex-col justify-center gap-1">
                        <span className="label text-[9px] text-steel">Next result</span>
                        <span className={clsx("display text-2xl", !upcoming && "text-steel")}>
                          {upcoming ? shortDate(row.nextResultDate!) : "Unknown"}
                        </span>
                        {upcoming && (
                          <span className={clsx("num text-[10px]", daysToResult! <= 30 ? "text-amber" : "text-steel")}>
                            in {daysToResult}d{row.nextResultEstimate ? " / est." : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
              <Card index={3} title="Trade frame" right={<Freshness mode="eod" at={row.indDate} />} className="flex-1">
                {price != null && row.stop != null && row.target != null ? (
                  <RewardRisk price={price} stop={row.stop} target={row.target} />
                ) : (
                  <p className="text-[12.5px] text-steel">Not enough history to set levels.</p>
                )}
              </Card>
              <Card index={4} title="Technicals" right={<Freshness mode="eod" at={row.indDate} />}>
                {price != null && <Tech row={row} price={price} />}
              </Card>
            </div>
          </div>

          {/* ── Verdict, signals, score reasons ── */}
          <div className="grid grid-cols-12 gap-3">
            <Card index={5} className="col-span-12 md:col-span-6 xl:col-span-4" title="Why this verdict" right={<Freshness mode="eod" at={row.indDate} />}>
              <div className="flex flex-col gap-4">
                <ReasonList title={`Short term${row.shortScore != null ? ` / ${row.shortScore} of 100` : ""}`} items={row.shortReasons} start={0} />
                <ReasonList title={`Long term${row.longScore != null ? ` / ${row.longScore} of 100` : ""}`} items={row.longReasons} start={5} />
                <p className="num border-t border-line pt-2.5 text-[10px] uppercase leading-relaxed tracking-wider text-steel">
                  65+ favourable / 45-64 neutral / under 45 avoid. Mechanical reading, not advice.
                </p>
              </div>
            </Card>

            <Card index={6} className="col-span-12 md:col-span-6 xl:col-span-4" title="Signals and measured odds" right={<Freshness mode="text" label="10Y backtest" />}>
              <div className="flex flex-col gap-4">
                <div className="num grid grid-cols-[28px_1fr_38px_56px] gap-2 text-[9px] uppercase tracking-wider text-steel">
                  <span />
                  <span>Hit rate / marker = any day</span>
                  <span className="text-right">Hit</span>
                  <span className="text-right">Avg move</span>
                </div>
                {SIGNALS.map((sig, i) => {
                  const active = row[sig.key];
                  const own = backtests.stock.find((b) => b.kind === sig.kind);
                  const sec = backtests.sector.find((b) => b.kind === sig.kind);
                  const use: SignalStats | undefined = own && own.windows[1].samples >= 8 ? own : sec ?? own;
                  return (
                    <div key={sig.key} className={clsx(!active && "opacity-60")}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="label flex items-center gap-2 text-[11px] text-ink">
                          <span className={clsx("inline-block size-1.5 rotate-45", active ? "bg-amber" : "bg-line")} />
                          {sig.label}
                          <span className={active ? "text-amber" : "text-steel"}>{active ? "active" : "not active"}</span>
                        </span>
                        {use && (
                          <span className="num whitespace-nowrap text-[10px] text-steel">
                            {use.scope === "stock" ? "this stock" : `sector: ${use.scopeKey}`.slice(0, 26)} / n = {use.windows[1].samples}
                          </span>
                        )}
                      </div>
                      <p className="mb-2 pl-3.5 text-[11.5px] leading-snug text-steel">
                        {sig.rule} {sig.kind === "Breakdown" ? "Hit = price lower afterwards." : "Hit = price higher afterwards."}
                      </p>
                      {use ? (
                        <HitRateBars windows={use.windows} delay={seq.charts + i * 0.12} />
                      ) : (
                        <p className="num pl-3.5 text-[10px] uppercase tracking-wider text-steel">No backtest stored yet</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card index={7} className="col-span-12 xl:col-span-4" title="Behind the scores" right={<Freshness mode="text" label={row.fundamentalsAt ? `Results checked ${fmtIST(row.fundamentalsAt)}` : "Results not fetched"} />}>
              <div className="flex flex-col gap-4">
                <ReasonList title={`Technical${row.tech != null ? ` / ${row.tech}` : ""}`} items={row.techReasons} start={0} />
                <ReasonList title={`Event${row.event != null ? ` / ${row.event}` : ""}`} items={row.eventReasons} start={5} empty="Results have not been fetched for this stock yet." />
              </div>
            </Card>

            <Results row={row} quarters={quarters} upcoming={upcoming} daysToResult={daysToResult} />

            <ExternalCard symbol={row.symbol} read={detail.external} index={9} />
          </div>
        </>
      )}
    </div>
  );
}
