/**
 * News from free feeds (no AI, no paid API).
 *   npm run news                       market headlines, then every stock not fetched in the last 20 hours
 *   npm run news -- --force            every stock
 *   npm run news -- --symbol INFY,TCS  just these
 */
import "./env";
import { runNews } from "../src/lib/jobs/news";

async function main() {
  const i = process.argv.indexOf("--symbol");
  const symbols = i > 0 ? process.argv[i + 1]?.toUpperCase().split(",") : undefined;
  const r = await runNews({ budgetMs: 30 * 60000, force: process.argv.includes("--force"), symbols, onProgress: (l) => console.log(l) });
  console.log(`News: status=${r.status} ok=${r.ok} failed=${r.failed} ${JSON.stringify(r.detail ?? {})}${r.error ? ` error=${r.error}` : ""}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
