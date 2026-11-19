"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { eodState, fmtIST, quoteState, type FreshState } from "@/lib/market";
import { shortDate } from "@/lib/format";
import { useQuotesAsOf } from "../shell/quotes";

const WORD: Record<FreshState, string> = {
  live: "Live",
  close: "At close",
  eod: "EOD",
  stale: "Stale",
  none: "No data",
};

function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Data freshness stamp. Every data block carries one.
 *  quote: timestamp of a quote (pass `at`, or omit it to use the newest quote in the feed)
 *  eod:   session date the indicators and scores were computed for
 *  text:  a fixed note, for panels that are not time-based
 * Stale or missing data turns the marker amber.
 */
export function Freshness(
  props: { mode: "quote"; at?: string | null } | { mode: "eod"; at: string | null } | { mode: "text"; label: string },
) {
  const now = useNow();
  const feedAsOf = useQuotesAsOf();
  let state: FreshState | null = null;
  let label: string;
  if (props.mode === "text") label = props.label;
  else if (props.mode === "eod") {
    state = now ? eodState(props.at, now) : null;
    label = props.at ? shortDate(props.at) : "";
  } else {
    const at = props.at === undefined ? feedAsOf : props.at;
    state = now ? quoteState(at, now) : null;
    label = at ? fmtIST(at) : "";
  }
  const warn = state === "stale" || state === "none";
  return (
    <span
      className={clsx(
        "num inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase tracking-wider",
        warn ? "text-amber" : "text-steel",
      )}
    >
      <span className={clsx("inline-block size-1.5 rounded-sm", warn ? "bg-amber" : "bg-steel")} />
      {state && WORD[state]}
      {state && label && <span className="text-line">/</span>}
      {label}
    </span>
  );
}
