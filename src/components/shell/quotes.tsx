"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Quote, Quotes } from "@/lib/types";

const Ctx = createContext<{ quotes: Quotes; asOf: string | null }>({ quotes: {}, asOf: null });

/**
 * Latest stored quote per symbol for the whole app. Starts from the server
 * render and re-reads quotes_latest once a minute while the tab is visible.
 * The cron job refreshes that table every 15 minutes in market hours.
 */
export function QuotesProvider({ initial, children }: { initial: Quotes; children: ReactNode }) {
  const [quotes, setQuotes] = useState(initial);

  useEffect(() => setQuotes(initial), [initial]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (res.ok && !stop) setQuotes(await res.json());
      } catch {
        // keep showing the last known quotes; their timestamps tell the truth
      }
    };
    const id = setInterval(tick, 60000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const value = useMemo(() => {
    let asOf: string | null = null;
    for (const q of Object.values(quotes)) if (q.marketTime && (!asOf || q.marketTime > asOf)) asOf = q.marketTime;
    return { quotes, asOf };
  }, [quotes]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuote(symbol: string): Quote | null {
  return useContext(Ctx).quotes[symbol] ?? null;
}

export function useQuotes(): Quotes {
  return useContext(Ctx).quotes;
}

/** Timestamp of the newest quote in the feed. */
export function useQuotesAsOf(): string | null {
  return useContext(Ctx).asOf;
}
