import clsx from "clsx";
import { fmtIST, istParts } from "@/lib/market";
import type { AiRun } from "@/lib/types";
import { Card, Stat } from "../ui/core";

const COLS = "grid grid-cols-[150px_70px_minmax(140px,1fr)_130px_70px_70px_80px_80px_70px_70px] items-start gap-3 px-3.5";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

type Total = { runs: number; searches: number; input: number; output: number; cost: number; failed: number };
const sum = (runs: AiRun[]): Total =>
  runs.reduce(
    (t, r) => ({
      runs: t.runs + 1,
      searches: t.searches + r.searches,
      input: t.input + r.input_tokens,
      output: t.output + r.output_tokens,
      cost: t.cost + r.cost_usd,
      failed: t.failed + (r.status === "ok" || r.status === "running" ? 0 : 1),
    }),
    { runs: 0, searches: 0, input: 0, output: 0, cost: 0, failed: 0 },
  );

/** AI usage and estimated spend: this month, last month, and every recent call. */
export function AiSpend({ runs }: { runs: AiRun[] }) {
  const now = istParts();
  const monthKey = (iso: string) => istParts(new Date(iso)).date.slice(0, 7);
  const thisKey = now.date.slice(0, 7);
  const prev = new Date(Date.UTC(+now.date.slice(0, 4), now.month - 1, 1));
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  const cur = sum(runs.filter((r) => monthKey(r.started_at) === thisKey));
  const last = sum(runs.filter((r) => monthKey(r.started_at) === prevKey));
  const sectors = runs.filter((r) => monthKey(r.started_at) === thisKey && r.kind === "sector").length;
  const stuck = runs.filter((r) => r.status === "running" && Date.now() - new Date(r.started_at).getTime() > 10 * 60000).length;

  return (
    <>
      <Card className="col-span-12" title="AI spend (estimate at list prices)">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-6">
          <Stat label={`${MONTHS[now.month]} so far`}>
            <span className="display text-4xl text-amber">{usd(cur.cost)}</span>
            <span className="num text-[10px] text-steel">
              {cur.runs} calls ({sectors} sector, {cur.runs - sectors} stock)
            </span>
          </Stat>
          <Stat label="Web searches">
            <span className="display text-3xl">{cur.searches}</span>
            <span className="num text-[10px] text-steel">{usd(cur.searches * 0.01)} of the total</span>
          </Stat>
          <Stat label="Tokens in / out">
            <span className="display text-3xl">
              {k(cur.input)} <span className="text-steel">/</span> {k(cur.output)}
            </span>
            <span className="num text-[10px] text-steel">search results count as input</span>
          </Stat>
          <Stat label="Avg per call">
            <span className="display text-3xl">{cur.runs ? usd(cur.cost / cur.runs) : "—"}</span>
            <span className="num text-[10px] text-steel">{cur.runs ? `${(cur.searches / cur.runs).toFixed(1)} searches each` : "no calls yet"}</span>
          </Stat>
          <Stat label="Failed or declined">
            <span className={clsx("display text-3xl", cur.failed > 0 && "text-amber")}>{cur.failed}</span>
            <span className={clsx("num text-[10px]", stuck ? "text-amber" : "text-steel")}>
              {stuck ? `${stuck} never finished (cost unknown)` : "this month"}
            </span>
          </Stat>
          <Stat label={`${MONTHS[prev.getUTCMonth()]} total`}>
            <span className="display text-3xl">{usd(last.cost)}</span>
            <span className="num text-[10px] text-steel">
              {last.runs} calls, {last.searches} searches
            </span>
          </Stat>
        </div>
        <p className="num mt-4 border-t border-line pt-2.5 text-[10px] uppercase leading-relaxed tracking-wider text-steel">
          Estimated from token and search counts at published prices for the model each call used, plus $10 per 1,000
          searches. The Anthropic Console shows the actual bill. A call that was cut off before finishing is logged as
          &quot;running&quot; with no cost.
        </p>
      </Card>

      <Card className="col-span-12" title={`AI calls (latest ${Math.min(runs.length, 40)} of ${runs.length} in 62 days)`} bodyClassName="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className={clsx(COLS, "label h-8 items-center border-b border-line text-[10px] text-steel")}>
            <span>Started</span>
            <span>Kind</span>
            <span>For</span>
            <span>Trigger / model</span>
            <span>Status</span>
            <span className="justify-self-end">Searches</span>
            <span className="justify-self-end">Tokens in</span>
            <span className="justify-self-end">Tokens out</span>
            <span className="justify-self-end">Took</span>
            <span className="justify-self-end">Est. cost</span>
          </div>
          {runs.slice(0, 40).map((r) => {
            const bad = r.status === "error" || r.status === "refused";
            return (
              <div key={r.id} className={clsx(COLS, "num border-b border-line/70 py-2 text-[11px]")}>
                <span className="text-steel">{fmtIST(r.started_at)}</span>
                <span className="text-steel">{r.kind}</span>
                <span className="min-w-0 text-ink">
                  <span className="block truncate">{r.key}</span>
                  {r.error && <span className="block break-words text-amber">{r.error}</span>}
                </span>
                <span className="min-w-0 text-steel">
                  <span className="block">{r.trigger}</span>
                  <span className="block truncate text-[10px]">{r.model ?? ""}</span>
                </span>
                <span className={clsx("uppercase", bad ? "text-amber" : "text-steel")}>{r.status}</span>
                <span className="justify-self-end text-ink">{r.searches}</span>
                <span className="justify-self-end text-ink">{r.input_tokens.toLocaleString("en-IN")}</span>
                <span className="justify-self-end text-ink">{r.output_tokens.toLocaleString("en-IN")}</span>
                <span className="justify-self-end text-steel">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(0)}s` : "—"}</span>
                <span className="justify-self-end text-ink">{usd(r.cost_usd)}</span>
              </div>
            );
          })}
          {runs.length === 0 && <p className="p-4 text-[12.5px] text-steel">No AI calls have been made yet.</p>}
        </div>
      </Card>
    </>
  );
}
