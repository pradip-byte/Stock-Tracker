"use client";

import clsx from "clsx";
import { inr, pct, shortDate } from "@/lib/format";
import type { MacroEvent, MacroView } from "@/lib/macro";
import { fmtIST } from "@/lib/market";
import { Card } from "../ui/core";
import { Freshness } from "../ui/Freshness";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const tone = (v: number | null) => (v == null || v === 0 ? "text-steel" : v > 0 ? "text-gain" : "text-loss");
const signedPts = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/** Measured move after an event, or a plain "not yet" while the sessions have not happened. */
function Moves({ d1, d5, d20 }: { d1: number | null; d5: number | null; d20: number | null }) {
  const cell = (label: string, v: number | null) => (
    <span className="num text-[10px]">
      <span className="text-steel">{label} </span>
      <span className={tone(v)}>{v == null ? "not yet" : pct(v, 1)}</span>
    </span>
  );
  return (
    <span className="flex flex-wrap gap-x-3">
      {cell("1 session", d1)}
      {cell("5", d5)}
      {cell("20", d20)}
    </span>
  );
}

function EventRow({ e }: { e: MacroEvent }) {
  const effects = [...e.helped.map((x) => ({ ...x, kind: "helps" as const })), ...e.hurt.map((x) => ({ ...x, kind: "hurts" as const }))];
  return (
    <li className="border-t border-line/70 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="label text-[10px] text-amber">{e.category}</span>
        <span className="num text-[10px] text-steel">{shortDate(e.eventDate)}</span>
        <a href={e.url} target="_blank" rel="noreferrer noopener" className="num text-[10px] text-steel underline decoration-line underline-offset-2 hover:text-amber">
          {host(e.url)}, {shortDate(e.published)}
        </a>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-ink">{e.title}</p>
      {e.summary && <p className="mt-0.5 text-[12px] leading-snug text-steel">{e.summary}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label text-[9px] text-steel">Nifty 50 after</span>
        <Moves {...e.nifty} />
      </div>
      {effects.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {effects.map((x) => {
            const m = e.sectorMoves[x.sector];
            return (
              <li key={`${x.kind}-${x.sector}`} className="grid grid-cols-[52px_1fr] gap-x-2 text-[12px] leading-snug">
                <span className={clsx("label pt-0.5 text-[9px]", x.kind === "helps" ? "text-ink" : "text-steel")}>{x.kind}</span>
                <span>
                  <span className="text-ink">{x.sector}</span>
                  <span className="text-steel">: {x.why}</span>
                  {m && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3">
                      <span className="label text-[9px] text-steel">Our {m.stocks} stocks after</span>
                      <Moves d1={m.d1} d5={m.d5} d20={m.d20} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** Regime label with the inputs behind it, the macro numbers, and the weekly AI note with what each event was followed by. */
export function MacroPanel({ macro }: { macro: MacroView }) {
  return (
    <>
      <Card
        index={3}
        className="col-span-12 xl:col-span-5"
        title="Market regime"
        right={<Freshness mode="eod" at={macro.date} />}
      >
        {macro.regime == null ? (
          <p className="text-[12.5px] text-steel">No regime read yet. It is written at the end of each day&apos;s run.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
              <span className={clsx("display text-5xl", macro.regime === "Risk-on" ? "text-amber" : "text-ink")}>{macro.regime}</span>
              <span className="num pb-1.5 text-[11px] text-steel">score {signedPts(macro.score ?? 0)} from the inputs below (+2 or more is Risk-on, −2 or less is Risk-off)</span>
            </div>
            <ul className="flex flex-col">
              {macro.inputs.map((i) => (
                <li key={i.key} className="grid grid-cols-[1fr_72px_32px] items-baseline gap-3 border-t border-line/70 py-1.5">
                  <span className="text-[12px] text-ink">
                    {i.label} <span className="text-steel">/ {i.note}</span>
                  </span>
                  <span className="num justify-self-end text-[12px] text-ink">{i.value}</span>
                  <span className={clsx("num justify-self-end text-[12px]", i.points > 0 ? "text-amber" : "text-steel")}>{signedPts(i.points)}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-line pt-3 sm:grid-cols-3">
              {macro.series.map((s) => (
                <div key={s.id}>
                  <span className="label block text-[9px] text-steel">{s.label}</span>
                  {s.point ? (
                    <>
                      <span className="num text-[14px] text-ink">
                        {s.unit === "%" ? `${s.point.value.toFixed(2)}%` : `${s.unit}${inr(s.point.value, s.point.value > 1000 ? 0 : 2)}`}
                      </span>
                      <span className="num block text-[10px]">
                        <span className={tone(s.point.chg1)}>{s.point.chg1 == null ? "—" : pct(s.point.chg1, 1)}</span>
                        <span className="text-steel"> day / </span>
                        <span className={tone(s.point.chg20)}>{s.point.chg20 == null ? "—" : pct(s.point.chg20, 1)}</span>
                        <span className="text-steel"> 20 sessions / {shortDate(s.point.date)}</span>
                      </span>
                    </>
                  ) : (
                    <span className="num text-[12px] text-steel">no data</span>
                  )}
                </div>
              ))}
              <div>
                <span className="label block text-[9px] text-steel">Breadth, our {macro.breadthCount ?? "—"} stocks</span>
                <span className="num text-[14px] text-ink">
                  {macro.breadth50 == null ? "—" : `${macro.breadth50.toFixed(0)}%`} <span className="text-[10px] text-steel">above 50 DMA</span>
                </span>
                <span className="num block text-[10px] text-steel">{macro.breadth200 == null ? "—" : `${macro.breadth200.toFixed(0)}%`} above 200 DMA</span>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-steel">
              The thresholds are round conventional numbers, not fitted. In testing, market regime did not give a consistent answer across
              periods, so the label is context only. The one rule that acts on it: a positive technical score earns no short-term credit while
              Nifty 50 is below its 200 DMA. US figures are the latest close before this session.
            </p>
          </div>
        )}
      </Card>
      <Card
        index={4}
        className="col-span-12 xl:col-span-7"
        title="What is moving the market"
        right={
          <span className="flex items-center gap-3">
            {macro.note?.lowGrade && <span className="label rounded-sm border border-amber/60 px-1.5 py-1 text-[10px] text-amber">Low-grade sources</span>}
            <span className="num text-[10px] uppercase tracking-wider text-steel">{macro.note ? `AI note ${fmtIST(macro.note.runAt)}` : "No AI note yet"}</span>
          </span>
        }
      >
        {!macro.note ? (
          <p className="text-[12.5px] text-steel">The weekly macro note has not run yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {macro.note.summary && <p className="max-w-prose text-[13px] leading-relaxed text-ink">{macro.note.summary}</p>}
            {macro.note.flows && (
              <p className="num text-[11px] leading-relaxed text-steel">
                {macro.note.flows.fii && (
                  <>
                    FII/FPI net: <span className="text-ink">{macro.note.flows.fii}</span>.{" "}
                  </>
                )}
                {macro.note.flows.dii && (
                  <>
                    DII net: <span className="text-ink">{macro.note.flows.dii}</span>.{" "}
                  </>
                )}
                {macro.note.flows.period && <>Period: {macro.note.flows.period}. </>}
                {macro.note.flows.url && (
                  <a href={macro.note.flows.url} target="_blank" rel="noreferrer noopener" className="underline decoration-line underline-offset-2 hover:text-amber">
                    {host(macro.note.flows.url)}
                  </a>
                )}
              </p>
            )}
            {macro.events.length ? (
              <ul className="flex flex-col">
                {macro.events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-steel">The note found no event with a dated source.</p>
            )}
            <p className="text-[11px] leading-snug text-steel">
              &quot;Helps&quot; and &quot;hurts&quot; are the AI&apos;s reasoning. The figures beside them are what Nifty 50 and our stocks in that sector actually
              did afterwards, measured from the last close before the event. One event explains little on its own.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
