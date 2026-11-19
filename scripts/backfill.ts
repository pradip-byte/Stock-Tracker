/**
 * Backfills daily candles from the provider, then computes indicators and scores.
 *   npm run backfill                 every stock that is not done yet (resumable)
 *   npm run backfill -- --force      redo everything
 *   npm run backfill -- --symbol TCS one stock
 *   npm run backfill -- --years 5    shorter history (default 10)
 * Rate-limited to roughly one stock per second. Stop it any time; the next run continues.
 */
import "./env";
import { backfillSymbol } from "../src/lib/jobs/core";
import { adminDb } from "../src/lib/supabase/admin";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = adminDb();
  const years = Number(value("years") ?? 10);
  const only = value("symbol")?.toUpperCase();
  let q = db.from("stocks").select("symbol,provider_symbol,kind,last_candle,backfill_status").order("symbol");
  if (only) q = q.eq("symbol", only);
  else if (!flag("force")) q = q.neq("backfill_status", "done");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const todo = data ?? [];
  if (!todo.length) return console.log("Nothing to backfill. Use --force to redo.");

  const { data: run } = await db.from("job_runs").insert({ job: "backfill", status: "running" }).select("id").single();
  console.log(`Backfilling ${todo.length} stock(s), ${years} years each.`);
  let ok = 0;
  const failures: { symbol: string; error: string }[] = [];
  for (const [i, s] of todo.entries()) {
    const t0 = Date.now();
    try {
      const bars = await backfillSymbol(db, s, years);
      ok++;
      console.log(`[${i + 1}/${todo.length}] ${s.symbol.padEnd(12)} ${String(bars).padStart(5)} bars  ${Date.now() - t0}ms`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failures.push({ symbol: s.symbol, error: error.slice(0, 300) });
      console.log(`[${i + 1}/${todo.length}] ${s.symbol.padEnd(12)} FAILED  ${error.slice(0, 120)}`);
    }
    await sleep(Math.max(0, 900 - (Date.now() - t0)));
  }
  if (run?.id) {
    await db
      .from("job_runs")
      .update({
        status: failures.length ? (ok ? "partial" : "error") : "ok",
        finished_at: new Date().toISOString(),
        ok_count: ok,
        fail_count: failures.length,
        detail: { years, failures: failures.slice(0, 40) },
      })
      .eq("id", run.id);
  }
  console.log(`Done. ${ok} ok, ${failures.length} failed.${failures.length ? " Re-run to retry the failures." : ""}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
