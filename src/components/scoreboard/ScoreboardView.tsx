"use client";

import clsx from "clsx";
import type { Scoreboard } from "@/lib/data";
import { inr, pct } from "@/lib/format";
import { fmtIST } from "@/lib/market";
import { MIN_TRADES_TO_JUDGE, type MarkedTrade, type PaperStats } from "@/lib/paper";
import { TypeIn } from "../motion/primitives";
import { StockLink } from "../shell/StockLink";
import { Card, Stat } from "../ui/core";

const rupees = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const tone = (v: number | null) => (v == null || v === 0 ? "text-steel" : v > 0 ? "text-gain" : "text-loss");
const pctOr = (v: number | null, d = 1) => (v == null ? "—" : pct(v, d));

const GRID = "grid grid-cols-[minmax(150px,1.4fr)_56px_48px_64px_64px_64px_72px_96px_80px_80px] items-center gap-3 px-3.5";

function StatsTable({ rows }: { rows: PaperStats[] }) {
  if (!rows.length) return <p className="px-3.5 py-3 text-[12.5px] text-steel">No filled trades yet.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[880px]">
        <div className={clsx(GRID, "label h-8 border-b border-line text-[10px] text-steel")}>
          <span>Group</span>
          <span className="justify-self-end">Closed</span>
          <span className="justify-self-end">Open</span>
          <span className="justify-self-end">Win rate</span>
          <span className="justify-self-end">Avg win</span>
          <span className="justify-self-end">Avg loss</span>
          <span className="justify-self-end">Expectancy</span>
          <span className="justify-self-end">P&amp;L</span>
          <span className="justify-self-end">Return</span>
          <span className="justify-self-end">Nifty 50</span>
        </div>
        {rows.map((s) => (
          <div key={s.label} className={clsx(GRID, "min-h-9 border-b border-line/70 py-1.5")}>
            <span className="text-[12px] text-ink">
              {s.label}
              {!s.enough && <span className="num ml-2 text-[10px] text-amber">too few trades to judge</span>}
            </span>
            <span className="num justify-self-end text-[12px] text-ink">{s.closed}</span>
            <span className="num justify-self-end text-[12px] text-steel">{s.open}</span>
            <span className="num justify-self-end text-[12px] text-ink">{s.winRate == null ? "—" : `${s.winRate.toFixed(0)}%`}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(s.avgWin))}>{pctOr(s.avgWin)}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(s.avgLoss))}>{pctOr(s.avgLoss)}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(s.expectancy))}>{pctOr(s.expectancy, 2)}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(s.closedPnl + s.openPnl))}>{rupees(s.closedPnl + s.openPnl)}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(s.totalReturn))}>{pctOr(s.totalReturn, 2)}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(s.niftyReturn))}>{pctOr(s.niftyReturn, 2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const T_GRID = "grid grid-cols-[110px_40px_minmax(120px,1fr)_92px_92px_84px_96px_minmax(120px,1fr)] items-center gap-3 px-3.5";

function Trades({ rows }: { rows: MarkedTrade[] }) {
  if (!rows.length) return <p className="px-3.5 py-3 text-[12.5px] text-steel">Nothing has filled yet.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className={clsx(T_GRID, "label h-8 border-b border-line text-[10px] text-steel")}>
          <span>Stock</span>
          <span>Type</span>
          <span>Entered</span>
          <span className="justify-self-end">Entry</span>
          <span className="justify-self-end">Exit</span>
          <span className="justify-self-end">Return</span>
          <span className="justify-self-end">P&amp;L</span>
          <span>Status</span>
        </div>
        {rows.map(({ trade: t, pnlInr, pnlPct, closed }) => (
          <div key={t.id} className={clsx(T_GRID, "h-9 border-b border-line/70")}>
            <StockLink symbol={t.symbol} slot="score" className="display text-[14px] tracking-wide hover:text-amber">
              {t.symbol}
            </StockLink>
            <span className="num text-[11px] text-steel">{t.horizon}</span>
            <span className="num text-[11px] text-steel">{t.entryAt ? fmtIST(t.entryAt) : "—"}</span>
            <span className="num justify-self-end text-[12px] text-ink">{t.entryPrice != null ? inr(t.entryPrice) : "—"}</span>
            <span className="num justify-self-end text-[12px] text-ink">{t.exitPrice != null ? inr(t.exitPrice) : "—"}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(pnlPct))}>{pct(pnlPct, 2)}</span>
            <span className={clsx("num justify-self-end text-[12px]", tone(pnlInr))}>{rupees(pnlInr)}</span>
            <span className="num truncate text-[11px] text-steel">
              {closed ? `closed: ${t.exitReason ?? "—"}` : t.status === "closing" ? "closing at next quote" : (t.flag ?? "open")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Board({ b, index }: { b: Scoreboard; index: number }) {
  const o = b.overall;
  const title = b.book === "mine" ? "My paper trades" : "Shadow portfolio";
  const blurb =
    b.book === "mine"
      ? "Trades you opened from the stocks list."
      : "Opened automatically, in equal notional size, for every new short-term Favourable with a Good entry and every new long-term Favourable. It measures the system without your selection.";
  return (
    <section className="flex flex-col gap-3">
      <Card index={index} title={title} right={<span className="num text-[10px] uppercase tracking-wider text-steel">{b.pending} waiting to fill</span>}>
        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-steel">{blurb}</p>
        {o.closed + o.open === 0 ? (
          <p className="text-[12.5px] text-ink">No trades have filled yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-10 gap-y-5">
              <Stat label="Closed trades">
                <span className="display text-4xl">{o.closed}</span>
                <span className="num text-[10px] text-steel">{o.open} open</span>
              </Stat>
              <Stat label="Win rate">
                <span className="display text-4xl">{o.winRate == null ? "—" : `${o.winRate.toFixed(0)}%`}</span>
              </Stat>
              <Stat label="Average win / loss">
                <span className="display text-4xl">
                  <span className={tone(o.avgWin)}>{pctOr(o.avgWin)}</span> <span className="text-steel">/</span> <span className={tone(o.avgLoss)}>{pctOr(o.avgLoss)}</span>
                </span>
              </Stat>
              <Stat label="Expectancy per trade">
                <span className={clsx("display text-4xl", tone(o.expectancy))}>{pctOr(o.expectancy, 2)}</span>
              </Stat>
              <Stat label="Total return">
                <span className={clsx("display text-4xl", tone(o.totalReturn))}>{pctOr(o.totalReturn, 2)}</span>
                <span className="num text-[10px] text-steel">
                  {rupees(o.closedPnl + o.openPnl)} on ₹{Math.round(o.invested).toLocaleString("en-IN")}
                </span>
              </Stat>
              <Stat label="Same money in Nifty 50">
                <span className={clsx("display text-4xl", tone(o.niftyReturn))}>{pctOr(o.niftyReturn, 2)}</span>
                <span className="num text-[10px] text-steel">{o.niftyPnl == null ? "no index price at entry" : `${rupees(o.niftyPnl)}, same dates and cost`}</span>
              </Stat>
            </div>
            {!o.enough && (
              <p className="num mt-4 border-t border-line pt-3 text-[11px] uppercase tracking-wider text-amber">
                Too few trades to judge: {o.closed} closed, at least {MIN_TRADES_TO_JUDGE} needed before these numbers mean anything.
              </p>
            )}
          </>
        )}
      </Card>
      {o.closed + o.open > 0 && (
        <div className="grid grid-cols-12 gap-3">
          <Card index={index + 1} className="col-span-12 xl:col-span-6" title="By horizon" bodyClassName="p-0">
            <StatsTable rows={b.byHorizon} />
          </Card>
          <Card index={index + 1} className="col-span-12 xl:col-span-6" title="By signal at entry" bodyClassName="p-0">
            <StatsTable rows={b.bySignal} />
          </Card>
          <Card index={index + 2} className="col-span-12 xl:col-span-6" title="By entry rating" bodyClassName="p-0">
            <StatsTable rows={b.byEntry} />
          </Card>
          <Card index={index + 2} className="col-span-12 xl:col-span-6" title="By market regime at entry" bodyClassName="p-0">
            <StatsTable rows={b.byRegime} />
          </Card>
          <Card index={index + 3} className="col-span-12" title="Latest trades" bodyClassName="p-0">
            <Trades rows={b.recent} />
          </Card>
        </div>
      )}
    </section>
  );
}

/** Paper-trading results for the user's own trades and for the automatic shadow portfolio, kept apart. */
export function ScoreboardView({ boards, quotesAt }: { boards: Scoreboard[]; quotesAt: string | null }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TypeIn className="display text-[clamp(40px,4.6vw,72px)]" segments={[{ text: "Scoreboard", accent: true }, { text: " of paper trades." }]} />
        <span className="num text-[10px] uppercase tracking-wider text-steel">{quotesAt ? `Open trades marked at quotes of ${fmtIST(quotesAt)}` : "No quotes yet"}</span>
      </div>
      {boards.map((b, i) => (
        <Board key={b.book} b={b} index={i * 4} />
      ))}
      <p className="max-w-prose text-[11px] leading-relaxed text-steel">
        These are pretend trades for learning. No order is placed anywhere. Returns are after the round-trip cost setting, half charged on entry and
        half on exit. Win rate, average win and loss and expectancy use closed trades only; total return also counts open trades at the latest
        quote. Not investment advice.
      </p>
    </div>
  );
}
