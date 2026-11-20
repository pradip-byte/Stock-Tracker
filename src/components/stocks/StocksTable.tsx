"use client";

import clsx from "clsx";
import { useMemo, useState, useTransition } from "react";
import { setWatchlistAction } from "@/app/actions";
import { changePct, dayDiff, inr, pct, shortDate, toneOf } from "@/lib/format";
import type { PaperBySymbol } from "@/lib/data";
import type { StockRow } from "@/lib/types";
import { TypeIn } from "../motion/primitives";
import { useQuote } from "../shell/quotes";
import { StockLink, SymbolMark } from "../shell/StockLink";
import { Card, EntryTag, SignalTag, VerdictTag } from "../ui/core";
import { Freshness } from "../ui/Freshness";
import { Segmented } from "../ui/Segmented";
import { PaperCell } from "./PaperCell";

const COLS =
  "grid grid-cols-[28px_minmax(190px,1.6fr)_minmax(130px,1fr)_96px_76px_48px_minmax(92px,.6fr)_48px_52px_56px_92px_88px_92px_100px_52px_172px_172px] items-center gap-3 px-3.5";
const FILTERS = ["All", "Watchlist", "Signals", "New headlines", "Paper trades", "Results in 30D", "Added by me"] as const;
type SortKey = "symbol" | "tech" | "chg" | "event";

function Row({ r, today, paper, news }: { r: StockRow; today: string; paper?: PaperBySymbol[string]; news: number }) {
  const q = useQuote(r.symbol);
  const price = q?.price ?? r.price;
  const ch = q?.prevClose ? changePct(q.price, q.prevClose) : null;
  const [watch, setWatch] = useState(r.inWatchlist);
  const [, start] = useTransition();
  const upcoming = r.nextResultDate != null && r.nextResultDate >= today;
  const soon = upcoming && dayDiff(today, r.nextResultDate!) <= 30;
  return (
    <div className={clsx(COLS, "h-10 border-b border-line/70 hover:bg-metal-2/60")}>
      <button
        aria-label={watch ? `Remove ${r.symbol} from watchlist` : `Add ${r.symbol} to watchlist`}
        aria-pressed={watch}
        onClick={() =>
          start(async () => {
            setWatch(!watch);
            const res = await setWatchlistAction(r.symbol, !watch);
            if (!res.ok) setWatch(watch);
          })
        }
        className="flex size-6 items-center justify-center"
      >
        <span className={clsx("inline-block size-2 rotate-45", watch ? "bg-amber" : "border border-steel/60")} />
      </button>
      <StockLink symbol={r.symbol} slot="all" className="flex min-w-0 items-baseline gap-2.5 hover:text-amber">
        <SymbolMark symbol={r.symbol} slot="all" className="display text-base tracking-wide" />
        <span className="truncate text-[11px] text-steel">{r.name}</span>
      </StockLink>
      <span className="truncate text-[11px] text-steel">{r.sector ?? "—"}</span>
      <span className="num justify-self-end text-[12px] text-ink">{price != null ? inr(price) : "—"}</span>
      <span className={clsx("num justify-self-end text-[12px]", ch == null ? "text-steel" : toneOf(ch))}>
        {ch == null ? "—" : pct(ch)}
      </span>
      <span className="num justify-self-end text-[12px] text-ink">{r.rsi?.toFixed(0) ?? "—"}</span>
      <SignalTag kind={r.signal} />
      <span className="num justify-self-end text-[12px] text-ink">{r.tech ?? "—"}</span>
      <span className="num justify-self-end text-[12px] text-ink">{r.event ?? "—"}</span>
      <span className="num justify-self-end text-[12px] text-ink">{r.rr != null ? `${r.rr.toFixed(1)}x` : "—"}</span>
      <span className="justify-self-end">
        {r.backfillStatus !== "done" ? (
          <span className="num text-[10px] uppercase tracking-wider text-amber" title={r.backfillError ?? undefined}>
            {r.backfillStatus}
          </span>
        ) : r.shortVerdict ? (
          <VerdictTag verdict={r.shortVerdict} />
        ) : (
          <span className="num text-steel">—</span>
        )}
      </span>
      <span className="justify-self-end">
        {r.entry ? (
          <EntryTag
            rating={r.entry.rating}
            title={
              r.entry.rating === "No setup"
                ? `No setup: ${r.entry.note}`
                : `${r.entry.note} Entry ${r.entry.entryKind === "limit" ? "limit " : ""}${inr(r.entry.entry)}, stop ${inr(r.entry.stop)}, target ${inr(r.entry.target)}${r.entry.rewardRisk != null ? `, reward-to-risk ${r.entry.rewardRisk.toFixed(1)}x` : ""}.`
            }
          />
        ) : (
          <span className="num text-steel">—</span>
        )}
      </span>
      <span className="justify-self-end">{r.longVerdict ? <VerdictTag verdict={r.longVerdict} /> : <span className="num text-steel">—</span>}</span>
      <span className={clsx("num justify-self-end text-[11px]", soon ? "text-amber" : "text-steel")}>
        {upcoming ? `${shortDate(r.nextResultDate!)}${r.nextResultEstimate ? " est." : ""}` : "unknown"}
      </span>
      <span className="justify-self-end">
        {news > 0 ? (
          <StockLink
            symbol={r.symbol}
            slot="news"
            className="num rounded-sm border border-amber/60 px-1.5 py-0.5 text-[11px] text-amber"
          >
            <span title={`${news} headline${news === 1 ? "" : "s"} since you last opened ${r.symbol}`}>{news}</span>
          </StockLink>
        ) : (
          <span className="num text-[11px] text-steel">—</span>
        )}
      </span>
      <PaperCell symbol={r.symbol} horizon="ST" trade={paper?.ST} price={price} />
      <PaperCell symbol={r.symbol} horizon="LT" trade={paper?.LT} price={price} />
    </div>
  );
}

