/**
 * Re-applies the current matching and tagging rules to stored stock headlines.
 * A headline that no longer names its company, comes from a blocked source or
 * is a price blurb is removed; the rest get their tags recomputed.
 *   npx tsx scripts/news-retag.ts --dry-run   report only
 *   npx tsx scripts/news-retag.ts             apply
 */
import "./env";
import { blockedSource, lowValueTitle, namesCompany, tagStockHeadline } from "../src/lib/news/rules";
import { adminDb } from "../src/lib/supabase/admin";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = adminDb();
  const { data: stocks } = await db.from("stocks").select("symbol,name").eq("kind", "equity");
  const nameOf = new Map((stocks ?? []).map((s) => [s.symbol as string, s.name as string]));

  const items: { id: number; symbol: string; title: string; source: string | null; tags: string[] }[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await db.from("news_items").select("id,symbol,title,source,tags").neq("symbol", "_MARKET").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    items.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const remove: typeof items = [];
  const retag: { id: number; tags: string[] }[] = [];
  const why: Record<string, number> = {};
  for (const i of items) {
    const name = nameOf.get(i.symbol);
    const reason = !name ? "stock no longer tracked" : blockedSource(i.source, null) ? "blocked source" : lowValueTitle(i.title) ? "price blurb or quote page" : !namesCompany(i.title, i.symbol, name) ? "does not name the company" : null;
    if (reason) {
      remove.push(i);
      why[reason] = (why[reason] ?? 0) + 1;
      continue;
    }
    const tags = tagStockHeadline(i.title);
    if (tags.join("|") !== (i.tags ?? []).join("|")) retag.push({ id: i.id, tags });
  }

  const bySymbol = new Map<string, number>();
  const kept = new Map<string, number>();
  for (const i of items) kept.set(i.symbol, (kept.get(i.symbol) ?? 0) + 1);
  for (const r of remove) {
    bySymbol.set(r.symbol, (bySymbol.get(r.symbol) ?? 0) + 1);
    kept.set(r.symbol, kept.get(r.symbol)! - 1);
  }
  const top = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${dry ? "DRY RUN. " : ""}stored stock headlines: ${items.length} | to remove: ${remove.length} | kept: ${items.length - remove.length} | tags changed on kept: ${retag.length}`);
  console.log("reasons:", Object.entries(why).map(([k, v]) => `${k} ${v}`).join(", ") || "none");
  console.log("most removed:", top.slice(0, 14).map(([s, n]) => `${s} ${n} (keeps ${kept.get(s)})`).join(", "));
  console.log(`stocks touched: ${top.length} | stocks left with no headlines: ${[...kept.entries()].filter(([, n]) => n === 0).map(([s]) => s).join(", ") || "none"}`);
  for (const sym of ["MCX", "BSE", "OIL", "BANKINDIA", "COALINDIA", "TCS"]) {
    const gone = remove.filter((r) => r.symbol === sym);
    if (!gone.length && !kept.get(sym)) continue;
    console.log(`\n${sym}: removed ${gone.length}, kept ${kept.get(sym) ?? 0}`);
    for (const g of gone.slice(0, 3)) console.log(`   removed: ${g.title.slice(0, 100)}`);
    for (const k of items.filter((i) => i.symbol === sym && !remove.includes(i)).slice(0, 3)) console.log(`   kept:    ${k.title.slice(0, 100)}`);
  }
  console.log(`TOUCHED=${top.map(([s]) => s).join(",")}`);
  if (dry) return;

  for (let i = 0; i < remove.length; i += 200) {
    const { error } = await db.from("news_items").delete().in("id", remove.slice(i, i + 200).map((r) => r.id));
    if (error) throw new Error(`delete: ${error.message}`);
  }
  for (const r of retag) await db.from("news_items").update({ tags: r.tags }).eq("id", r.id);
  const { count } = await db.from("news_items").select("id", { count: "exact", head: true }).neq("symbol", "_MARKET");
  console.log(`\nApplied. Stock headlines now stored: ${count}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
