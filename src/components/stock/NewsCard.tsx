"use client";

import clsx from "clsx";
import { useState } from "react";
import { fmtIST } from "@/lib/market";
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
export function NewsCard({ news, index }: { news: NewsItem[]; index: number }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const tagged = news.filter((n) => n.tags.some((t) => t !== "other"));
  const other = news.filter((n) => !n.tags.some((t) => t !== "other"));
  const counts = TAGS.map((t) => [t, tagged.filter((n) => n.tags.includes(t)).length] as const).filter(([, c]) => c > 0);
  const shown = (filter ? tagged.filter((n) => n.tags.includes(filter)) : tagged).slice(0, 14);
  const newest = news[0]?.publishedAt ?? null;
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
        kept; the link opens the publisher&apos;s page. Tags are keyword matches, not AI, so they can be wrong. Headlines are not scored.
      </p>
    </Card>
  );
}
