/** Seeds the Nifty 200 constituents, the two index rows and the allowed sign-in email. Safe to re-run. */
import { readFileSync } from "node:fs";
import "./env";
import { need } from "./env";
import { adminDb } from "../src/lib/supabase/admin";

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    });
}

async function main() {
  const db = adminDb();
  const [header, ...rows] = parseCsv(readFileSync("data/nifty200.csv", "utf8"));
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iName = col("Company Name"), iInd = col("Industry"), iSym = col("Symbol");
  const stocks = rows
    .filter((r) => r[iSym])
    .map((r) => ({
      symbol: r[iSym],
      name: r[iName].replace(/\s+Ltd\.?$/i, ""),
      sector: r[iInd] || null,
      provider_symbol: `${r[iSym]}.NS`,
      source: "nifty200",
      kind: "equity",
    }));
  const indices = [
    { symbol: "NIFTY50", name: "Nifty 50", sector: null, provider_symbol: "^NSEI", source: "system", kind: "index" },
    { symbol: "INDIAVIX", name: "India VIX", sector: null, provider_symbol: "^INDIAVIX", source: "system", kind: "index" },
  ];
  // ignoreDuplicates keeps watchlist flags and backfill state of rows that already exist
  const { error } = await db.from("stocks").upsert([...stocks, ...indices], { onConflict: "symbol", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  const { count } = await db.from("stocks").select("*", { count: "exact", head: true });
  console.log(`Seeded. ${stocks.length} Nifty 200 rows + ${indices.length} indices offered; stocks table now has ${count} rows.`);

  const email = need("ALLOWED_EMAIL").trim().toLowerCase();
  const { error: e2 } = await db.from("allowed_users").upsert({ email }, { onConflict: "email" });
  if (e2) throw new Error(e2.message);
  console.log("Allowed sign-in email registered.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
