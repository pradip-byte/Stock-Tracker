"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { paperBuyAction, paperCloseAction } from "@/app/actions";
import { inr, pct } from "@/lib/format";
import { pnlAt, type PaperHorizon, type PaperTrade } from "@/lib/paper";

const rupees = (v: number) => `${v < 0 ? "−" : "+"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;

/**
 * One paper-trade cell on the stocks list. Empty: a button that takes an amount
 * in rupees. Pending: waiting for the next quote. Open: live return after costs,
 * and for short-term trades the distance to the target and stop.
 */
export function PaperCell({ symbol, horizon, trade, price }: { symbol: string; horizon: PaperHorizon; trade?: PaperTrade; price: number | null }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("25000");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = horizon === "ST" ? "short-term" : "long-term";

  const buy = () =>
    start(async () => {
      setError(null);
      const res = await paperBuyAction(symbol, horizon, Number(amount));
      if (res.ok) setEditing(false);
      else setError(res.error ?? "Could not place the paper trade.");
    });
  const close = (id: number) =>
    start(async () => {
      const res = await paperCloseAction(id);
      if (!res.ok) setError(res.error ?? "Could not close the paper trade.");
    });

  if (!trade) {
    if (!editing) {
      return (
        <button
          onClick={() => setEditing(true)}
          aria-label={`Open a ${label} paper trade in ${symbol}`}
          className="label justify-self-end rounded-sm border border-line px-1.5 py-1 text-[10px] text-steel hover:border-amber hover:text-amber"
        >
          Paper buy
        </button>
      );
    }
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          buy();
        }}
        className="flex items-center justify-end gap-1"
        title={error ?? "Fills at the next quote, or at the next open if the market is closed."}
      >
        <span className="num text-[11px] text-steel">₹</span>
        <input
          autoFocus
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          aria-label={`Amount in rupees for a ${label} paper trade in ${symbol}`}
          className={clsx("num h-6 w-[68px] rounded-sm border bg-night px-1 text-right text-[11px] text-ink outline-none focus:border-amber", error ? "border-amber" : "border-line")}
        />
        <button type="submit" disabled={pending || !amount} className="label rounded-sm border border-amber/70 px-1.5 py-1 text-[10px] text-amber disabled:opacity-50">
          {pending ? "…" : "Go"}
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="num px-0.5 text-[12px] text-steel hover:text-ink">
          ×
        </button>
      </form>
    );
  }

  const closeBtn = (text: string, aria: string) => (
    <button onClick={() => close(trade.id)} disabled={pending} aria-label={aria} title={aria} className="num px-0.5 text-[11px] text-steel hover:text-amber disabled:opacity-50">
      {text}
    </button>
  );

  if (trade.status === "pending") {
    return (
      <span className="flex items-center justify-end gap-1.5">
        <span className="num text-right text-[10px] leading-tight text-steel">
          ₹{Math.round(trade.amount).toLocaleString("en-IN")}
          <br />
          fills at next {trade.fillRule === "open" ? "open" : "quote"}
        </span>
        {closeBtn("×", `Cancel the pending ${label} paper trade in ${symbol}`)}
      </span>
    );
  }

  if (trade.entryPrice == null || trade.qty == null || price == null) return <span className="num justify-self-end text-[10px] text-steel">—</span>;
  const p = pnlAt({ amount: trade.amount, qty: trade.qty, entryPrice: trade.entryPrice, costPct: trade.costPct }, price);
  const tone = p.inr > 0 ? "text-gain" : p.inr < 0 ? "text-loss" : "text-steel";
  const toTarget = trade.target != null ? (trade.target / price - 1) * 100 : null;
  const toStop = trade.stop != null ? (trade.stop / price - 1) * 100 : null;
  const detail = `Bought ₹${Math.round(trade.amount).toLocaleString("en-IN")} at ${inr(trade.entryPrice)}. Return includes a ${trade.costPct}% round-trip cost.${
    trade.target != null && trade.stop != null ? ` Target ${inr(trade.target)}, stop ${inr(trade.stop)}.` : ""
  }`;
  return (
    <span className="flex items-center justify-end gap-1.5" title={detail}>
      <span className="num text-right text-[10px] leading-tight">
        <span className={clsx("text-[11px]", tone)}>
          {pct(p.pct, 1)} {rupees(p.inr)}
        </span>
        <br />
        {trade.status === "closing" ? (
          <span className="text-steel">closing at next quote</span>
        ) : trade.flag ? (
          <span className="text-amber">{trade.flag}</span>
        ) : toTarget != null && toStop != null ? (
          <span className="text-steel">
            target {pct(toTarget, 1)} / stop {pct(toStop, 1)}
          </span>
        ) : (
          <span className="text-steel">open</span>
        )}
      </span>
      {trade.status === "open" && closeBtn("Close", `Close the ${label} paper trade in ${symbol} at the next quote`)}
    </span>
  );
}
