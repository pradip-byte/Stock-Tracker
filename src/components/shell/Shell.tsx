"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { signOut } from "@/app/actions";
import { changePct, pct, toneOf } from "@/lib/format";
import { INDEX_SYMBOLS } from "@/lib/types";
import { Odometer } from "../motion/Odometer";
import { Freshness } from "../ui/Freshness";
import { AddStock } from "./AddStock";
import { useQuotes } from "./quotes";
import { StockLink } from "./StockLink";

const NAV = [
  { label: "Dashboard", href: "/" },
  { label: "Stocks", href: "/stocks" },
  { label: "Scoreboard", href: "/scoreboard" },
  { label: "Admin", href: "/admin" },
] as const;

export function TopBar() {
  const path = usePathname();
  return (
    <header className="metal sticky top-0 z-40 flex h-12 items-center gap-6 border-x-0 border-t-0 px-4">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="inline-block size-3 rotate-45 bg-amber" />
        <span className="display whitespace-nowrap text-xl tracking-wide">
          Stock<span className="text-steel">/</span>Tracker
        </span>
      </Link>
      <nav className="flex h-full items-stretch gap-1">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.label}
              href={n.href}
              className={clsx(
                "label relative flex items-center px-2.5 text-[11px]",
                active ? "text-ink" : "text-steel hover:text-ink",
              )}
            >
              {n.label}
              {active && <span className="absolute inset-x-2.5 bottom-0 h-px bg-amber" />}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        <span className="hidden md:block">
          <Freshness mode="quote" />
        </span>
        <AddStock />
        <form action={signOut} className="hidden sm:block">
          <button className="label text-[11px] text-steel hover:text-ink">Sign out</button>
        </form>
      </div>
    </header>
  );
}

/** Slow ambient tape of the day's biggest movers. Pauses on hover. */
export function TickerTape() {
  const quotes = useQuotes();
  const empty = Object.keys(quotes).length === 0;
  // Membership is fixed once quotes exist so items do not jump while scrolling.
  const order = useMemo(
    () =>
      Object.keys(quotes)
        .filter((s) => !(INDEX_SYMBOLS as readonly string[]).includes(s) && quotes[s].prevClose)
        .sort(
          (a, b) =>
            Math.abs(changePct(quotes[b].price, quotes[b].prevClose!)) -
            Math.abs(changePct(quotes[a].price, quotes[a].prevClose!)),
        )
        .slice(0, 16),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empty],
  );
  if (order.length < 6) return null;
  const items = [...order, ...order];
  return (
    <div className="group relative h-8 overflow-hidden border-b border-line bg-night" aria-label="Top movers">
      <div className="flex h-full w-max animate-ticker items-center group-hover:[animation-play-state:paused]">
        {items.map((s, i) => {
          const q = quotes[s];
          if (!q) return null;
          const ch = changePct(q.price, q.prevClose ?? q.price);
          return (
            <StockLink
              key={`${s}-${i}`}
              symbol={s}
              slot="tape"
              className="flex items-center gap-2.5 border-r border-line px-4 text-[11px] hover:bg-metal-1"
            >
              <span className="label text-[11px] text-ink">{s}</span>
              <Odometer value={q.price} className="num text-steel" flash={false} />
              <span className={clsx("num", toneOf(ch))}>{pct(ch)}</span>
            </StockLink>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-night to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-night to-transparent" />
    </div>
  );
}

export function Disclaimer() {
  return (
    <footer className="mt-6 border-t border-line px-4 py-4 text-[11px] leading-relaxed text-steel">
      <p className="max-w-3xl">
        <span className="label mr-2 text-[10px] text-amber">Disclaimer</span>
        This is a personal, informational tool. Nothing here is investment advice or a recommendation to buy or
        sell any security. Scores, signals and levels are mechanical estimates and can be wrong. Quotes come from
        Yahoo Finance and may be delayed; check the freshness stamp on every panel before relying on a number.
      </p>
      <p className="mt-2">
        Candlestick charts use{" "}
        <a className="underline hover:text-ink" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts
        </a>
        .
      </p>
    </footer>
  );
}
