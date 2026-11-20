"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { refreshExternalAction } from "@/app/actions";
import { shortDate, toneOf } from "@/lib/format";
import { fmtIST } from "@/lib/market";
import type { ExternalRead } from "@/lib/types";
import { Button, Card, Stat } from "../ui/core";
import { Freshness } from "../ui/Freshness";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function SourceLink({ url, children }: { url: string; children?: React.ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="num text-[10px] text-steel underline decoration-line underline-offset-2 hover:text-amber">
      {children ?? host(url)}
    </a>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/** The AI read: company news, guidance and expectations, plus the shared sector note. */
export function ExternalCard({ symbol, read, index, aiEnabled }: { symbol: string; read: ExternalRead | null; index: number; aiEnabled: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () =>
    start(async () => {
      setMessage(null);
      const res = await refreshExternalAction(symbol);
      setMessage(
        res.ok
          ? `Updated. External score ${res.score}. Estimated cost $${(res.costUsd ?? 0).toFixed(3)}.`
          : `Refresh failed: ${res.error}`,
      );
    });

  const stale = read ? ageDays(read.runAt) > 21 : false;
  // AI reads are switched off and this stock never had one: nothing to show
  if (!aiEnabled && !read) return null;

  return (
    <Card
      index={index}
      className="col-span-12"
      title={aiEnabled ? "External read" : "Earlier AI read (no longer updated)"}
      right={
        <span className="flex items-center gap-3">
          {read?.lowGradeSources && (
            <span
              className="label rounded-sm border border-amber/60 px-1.5 py-1 text-[10px] text-amber"
              title="The exchanges, established business news and the company's own site had no usable news, so this read comes from an open web search."
            >
              Low-grade sources
            </span>
          )}
          {read ? (
            <span className={clsx("num text-[10px] uppercase tracking-wider", stale ? "text-amber" : "text-steel")}>
              {aiEnabled ? (stale ? "Stale / " : "") : "Written "}
              {aiEnabled ? "AI read " : ""}
              {fmtIST(read.runAt)}
            </span>
          ) : (
            <Freshness mode="text" label="No AI read yet" />
          )}
          {aiEnabled && (
            <Button variant="ghost" onClick={refresh} disabled={pending} className="disabled:opacity-60">
              {pending ? "Researching" : "Refresh"}
            </Button>
          )}
        </span>
      }
    >
      {!aiEnabled && read && (
        <p className="num mb-3.5 border-b border-line pb-3 text-[11px] leading-relaxed text-amber">
          AI reads are switched off. This one was written on {fmtIST(read.runAt)} and is kept for reference only: it is not updated and its score
          is no longer part of the verdict. Current headlines are in the News card above.
        </p>
      )}
      {(pending || message) && (
        <p role="status" className={clsx("num mb-3.5 text-[11px]", message?.startsWith("Refresh failed") ? "text-amber" : "text-steel")}>
          {pending ? "Searching the web and reading results. This usually takes 30 to 90 seconds; keep this page open." : message}
        </p>
      )}

      {!read ? (
        <p className="max-w-prose text-[12.5px] leading-relaxed text-steel">
          No AI read has been run for this stock. The weekly job covers the watchlist and the top 30 by technical score;
          use Refresh to run one now (up to 2 web searches, usually a few cents).
        </p>
      ) : (
        <div className="grid grid-cols-12 gap-x-6 gap-y-5">
          {/* scores */}
          <div className="col-span-12 flex flex-wrap gap-x-8 gap-y-4 lg:col-span-3 lg:flex-col">
            <div className="flex gap-8">
              <Stat label="News sentiment">
                <span className={clsx("display text-5xl", toneOf(read.sentiment))}>{signed(read.sentiment)}</span>
                <span className="num text-[10px] text-steel">scale −2 to +2</span>
              </Stat>
              <Stat label="Confidence">
                <span className="display text-5xl">{read.confidence}</span>
                <span className="num text-[10px] text-steel">of 100</span>
              </Stat>
            </div>
            {read.sentimentRationale && <p className="max-w-xs text-[12.5px] leading-snug text-ink">{read.sentimentRationale}</p>}
            <Stat label="Next result, from the AI read">
              {read.resultDate.date ? (
                <>
                  <span className="display text-2xl">{shortDate(read.resultDate.date)}</span>
                  <span className={clsx("num text-[10px]", read.resultDate.confirmed ? "text-amber" : "text-steel")}>
                    {read.resultDate.confirmed ? "confirmed by announcement" : "reported, not confirmed"}
                    {read.resultDate.url && (
                      <>
                        {" / "}
                        <SourceLink url={read.resultDate.url} />
                      </>
                    )}
                  </span>
                </>
              ) : (
                <span className="num text-sm text-steel">no date found</span>
              )}
            </Stat>
          </div>

          {/* company */}
          <div className="col-span-12 flex flex-col gap-4 lg:col-span-5">
            <div>
              <span className="label text-[10px] text-amber">Key news</span>
              <ul className="mt-1.5 flex flex-col">
                {read.keyNews.map((n) => (
                  <li key={n.url} className="border-t border-line/70 py-2">
                    <p className="text-[12.5px] leading-snug text-ink">{n.headline}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-steel">{n.why_it_matters}</p>
                    <p className="mt-1 flex items-center gap-2">
                      <SourceLink url={n.url} />
                      {n.published && <span className="num text-[10px] text-steel">{n.published}</span>}
                    </p>
                  </li>
                ))}
                {read.keyNews.length === 0 && (
                  <li className="border-t border-line/70 py-2 text-[12.5px] text-steel">
                    The searches found no company-specific news with a usable source.
                  </li>
                )}
              </ul>
            </div>
            <div>
              <span className="label text-[10px] text-amber">Guidance at the last result</span>
              <p className="mt-1.5 text-[12.5px] leading-snug text-ink">
                {read.guidance.summary || <span className="text-steel">Not covered by the search results.</span>}
              </p>
              {read.guidance.url && <SourceLink url={read.guidance.url} />}
            </div>
            <div>
              <span className="label text-[10px] text-amber">Expectations for the next result</span>
              <p className="mt-1.5 text-[12.5px] leading-snug text-ink">
                {read.expectations.summary || <span className="text-steel">Not covered by the search results.</span>}
              </p>
            </div>
            {read.companyRisks.length > 0 && (
              <div>
                <span className="label text-[10px] text-amber">Company risks (dated sources only)</span>
                <ul className="mt-1.5 flex flex-col">
                  {read.companyRisks.map((r) => (
                    <li key={r.url + r.risk} className="border-t border-line/70 py-1.5">
                      <p className="text-[12.5px] leading-snug text-ink">{r.risk}</p>
                      <p className="mt-0.5 flex items-center gap-2">
                        <SourceLink url={r.url} />
                        <span className="num text-[10px] text-steel">{r.published}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* sector (shared) */}
          <div className="col-span-12 lg:col-span-4">
            {read.sector ? (
              <div className="flex flex-col gap-3.5 rounded-sm border border-line p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="label text-[10px] text-amber">Industry: {read.sector.name}</span>
                  <span className="num whitespace-nowrap text-[10px] uppercase tracking-wider text-steel">
                    shared note / {fmtIST(read.sector.runAt).slice(0, 6)}
                  </span>
                </div>
                <div className="flex items-start gap-4">
                  <span className={clsx("display text-4xl", toneOf(read.sector.outlookScore))}>{signed(read.sector.outlookScore)}</span>
                  <p className="text-[12.5px] leading-snug text-ink">{read.sector.outlook}</p>
                </div>
                <Stat label="Export / import exposure">
                  <p className="text-[12.5px] leading-snug text-ink">{read.sector.exportImport || "Not covered."}</p>
                </Stat>
                <Stat label="Currency and commodity sensitivity">
                  <p className="text-[12.5px] leading-snug text-ink">{read.sector.currencyCommodity || "Not covered."}</p>
                </Stat>
                {read.sector.risks.length > 0 && (
                  <Stat label="Industry risks (dated sources only)">
                    <ul className="flex flex-col">
                      {read.sector.risks.map((r) => (
                        <li key={r.url + r.risk} className="border-t border-line/70 py-1.5 first:border-t-0 first:pt-0">
                          <p className="text-[12.5px] leading-snug text-ink">{r.risk}</p>
                          <p className="mt-0.5 flex items-center gap-2">
                            <SourceLink url={r.url} />
                            <span className="num text-[10px] text-steel">{r.published}</span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </Stat>
                )}
              </div>
            ) : (
              <p className="text-[12.5px] text-steel">No sector note is attached to this read.</p>
            )}
          </div>

          {/* provenance */}
          <div className="num col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5 text-[10px] uppercase tracking-wider text-steel">
            <span>
              {read.model ?? "model unknown"} / {read.searches ?? "?"} web search{read.searches === 1 ? "" : "es"} / only links that appeared in the search results are kept
            </span>
            <details className="w-full normal-case tracking-normal">
              <summary className="cursor-pointer uppercase tracking-wider hover:text-ink">
                All sources seen ({read.sources.length} company, {read.sector?.sources.length ?? 0} sector)
              </summary>
              <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
                {[...read.sources, ...(read.sector?.sources ?? [])].map((s, i) => (
                  <li key={`${s.url}-${i}`} className="truncate">
                    <SourceLink url={s.url}>{s.title || host(s.url)}</SourceLink>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}
    </Card>
  );
}
