/**
 * Tests every candidate signal on the full daily history against the random-day
 * baseline, in-sample (2016-2022) and out-of-sample (2023 onward), after costs.
 *   npm run research                 print the tables
 *   npm run research -- --json FILE  also write every number to FILE
 */
import "./env";
import { writeFileSync } from "node:fs";
import { runResearch, SIGNALS, type Stat, type StockData } from "../src/lib/research";
import { tradeCostPct } from "../src/lib/settings";
import { adminDb } from "../src/lib/supabase/admin";
import type { Candle } from "../src/lib/types";

const db = adminDb();

async function candlesOf(symbol: string): Promise<Candle[]> {
  const out: Candle[] = [];
  for (let from = 0; from < 9000; from += 1000) {
    const { data, error } = await db.from("candles_daily").select("date,open,high,low,close,volume").eq("symbol", symbol).order("date").range(from, from + 999);
    if (error) throw new Error(`${symbol}: ${error.message}`);
    for (const r of data ?? []) out.push({ time: r.date, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume });
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function inPool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const f = (v: number | null, w = 7, sign = false) => (v == null ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(2)}`).padStart(w);

async function main() {
  const { data: stocks, error } = await db.from("stocks").select("symbol,kind").eq("backfill_status", "done").order("symbol");
  if (error) throw new Error(error.message);
  const equities = (stocks ?? []).filter((s) => s.kind === "equity").map((s) => s.symbol as string);
  const nifty = await candlesOf("NIFTY50");
  if (nifty.length < 500) throw new Error("NIFTY50 history is missing");

  const { data: earn } = await db.from("earnings").select("symbol,period_end,net_profit,reported_at").not("reported_at", "is", null).limit(5000);
  const { data: allEarn } = await db.from("earnings").select("symbol,period_end,net_profit").limit(5000);
  const profitOf = new Map((allEarn ?? []).map((e) => [`${e.symbol}|${e.period_end}`, e.net_profit == null ? null : Number(e.net_profit)]));
  const yearAgo = (symbol: string, periodEnd: string): number | null => {
    const d = new Date(`${periodEnd}T00:00:00Z`);
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const x = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate() + off)).toISOString().slice(0, 10);
      const v = profitOf.get(`${symbol}|${x}`);
      if (v != null) return v;
    }
    return null;
  };

  process.stderr.write(`Loading ${equities.length} stocks`);
  const data: StockData[] = await inPool(equities, 6, async (symbol) => {
    const candles = await candlesOf(symbol);
    process.stderr.write(".");
    const results = (earn ?? [])
      .filter((e) => e.symbol === symbol)
      .map((e) => {
        const now = e.net_profit == null ? null : Number(e.net_profit);
        const prev = yearAgo(symbol, e.period_end);
        // growth is only meaningful from a positive base
        return { reportedAt: e.reported_at as string, profitYoY: now != null && prev != null && prev > 0 ? (now / prev - 1) * 100 : null };
      });
    return { symbol, candles, results };
  });
  process.stderr.write("\nRunning\n");

  const { stats, meta } = runResearch(data, nifty, { costPct: tradeCostPct() });
  console.log("META", JSON.stringify(meta));
  const get = (signal: string, period: Stat["period"], regime: Stat["regime"], h: number) => stats.find((s) => s.signal === signal && s.period === period && s.regime === regime && s.horizon === h)!;

  for (const h of [5, 20, 60, 120]) {
    console.log(`\n=== ${h} sessions, after ${meta.costPct}% cost. IN = 2016-2022, OUT = 2023 onward. exp = average net return per trade (%), edge = exp minus baseline, m.edge = month-matched edge, t = its t-statistic`);
    console.log(`${"signal".padEnd(15)} | ${"IN n".padStart(7)} ${"hit%".padStart(6)} ${"win".padStart(6)} ${"loss".padStart(7)} ${"exp".padStart(6)} ${"edge".padStart(6)} ${"m.edge".padStart(6)} ${"t".padStart(5)} | ${"OUT n".padStart(7)} ${"hit%".padStart(6)} ${"win".padStart(6)} ${"loss".padStart(7)} ${"exp".padStart(6)} ${"edge".padStart(6)} ${"m.edge".padStart(6)} ${"t".padStart(5)}`);
    for (const def of SIGNALS) {
      const part = (p: Stat["period"]) => {
        const s = get(def.id, p, "all", h);
        return `${String(s.samples).padStart(7)} ${f(s.hitRate, 6)} ${f(s.avgWin, 6)} ${f(s.avgLoss, 7)} ${f(s.avgReturn, 6)} ${f(s.edge, 6, true)} ${f(s.matchedEdge, 6, true)} ${f(s.tStat, 5)}`;
      };
      console.log(`${def.id.padEnd(15)} | ${part("in")} | ${part("out")}`);
    }
  }

  for (const h of [20, 60]) {
    console.log(`\n=== Regime split, ${h} sessions: Nifty above (UP) or below (DOWN) its 200 DMA on the signal day. exp and edge against the baseline in the same regime`);
    console.log(`${"signal".padEnd(15)} | ${"IN-UP n".padStart(8)} ${"exp".padStart(6)} ${"edge".padStart(6)} | ${"IN-DOWN n".padStart(9)} ${"exp".padStart(6)} ${"edge".padStart(6)} | ${"OUT-UP n".padStart(8)} ${"exp".padStart(6)} ${"edge".padStart(6)} | ${"OUT-DN n".padStart(8)} ${"exp".padStart(6)} ${"edge".padStart(6)}`);
    for (const def of SIGNALS) {
      const part = (p: Stat["period"], rg: Stat["regime"], w: number) => {
        const s = get(def.id, p, rg, h);
        return `${String(s.samples).padStart(w)} ${f(s.avgReturn, 6)} ${f(s.edge, 6, true)}`;
      };
      console.log(`${def.id.padEnd(15)} | ${part("in", "up", 8)} | ${part("in", "down", 9)} | ${part("out", "up", 8)} | ${part("out", "down", 8)}`);
    }
  }

  const j = process.argv.indexOf("--json");
  if (j > 0 && process.argv[j + 1]) writeFileSync(process.argv[j + 1], JSON.stringify({ meta, stats }));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
