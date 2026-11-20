/**
 * Macro view.
 *   npm run macro                 daily numbers, breadth, regime label, event follow-up
 *   npm run macro -- --backfill   also rebuild the daily regime history from stored prices
 *   npm run macro -- --note       write the weekly AI macro note now (spends money)
 */
import "./env";
import { sma } from "../src/lib/indicators";
import { runMacroDaily, runMacroNote } from "../src/lib/jobs/macro";
import { MACRO_SERIES, regimeOf } from "../src/lib/macro";
import { adminDb } from "../src/lib/supabase/admin";

const db = adminDb();

async function closesOf(symbol: string): Promise<{ date: string; close: number }[]> {
  const out: { date: string; close: number }[] = [];
  for (let from = 0; from < 9000; from += 1000) {
    const { data, error } = await db.from("candles_daily").select("date,close").eq("symbol", symbol).order("date").range(from, from + 999);
    if (error) throw new Error(`${symbol}: ${error.message}`);
    for (const r of data ?? []) out.push({ date: r.date, close: +r.close });
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function seriesOf(id: string): Promise<{ date: string; close: number }[]> {
  const out: { date: string; close: number }[] = [];
  for (let from = 0; from < 9000; from += 1000) {
    const { data } = await db.from("macro_series").select("date,close").eq("series", id).order("date").range(from, from + 999);
    for (const r of data ?? []) out.push({ date: r.date, close: +r.close });
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Rebuild macro_daily for every past session from stored prices. Breadth uses today's tracked stocks. */
async function backfill() {
  const { data: stocks } = await db.from("stocks").select("symbol").eq("kind", "equity").eq("backfill_status", "done").order("symbol");
  const symbols = (stocks ?? []).map((s) => s.symbol as string);
  const above50 = new Map<string, [number, number]>(); // date -> [above, counted]
  const above200 = new Map<string, [number, number]>();
  let next = 0;
  process.stderr.write(`Reading ${symbols.length} stocks`);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < symbols.length) {
        const c = await closesOf(symbols[next++]);
        const cl = c.map((x) => x.close);
        const s50 = sma(cl, 50);
        const s200 = sma(cl, 200);
        c.forEach((x, i) => {
          for (const [avg, map] of [[s50[i], above50], [s200[i], above200]] as const) {
            if (avg == null) continue;
            const t = map.get(x.date) ?? [0, 0];
            t[1]++;
            if (x.close > avg) t[0]++;
            map.set(x.date, t);
          }
        });
        process.stderr.write(".");
      }
    }),
  );
  process.stderr.write("\n");
  const nifty = await closesOf("NIFTY50");
  const vix = new Map((await closesOf("INDIAVIX")).map((x) => [x.date, x.close]));
  const n200 = sma(nifty.map((x) => x.close), 200);
  const vixDates = [...vix.keys()].sort();
  const outside: Record<string, { date: string; close: number }[]> = {};
  for (const s of MACRO_SERIES) outside[s.id] = await seriesOf(s.id);
  const pointer: Record<string, number> = Object.fromEntries(MACRO_SERIES.map((s) => [s.id, 0]));
  const rows = [];
  for (let i = 199; i < nifty.length; i++) {
    const date = nifty[i].date;
    // latest value on or before this date for each outside series
    const latest: Record<string, number | null> = {};
    for (const s of MACRO_SERIES) {
      const arr = outside[s.id];
      while (pointer[s.id] + 1 < arr.length && arr[pointer[s.id] + 1].date <= date) pointer[s.id]++;
      latest[s.id] = arr.length && arr[pointer[s.id]].date <= date ? arr[pointer[s.id]].close : null;
    }
    const vHist = vixDates.filter((d) => d <= date).slice(-20);
    const vixNow = vix.get(date) ?? (vHist.length ? vix.get(vHist[vHist.length - 1])! : null);
    const vix20 = vHist.length >= 20 ? vHist.reduce((a, d) => a + vix.get(d)!, 0) / 20 : null;
    const b50 = above50.get(date);
    const b200 = above200.get(date);
    const breadth50 = b50 && b50[1] >= 30 ? Math.round((b50[0] / b50[1]) * 1000) / 10 : null;
    const breadth200 = b200 && b200[1] >= 30 ? Math.round((b200[0] / b200[1]) * 1000) / 10 : null;
    const read = regimeOf({ nifty: nifty[i].close, niftySma200: n200[i], breadth200, vix: vixNow, vixSma20: vix20 });
    rows.push({
      date, nifty: nifty[i].close, nifty_sma200: n200[i], vix: vixNow, vix_sma20: vix20,
      brent: latest.BRENT, usdinr: latest.USDINR, spx: latest.SPX, us10y: latest.US10Y,
      breadth50, breadth200, breadth_count: b200?.[1] ?? null,
      regime: read?.regime ?? null, regime_score: read?.score ?? null, inputs: read?.inputs ?? [], computed_at: new Date().toISOString(),
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("macro_daily").upsert(rows.slice(i, i + 500), { onConflict: "date" });
    if (error) throw new Error(error.message);
  }
  const mix = rows.reduce((m: Record<string, number>, r) => ((m[r.regime ?? "none"] = (m[r.regime ?? "none"] || 0) + 1), m), {});
  console.log(`Regime history rebuilt: ${rows.length} sessions from ${rows[0]?.date} to ${rows[rows.length - 1]?.date}. ${JSON.stringify(mix)}`);
}

async function main() {
  if (process.argv.includes("--note")) {
    const r = await runMacroNote("manual");
    console.log(`Macro note: status=${r.status} events=${r.ok} ${JSON.stringify(r.detail ?? {})}${r.error ? ` error=${r.error}` : ""}`);
    return;
  }
  const r = await runMacroDaily();
  console.log(`Macro daily: status=${r.status} ${JSON.stringify(r.detail ?? {})}${r.error ? ` error=${r.error}` : ""}`);
  if (process.argv.includes("--backfill")) await backfill();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
