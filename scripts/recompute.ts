/**
 * Recomputes indicators, factor ranks and verdicts for every stock from stored candles.
 *   npm run recompute
 * Runs twice: momentum is ranked against the other stocks' stored values, so the
 * second pass ranks everyone against a complete, current set.
 */
import "./env";
import { recomputeAll } from "../src/lib/jobs/core";

async function main() {
  for (const pass of [1, 2]) {
    const r = await recomputeAll((s, err) => err && console.log(`${s} FAILED ${err.slice(0, 120)}`));
    console.log(`Pass ${pass}: ${r.ok} ok, ${r.failed} failed.`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
