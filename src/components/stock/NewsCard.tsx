"use client";

import clsx from "clsx";
import { useState } from "react";
import { inr, shortDate } from "@/lib/format";
import { fmtIST } from "@/lib/market";
import { brokerCall, type NewsTone } from "@/lib/news/rules";
import type { NewsItem } from "@/lib/types";
import { Card } from "../ui/core";

const TAGS = ["results", "guidance", "order win", "rating change", "regulatory", "management change", "block deal"] as const;

function Row({ n }: { n: NewsItem }) {
  const tags = n.tags.filter((t) => t !== "other");
  return (
    <li className="border-t border-line/70 py-2">
      <a href={n.url} target="_blank" rel="noreferrer noopener" className="text-[12.5px] leading-snug text-ink hover:text-amber">
        {n.title}
      </a>
      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {tags.map((t) => (
          <span key={t} className="label rounded-sm border border-amber/50 px-1 py-0.5 text-[9px] text-amber">
            {t}
          </span>
        ))}
        <span className="num text-[10px] text-steel">
          {n.source ?? "source not stated"} / {fmtIST(n.publishedAt)}
        </span>
      </p>
    </li>
  );
}

/**
 * Headlines from free news feeds. Only the headline, publisher, time and link
 * are stored; the link opens the publisher's own page. Tags come from keywords.
 */
export function NewsCard({ news, index, tone }: { news: NewsItem[]; index: number; tone: NewsTone }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const tagged = news.filter((n) => n.tags.some((t) => t !== "other"));
  const other = news.filter((n) => !n.tags.some((t) => t !== "other"));
  const counts = TAGS.map((t) => [t, tagged.filter((n) => n.tags.includes(t)).length] as const).filter(([, c]) => c > 0);
  const shown = (filter ? tagged.filter((n) => n.tags.includes(filter)) : tagged).slice(0, 14);
  const newest = news[0]?.publishedAt ?? null;
  // broker calls read out of rating-change headlines: only what the headline itself states
  const calls = news
    .filter((n) => n.tags.includes("rating change"))
    .map((n) => ({ n, c: brokerCall(n.title) }))
    .filter((x): x is { n: NewsItem; c: NonNullable<ReturnType<typeof brokerCall>> } => x.c != null)
    .slice(0, 8);
  return (
    <Card
      index={index}
      className="col-span-12"
      title="News headlines"
      right={<span className="num text-[10px] uppercase tracking-wider text-steel">{newest ? `Newest ${fmtIST(newest)}` : "No headlines stored"}</span>}
    >
      {news.length === 0 ? (
        <p className="text-[12.5px] text-steel">No headline naming this company in the last 60 days, or its news has not been fetched yet. The feeds are read once a day.</p>
      ) : (
        <div className="grid grid-cols-12 gap-x-8 gap-y-4">
          <div className="col-span-12 flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-line pb-3">
            <div>
              <span className="label block text-[10px] text-steel">News tone, last 30 days</span>
              <span className={clsx("display text-3xl", tone.label === "Quiet" ? "text-steel" : "text-ink")}>{tone.label}</span>
            </div>
            <span className="num pb-1 text-[11px] text-steel">
              {tone.positive} positive, {tone.negative} negative, {Math.max(0, tone.total - tone.positive - tone.negative)} neutral of {tone.total} headlines.
              Keyword count, not AI, and not part of any verdict.
            </span>
          </div>
          {calls.length > 0 && (
            <div className="col-span-12">
              <span className="label text-[10px] text-amber">Broker calls, from headlines</span>
              <div className="mt-1.5 overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="label grid h-7 grid-cols-[84px_minmax(120px,1fr)_110px_90px_minmax(120px,1.4fr)] items-center gap-3 border-b border-line text-[10px] text-steel">
                    <span>Date</span>
                    <span>Broker</span>
                    <span>Call</span>
                    <span className="justify-self-end">Target</span>
                    <span>Reported by</span>
                  </div>
                  {calls.map(({ n, c }) => (
                    <a
                      key={n.id}
                      href={n.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={n.title}
                      className="grid h-8 grid-cols-[84px_minmax(120px,1fr)_110px_90px_minmax(120px,1.4fr)] items-center gap-3 border-b border-line/70 hover:bg-metal-2/60"
                    >
                      <span className="num text-[11px] text-steel">{shortDate(n.publishedAt.slice(0, 10))}</span>
                      <span className={clsx("truncate text-[12px]", c.broker ? "text-ink" : "text-steel")}>{c.broker ?? "not named"}</span>
                      <span className={clsx("num text-[11px]", c.call ? "text-ink" : "text-steel")}>{c.call ?? "not stated"}</span>
                      <span className="num justify-self-end text-[12px] text-ink">{c.target != null ? `₹${inr(c.target, 0)}` : <span className="text-steel">not stated</span>}</span>
                      <span className="num truncate text-[10px] text-steel">{n.source ?? "source not stated"}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="col-span-12 lg:col-span-7">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="label mr-1 text-[10px] text-amber">Tagged</span>
              {counts.map(([t, c]) => (
                <button
                  key={t}
                  onClick={() => setFilter(filter === t ? null : t)}
                  aria-pressed={filter === t}
                  className={clsx("label rounded-sm border px-1.5 py-1 text-[10px]", filter === t ? "border-amber text-amber" : "border-line text-steel hover:text-ink")}
                >
                  {t} {c}
                </button>
              ))}
            </div>
            {shown.length ? (
              <ul className="mt-2 flex flex-col">
                {shown.map((n) => (
                  <Row key={n.id} n={n} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12.5px] text-steel">No headline matched a tag. See the other headlines.</p>
            )}
          </div>
          <div className="col-span-12 lg:col-span-5">
            <span className="label text-[10px] text-steel">Other headlines ({other.length})</span>
            <ul className="mt-2 flex flex-col">
              {other.slice(0, showOther ? 20 : 6).map((n) => (
                <Row key={n.id} n={n} />
              ))}
            </ul>
            {other.length > 6 && (
              <button onClick={() => setShowOther(!showOther)} className="label mt-2 text-[10px] text-steel hover:text-amber">
                {showOther ? "Show fewer" : `Show ${Math.min(20, other.length) - 6} more`}
              </button>
            )}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-snug text-steel">
        Headlines come from Google News and the Economic Times, Business Standard and Mint feeds. Only the headline, publisher, time and link are
        kept; the link opens the publisher&apos;s page. Tags, tone and broker calls are read from the headline by keyword rules, not AI, so they
        can be wrong; open the link to check. None of this feeds a verdict.
      </p>
    </Card>
  );
}
