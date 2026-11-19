"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addStockAction } from "@/app/actions";
import { dur, ease } from "../motion/tokens";
import { Button } from "../ui/core";
import { stockHref } from "./StockLink";

/** Add any NSE stock. Adding one validates the symbol, then backfills 10 years of candles. */
export function AddStock() {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addStockAction(symbol);
      if (!res.ok) return setError(res.error ?? "Could not add that stock.");
      setOpen(false);
      setSymbol("");
      if (res.symbol) router.push(stockHref(res.symbol));
    });
  };

  return (
    <div className="relative shrink-0">
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="whitespace-nowrap">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M5 0v10M0 5h10" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Add stock
      </Button>
      <AnimatePresence>
        {open && (
          <motion.form
            onSubmit={submit}
            className="metal-raised absolute right-0 top-10 z-50 flex w-72 flex-col gap-3 rounded-md p-3.5"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: dur.xs, ease: ease.out }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="label text-[10px] text-steel">NSE symbol</span>
              <input
                autoFocus
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. DIXON"
                className="num h-9 rounded-sm border border-line bg-night px-2.5 text-sm text-ink outline-none placeholder:text-steel/50 focus:border-amber"
              />
            </label>
            {error && (
              <p role="alert" className="num text-[11px] leading-snug text-amber">
                {error}
              </p>
            )}
            <p className="text-[11px] leading-snug text-steel">
              {pending ? "Checking the symbol and pulling 10 years of candles. This takes a few seconds." : "The symbol is checked with the data provider, then its history is backfilled."}
            </p>
            <Button type="submit" disabled={pending || !symbol} className="justify-center disabled:opacity-60">
              {pending ? "Adding" : "Add and backfill"}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