/** Every tracked stock, with search, filters, sorting and the watchlist toggle. */
export function StocksTable({ rows, today, paper, news }: { rows: StockRow[]; today: string; paper: PaperBySymbol; news: Record<string, number> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [sort, setSort] = useState<SortKey>("symbol");
  const eodDate = rows.reduce<string | null>((m, r) => (r.indDate && (!m || r.indDate > m) ? r.indDate : m), null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (q && !r.symbol.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && !(r.sector ?? "").toLowerCase().includes(q)) return false;
      if (filter === "Watchlist") return r.inWatchlist;
      if (filter === "Signals") return r.signal != null;
      if (filter === "Paper trades") return paper[r.symbol] != null;
      if (filter === "New headlines") return (news[r.symbol] ?? 0) > 0;
      if (filter === "Added by me") return r.source === "user";
      if (filter === "Results in 30D") return r.nextResultDate != null && r.nextResultDate >= today && dayDiff(today, r.nextResultDate) <= 30;
      return true;
    });
    if (sort === "tech") list.sort((a, b) => (b.tech ?? -1) - (a.tech ?? -1));
    else if (sort === "event") list.sort((a, b) => (b.event ?? -1) - (a.event ?? -1));
    else if (sort === "chg") {
      const c = (r: StockRow) => (r.price != null && r.prevClose ? changePct(r.price, r.prevClose) : -999);
      list.sort((a, b) => c(b) - c(a));
    } else list.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return list;
  }, [rows, query, filter, sort, today, paper, news]);

  const head = (label: string, key?: SortKey, end = true) => (
    <span className={end ? "justify-self-end" : undefined}>
      {key ? (
        <button onClick={() => setSort(key)} className={clsx("label text-[10px]", sort === key ? "text-amber" : "text-steel hover:text-ink")}>
          {label}
        </button>
      ) : (
        label
      )}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TypeIn
          className="display text-[clamp(40px,4.6vw,72px)]"
          segments={[{ text: `${rows.length} stocks`, accent: true }, { text: " tracked." }]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol, name or sector"
            aria-label="Search stocks"
            className="num h-8 w-64 rounded-sm border border-line bg-night px-2.5 text-[12px] text-ink outline-none placeholder:text-steel/50 focus:border-amber"
          />
          <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Filter" />
        </div>
      </div>
      <Card
        title={`${shown.length} shown`}
        right={<Freshness mode="eod" at={eodDate} />}
        bodyClassName="overflow-x-auto"
      >
        <div className="min-w-[1835px]">
          <div className={clsx(COLS, "label h-8 border-b border-line text-[10px] text-steel")}>
            <span />
            {head("Stock", "symbol", false)}
            <span>Sector</span>
            {head("Price")}
            {head("Chg", "chg")}
            {head("RSI")}
            <span>Signal</span>
            {head("Tech", "tech")}
            {head("Event", "event")}
            {head("R:R")}
            {head("Short term")}
            {head("Entry")}
            {head("Long term")}
            {head("Next result")}
            {head("News")}
            {head("Paper ST")}
            {head("Paper LT")}
          </div>
          {shown.map((r) => (
            <Row key={r.symbol} r={r} today={today} paper={paper[r.symbol]} news={news[r.symbol] ?? 0} />
          ))}
          {shown.length === 0 && <p className="p-4 text-[12.5px] text-steel">Nothing matches.</p>}
        </div>
      </Card>
      <p className="text-[11px] text-steel">
        The News column counts headlines that arrived since you last opened that stock&apos;s page. Paper trades are pretend trades for learning: no order is placed anywhere. A paper buy fills at the next quote, or at the next
        open if the market is closed, and returns are shown after the cost setting. Short-term trades close at their target, their stop or
        after 20 sessions. Add a stock with the button in the top bar. To remove one, open it and use Remove; its candles and scores are deleted with it.
      </p>
    </div>
  );
}
