/**
 * Weekly AI read: watchlist plus the top 30 by technical score, minus the skip rule.
 *   npm run external                 run everything that is due
 *   npm run external -- --dry-run    show who would run and who is skipped, with no API calls
 *   npm run external -- --symbol TCS one stock, ignoring the skip rule
 *   npm run external -- --limit 10   only the first 10 that are due
 *   npm run external -- --relink     attach existing reads to industry notes (no stock calls)
 */
import "./env";
import { relinkToIndustry, researchStock, runExternalWeekly, selectWeekly, STOCK_MAX_SEARCHES } from "../src/lib/jobs/external";
import { adminDb } from "../src/lib/supabase/admin";

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--symbol");
  if (args.includes("--dry-run")) {
    const sel = await selectWeekly(adminDb());
    for (const s of sel) {
      console.log(`${s.run ? "RUN " : "skip"}  ${s.symbol.padEnd(12)} ${(s.sector ?? "").slice(0, 28).padEnd(28)} ${s.reason}`);
    }
    const due = sel.filter((s) => s.run);
    const sectors = new Set(due.map((s) => s.sector).filter(Boolean));
    console.log(`\n${sel.length} selected, ${due.length} due, ${sel.length - due.length} not due.`);
    console.log(`Worst case this run: ${due.length} stock calls (max ${STOCK_MAX_SEARCHES} searches each) + up to ${sectors.size} sector calls.`);
    return;
  }
  if (args.includes("--relink")) {
    const res = await relinkToIndustry((l) => console.log(l));
    console.log(`Relinked ${res.relinked} read(s). New industry notes cost $${res.costUsd.toFixed(4)}.`);
    return;
  }
  if (i >= 0 && args[i + 1]) {
    const res = await researchStock(args[i + 1].toUpperCase(), "manual");
    console.log(res.ok ? `ok: external score ${res.score}, est. cost $${res.costUsd?.toFixed(4)}` : `FAILED: ${res.error}`);
    return;
  }
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : undefined;
  const res = await runExternalWeekly({ budgetMs: 2 * 3600000, limit, onProgress: (l) => console.log(l) });
  console.log(`Done. status=${res.status} ok=${res.ok} failed=${res.failed} ${JSON.stringify(res.detail ?? {})}${res.error ? ` ${res.error}` : ""}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
