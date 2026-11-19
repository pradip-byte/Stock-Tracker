"use client";

import Link from "next/link";
import { ViewTransition, useSyncExternalStore, type ReactNode } from "react";

/**
 * Shared-element transition between a list row and the stock detail page.
 * A symbol can appear in several lists, and a view-transition name must be
 * unique on the page, so only the row that was clicked carries the name.
 */
let origin: string | null = null;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
function setOrigin(v: string) {
  origin = v;
  subs.forEach((fn) => fn());
}

export const vtName = (symbol: string) => `stock-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`;
export const stockHref = (symbol: string) => `/stock/${encodeURIComponent(symbol)}`;

export function StockLink({
  symbol,
  slot,
  className,
  children,
}: {
  symbol: string;
  slot: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={stockHref(symbol)} className={className} onClick={() => setOrigin(`${slot}:${symbol}`)}>
      {children}
    </Link>
  );
}

/** The symbol text that morphs into the detail page heading. */
export function SymbolMark({ symbol, slot, className }: { symbol: string; slot: string; className?: string }) {
  const o = useSyncExternalStore(
    subscribe,
    () => origin,
    () => null,
  );
  const el = <span className={className}>{symbol}</span>;
  return o === `${slot}:${symbol}` ? <ViewTransition name={vtName(symbol)}>{el}</ViewTransition> : el;
}
