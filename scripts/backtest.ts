/**
 * Backtests every signal on each stock's full history, pools the results by
 * sector and across all stocks, then refreshes every verdict.
 *   npm run backtest              stocks not tested in the last 6 days
 *   npm run backtest -- --force   every stock
 */
import "./env";
import { recomputeAll, runBacktest } from "../src/lib/jobs/core";

async function main() {
  let n = 0;
  const res = await runBacktest({
    force: process.argv.includes("--force"),
    budgetMs: 60 * 60000,
    onProgress: (s, err) => console.log(`[${++n}] ${s.padEnd(12)} ${err ? `FAILED  ${err.slice(0, 120)}` : "ok"}`),
  });
  console.log(`Backtest: status=${res.status} ok=${res.ok} failed=${res.failed}`);
  const r = await recomputeAll((s, err) => err && console.log(`verdict ${s} FAILED ${err.slice(0, 120)}`));
  console.log(`Verdicts refreshed: ${r.ok} ok, ${r.failed} failed.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
