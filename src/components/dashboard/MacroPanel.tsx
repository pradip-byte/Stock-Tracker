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
const crore = (v: number) => `${v < 0 ? "−" : "+"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")} crore`;
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
  const effects = [
    ...e.helped.map((x) => ({ ...x, kind: "helps" })),
    ...e.hurt.map((x) => ({ ...x, kind: "hurts" })),
    ...e.exposed.map((x) => ({ ...x, kind: "watch" })),
  ];
  return (
    <li className="border-t border-line/70 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="label text-[10px] text-amber">{e.category}</span>
        <span className="num text-[10px] text-steel">{shortDate(e.eventDate)}</span>
        <a href={e.url} target="_blank" rel="noreferrer noopener" className="num text-[10px] text-steel underline decoration-line underline-offset-2 hover:text-amber">
          {e.source ?? host(e.url)}, {shortDate(e.published)}
        </a>
        <span className="num text-[10px] text-steel">{e.origin === "feed" ? "from tagged headlines" : "from an earlier AI note"}</span>
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
        title="Market headlines"
        right={
          <span className="num text-[10px] uppercase tracking-wider text-steel">
            {macro.headlines[0] ? `Newest ${fmtIST(macro.headlines[0].publishedAt)}` : "No tagged headlines yet"}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="num text-[11px] leading-relaxed text-steel">
            FII/DII day figures:{" "}
            {macro.flows ? (
              <>
                FII <span className={tone(macro.flows.fii)}>{macro.flows.fii == null ? "not available" : crore(macro.flows.fii)}</span>, DII{" "}
                <span className={tone(macro.flows.dii)}>{macro.flows.dii == null ? "not available" : crore(macro.flows.dii)}</span>, headline of{" "}
                {shortDate(macro.flows.date)} /{" "}
                <a href={macro.flows.url} target="_blank" rel="noreferrer noopener" title={macro.flows.title} className="underline decoration-line underline-offset-2 hover:text-amber">
                  {macro.flows.source ?? host(macro.flows.url)}
                </a>
              </>
            ) : (
              <span className="text-ink">not available. No headline in the last four days stated them.</span>
            )}
          </p>
          {macro.headlines.length ? (
            <ul className="flex flex-col">
              {macro.headlines.map((h) => (
                <li key={h.id} className="border-t border-line/70 py-2">
                  <a href={h.url} target="_blank" rel="noreferrer noopener" className="text-[12.5px] leading-snug text-ink hover:text-amber">
                    {h.title}
                  </a>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    {h.tags.map((t) => (
                      <span key={t} className="label rounded-sm border border-amber/50 px-1 py-0.5 text-[9px] text-amber">
                        {t}
                      </span>
                    ))}
                    <span className="num text-[10px] text-steel">
                      {h.source ?? "source not stated"} / {fmtIST(h.publishedAt)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-steel">No headline in the feeds carried a market tag yet. The feeds are read with the daily news run and at the end of each day.</p>
          )}
          <div>
            <span className="label text-[10px] text-amber">Event log: what the market did afterwards</span>
            {macro.events.length ? (
              <ul className="mt-1 flex flex-col">
                {macro.events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] text-steel">No events logged yet.</p>
            )}
          </div>
          <p className="text-[11px] leading-snug text-steel">
            Headlines come from the Economic Times, Business Standard and Mint feeds: headline, publisher, time and link only. Tags (crude, Fed,
            RBI, FII, geopolitics, policy) are keyword matches, not AI. A day with two or more headlines under one tag is logged as an event,
            and the figures beside it are what Nifty 50 and our stocks in the usually-sensitive sectors actually did afterwards. &quot;Watch&quot;
            sectors are a fixed rule of thumb with no direction implied.
          </p>
        </div>
      </Card>
    </>
  );
}
