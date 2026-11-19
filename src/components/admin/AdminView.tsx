"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { runJobAction } from "@/app/actions";
import { fmtIST } from "@/lib/market";
import type { AiRun, JobRun } from "@/lib/types";
import { TypeIn } from "../motion/primitives";
import { Button, Card, Stat } from "../ui/core";
import { AiSpend } from "./AiSpend";

const COLS = "grid grid-cols-[150px_120px_80px_64px_64px_70px_1fr] items-start gap-3 px-3.5";
const bad = (s: string) => s === "error" || s === "partial";

function duration(r: JobRun): string {
  if (!r.finished_at) return "—";
  const s = (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function note(r: JobRun): string {
  if (r.error) return r.error;
  const f = r.detail?.failures ?? [];
  if (f.length) return f.slice(0, 6).map((x) => `${x.symbol}: ${x.error}`).join("  ·  ") + (f.length > 6 ? `  ·  +${f.length - 6} more` : "");
  if (r.detail?.reason) return r.detail.reason;
  if (r.detail?.remaining) return `${r.detail.remaining} stocks still to do; the next run continues`;
  return "";
}

/** Job history, provider failures and manual triggers. */
export function AdminView({
  runs,
  total,
  problems,
  aiRuns,
}: {
  aiRuns: AiRun[];
  runs: JobRun[];
  total: number;
  problems: { symbol: string; status: string; error: string | null }[];
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const last = (job: string) => runs.find((r) => r.job === job && r.status !== "skipped");
  const failures24h = runs.filter((r) => bad(r.status) && Date.now() - new Date(r.started_at).getTime() < 86400000).length;

  const run = (job: "quotes" | "eod") =>
    start(async () => {
      setMessage(null);
      const res = await runJobAction(job);
      setMessage(`${job}: ${res.status}, ${res.ok} ok, ${res.failed} failed${res.error ? `. ${res.error}` : ""}`);
    });

  const lastStat = (label: string, job: string) => {
    const r = last(job);
    return (
      <Stat label={label}>
        <span className={clsx("display text-3xl", r && bad(r.status) && "text-amber")}>{r ? r.status : "never"}</span>
        <span className="num text-[10px] text-steel">{r ? fmtIST(r.started_at) : "no run recorded"}</span>
      </Stat>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <TypeIn
        className="display text-[clamp(40px,4.6vw,72px)]"
        segments={[
          { text: "Jobs. " },
          { text: failures24h ? `${failures24h} failing` : "All clear", accent: true },
          { text: failures24h ? " in the last 24 hours." : "." },
        ]}
      />
      <div className="grid grid-cols-12 gap-3">
        <Card className="col-span-12 lg:col-span-8" title="Status">
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Stat label="Stocks tracked">
              <span className="display text-3xl">{total}</span>
              <span className={clsx("num text-[10px]", problems.length ? "text-amber" : "text-steel")}>
                {problems.length ? `${problems.length} without history` : "all backfilled"}
              </span>
            </Stat>
            {lastStat("Last quotes run", "quotes")}
            {lastStat("Last EOD run", "eod")}
            {lastStat("Last backfill", "backfill")}
          </div>
        </Card>
        <Card className="col-span-12 lg:col-span-4" title="Run now">
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => run("quotes")} className="disabled:opacity-60">
              Refresh quotes
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => run("eod")} className="disabled:opacity-60">
              Run EOD batch
            </Button>
          </div>
          <p className="num mt-3 text-[11px] leading-relaxed text-steel" role="status">
            {pending ? "Running. This can take up to 40 seconds." : message ?? "Manual runs ignore market hours. The EOD batch works for 40 seconds, then stops; run it again to continue."}
          </p>
        </Card>

        {problems.length > 0 && (
          <Card className="col-span-12" title={`Stocks without history (${problems.length})`}>
            <div className="flex flex-col">
              {problems.slice(0, 40).map((p) => (
                <div key={p.symbol} className="num grid grid-cols-[140px_90px_1fr] gap-3 border-b border-line/70 py-1.5 text-[11px] last:border-b-0">
                  <span className="text-ink">{p.symbol}</span>
                  <span className="uppercase text-amber">{p.status}</span>
                  <span className="text-steel">{p.error ?? "waiting for npm run backfill"}</span>
                </div>
              ))}
              {problems.length > 40 && <span className="num pt-2 text-[11px] text-steel">+{problems.length - 40} more</span>}
            </div>
          </Card>
        )}

        <AiSpend runs={aiRuns} />

        <Card className="col-span-12" title="Job runs (latest 60)" bodyClassName="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className={clsx(COLS, "label h-8 items-center border-b border-line text-[10px] text-steel")}>
              <span>Started</span>
              <span>Job</span>
              <span>Status</span>
              <span className="justify-self-end">OK</span>
              <span className="justify-self-end">Failed</span>
              <span className="justify-self-end">Took</span>
              <span>Detail</span>
            </div>
            {runs.map((r) => (
              <div key={r.id} className={clsx(COLS, "num border-b border-line/70 py-2 text-[11px]", r.status === "skipped" && "opacity-50")}>
                <span className="text-steel">{fmtIST(r.started_at)}</span>
                <span className="text-ink">{r.job}</span>
                <span className={clsx("uppercase", bad(r.status) ? "text-amber" : "text-steel")}>{r.status}</span>
                <span className="justify-self-end text-ink">{r.ok_count}</span>
                <span className={clsx("justify-self-end", r.fail_count ? "text-amber" : "text-steel")}>{r.fail_count}</span>
                <span className="justify-self-end text-steel">{duration(r)}</span>
                <span className="break-words text-steel">{note(r)}</span>
              </div>
            ))}
            {runs.length === 0 && <p className="p-4 text-[12.5px] text-steel">No jobs have run yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
