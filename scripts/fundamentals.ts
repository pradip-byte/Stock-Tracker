/**
 * Refreshes result dates, quarterly results, ratios and event scores.
 *   npm run fundamentals              stocks not refreshed in the last 20 hours
 *   npm run fundamentals -- --force   every stock
 *   npm run fundamentals -- --retry   also retry stocks whose last fetch failed
 *   npm run fundamentals -- --symbol TCS
 */
import "./env";
import { refreshFundamentals } from "../src/lib/jobs/core";

async function main() {
  const force = process.argv.includes("--force");
  const i = process.argv.indexOf("--symbol");
  const symbols = i >= 0 && process.argv[i + 1] ? [process.argv[i + 1].toUpperCase()] : undefined;
  let n = 0;
  const res = await refreshFundamentals({
    force,
    symbols,
    retryErrors: process.argv.includes("--retry"),
    budgetMs: 30 * 60000,
    onProgress: (s, err) => console.log(`[${++n}] ${s.padEnd(12)} ${err ? `FAILED  ${err.slice(0, 120)}` : "ok"}`),
  });
  console.log(`Done. status=${res.status} ok=${res.ok} failed=${res.failed}${res.detail ? ` ${JSON.stringify(res.detail)}` : ""}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
