/**
 * News from free feeds. No AI and no paid API.
 *
 *  - Market headlines: the Economic Times, Business Standard and Mint feeds, plus
 *    one Google News search for FII/DII figures. Tagged by keyword; tagged days
 *    are added to the macro event log so the app records what the market did next.
 *  - Stock headlines: one Google News search per stock per day (India English
 *    edition, last 7 days), spaced out, plus any publisher-feed headline that
 *    names the company.
 *
 * Only the headline, publisher, time and link are stored. Article text is never
 * fetched. Items are kept for 60 days.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLISHER_FEEDS, fetchFeed, googleNewsUrl, type FeedItem } from "../news/rss";
import {
  MACRO_TAG_INFO,
  blockedSource,
  cleanTitle,
  companyQuery,
  flowsFromHeadline,
  lowValueTitle,
  namesCompany,
  resultDateFromHeadline,
  tagMarketHeadline,
  tagStockHeadline,
  titleKey,
  type MacroTag,
} from "../news/rules";
import { istParts, todayIST } from "../market";
import { adminDb } from "../supabase/admin";
import type { JobResult } from "./core";
import { updateEventMoves } from "./macro";

export const MARKET = "_MARKET";
export const KEEP_DAYS = 60;
const REFETCH_HOURS = 20;
const PAUSE_MS = 2000; // between Google News requests, one at a time. About 200 requests in two minutes drew HTTP 429 in testing.
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { symbol: string; title: string; title_key: string; source: string | null; url: string; published_at: string; tags: string[] };

async function store(db: SupabaseClient, rows: Row[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    // an existing headline is left untouched, so its first-seen time is kept
    const { data, error } = await db.from("news_items").upsert(rows.slice(i, i + 200), { onConflict: "symbol,title_key", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`news_items upsert: ${error.message}`);
    added += data?.length ?? 0;
  }
  return added;
}

const fresh = (i: FeedItem) => i.published != null && Date.now() - new Date(i.published).getTime() < KEEP_DAYS * 86400000 && new Date(i.published).getTime() < Date.now() + 3600000;
const unique = (rows: Row[]) => [...new Map(rows.map((r) => [`${r.symbol}|${r.title_key}`, r])).values()];

// ───────────────────────── market headlines ─────────────────────────

/** Fetch the publisher feeds and the flows search; returns every usable item for stock matching. */
export async function fetchMarketNews(db: SupabaseClient): Promise<{ items: (FeedItem & { publisher: string })[]; added: number; failed: string[]; flows: number; events: number }> {
  const failed: string[] = [];
  const items: (FeedItem & { publisher: string })[] = [];
  const results = await Promise.all(PUBLISHER_FEEDS.map(async (f) => ({ f, r: await fetchFeed(f.url) })));
  for (const { f, r } of results) {
    if (!r.ok) failed.push(`${f.id}: ${r.error ?? `HTTP ${r.status}`}`);
    for (const i of r.items) if (fresh(i)) items.push({ ...i, publisher: f.publisher });
  }
  // FII/DII day figures are usually reported in a headline; one search looks for them
  const g = await fetchFeed(googleNewsUrl('FII DII "crore" (bought OR sold OR sell OR buy) when:2d'));
  if (!g.ok) failed.push(`google flows: ${g.error ?? `HTTP ${g.status}`}`);
  const flowItems = g.items.filter((i) => fresh(i) && !blockedSource(i.source, i.sourceUrl)).map((i) => ({ ...i, title: cleanTitle(i.title, i.source), publisher: i.source ?? "Google News" }));

  // the same story often sits in two feeds of one publisher: keep one copy
  const distinct = [...new Map(items.map((i) => [titleKey(i.title), i])).values()];
  // only headlines that carry a market tag are stored; the rest are used once, to match company names
  const rows: Row[] = [];
  for (const i of distinct) {
    const tags = lowValueTitle(i.title) ? [] : tagMarketHeadline(i.title);
    if (tags.length) rows.push({ symbol: MARKET, title: i.title.slice(0, 300), title_key: titleKey(i.title), source: i.publisher, url: i.url, published_at: i.published!, tags });
  }
  // from the flows search only headlines that actually carry a figure are kept
  for (const i of flowItems) {
    if (flowsFromHeadline(i.title)) rows.push({ symbol: MARKET, title: i.title.slice(0, 300), title_key: titleKey(i.title), source: i.publisher, url: i.url, published_at: i.published!, tags: ["FII"] });
  }
  const added = await store(db, unique(rows));

  // daily FII/DII figures, where a headline states them
  let flows = 0;
  for (const i of [...items, ...flowItems].sort((a, b) => a.published!.localeCompare(b.published!))) {
    const f = flowsFromHeadline(i.title);
    if (!f) continue;
    const date = istParts(new Date(i.published!)).date;
    const { data: cur } = await db.from("macro_flows").select("fii_net,dii_net").eq("date", date).maybeSingle();
    // a later headline may fill a missing side, but never overwrites a figure already captured
    const next = { fii_net: cur?.fii_net ?? f.fii, dii_net: cur?.dii_net ?? f.dii };
    if (cur && cur.fii_net === next.fii_net && cur.dii_net === next.dii_net) continue;
    const { error } = await db.from("macro_flows").upsert({ date, ...next, title: i.title.slice(0, 300), source: i.publisher, url: i.url, captured_at: new Date().toISOString() }, { onConflict: "date" });
    if (!error) flows++;
  }

  // event log: one entry per tag per day, once at least two headlines carry the tag
  const today = todayIST();
  const byTag = new Map<MacroTag, (FeedItem & { publisher: string })[]>();
  for (const i of distinct) {
    if (istParts(new Date(i.published!)).date !== today || lowValueTitle(i.title)) continue;
    for (const t of tagMarketHeadline(i.title)) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t)!.push(i);
    }
  }
  let events = 0;
  for (const [tag, list] of byTag) {
    if (list.length < 2) continue;
    const info = MACRO_TAG_INFO[tag];
    const { data: exists } = await db.from("macro_events").select("id").eq("origin", "feed").eq("event_date", today).eq("category", info.category).limit(1);
    if (exists?.length) continue;
    const lead = [...list].sort((a, b) => b.published!.localeCompare(a.published!))[0];
    const { error } = await db.from("macro_events").insert({
      origin: "feed",
      event_date: today,
      title: lead.title.slice(0, 200),
      category: info.category,
      summary: `${list.length} market headlines tagged "${tag}" that day. Tagged by keyword, not by AI.`,
      url: lead.url,
      source: lead.publisher,
      published: today,
      exposed: info.exposed,
    });
    if (!error) events++;
  }
  if (events) await updateEventMoves(db);
  return { items, added, failed, flows, events };
}

// ───────────────────────── stock headlines ─────────────────────────

type StockRef = { symbol: string; name: string };

async function fetchStockNews(db: SupabaseClient, stock: StockRef, market: (FeedItem & { publisher: string })[]): Promise<number> {
  const r = await fetchFeed(googleNewsUrl(companyQuery(stock.symbol, stock.name)));
  if (!r.ok) throw new Error(r.error ?? `Google News HTTP ${r.status}`);
  const rows: Row[] = [];
  const dated: { date: string; title: string; url: string; published: string }[] = [];
  const add = (title: string, source: string | null, url: string, published: string) => {
    rows.push({ symbol: stock.symbol, title: title.slice(0, 300), title_key: titleKey(title), source, url, published_at: published, tags: tagStockHeadline(title) });
    const date = resultDateFromHeadline(title, published);
    if (date) dated.push({ date, title, url, published });
  };
  for (const i of r.items) {
    if (!fresh(i) || blockedSource(i.source, i.sourceUrl)) continue;
    const title = cleanTitle(i.title, i.source);
    if (!lowValueTitle(title) && namesCompany(title, stock.symbol, stock.name)) add(title, i.source, i.url, i.published!);
  }
  // publisher-feed headlines that name the company
  for (const i of market) if (!lowValueTitle(i.title) && namesCompany(i.title, stock.symbol, stock.name)) add(i.title, i.publisher, i.url, i.published!);
  const added = await store(db, unique(rows));

  // a result or board-meeting date stated in a headline: the most recently published one that is still ahead
  const today = todayIST();
  const best = dated.filter((d) => d.date >= today).sort((a, b) => b.published.localeCompare(a.published))[0];
  if (best) {
    await db
      .from("fundamentals")
      .upsert({ symbol: stock.symbol, headline_result_date: best.date, headline_result_url: best.url, headline_result_title: best.title.slice(0, 300), headline_result_at: new Date().toISOString() }, { onConflict: "symbol" });
  }
  return added;
}

/**
 * Daily news run, time-boxed and resumable: market headlines first, then stocks
 * not fetched in the last 20 hours, least recently fetched first, one request
 * every two seconds and at most `maxStocks` per call. The schedule calls it
 * every five minutes over a few hours, so the whole list is spread thinly. If
 * Google answers "slow down" the run stops and the rest wait for the next call.
 */
export async function runNews(
  opts: { budgetMs?: number; force?: boolean; symbols?: string[]; maxStocks?: number; onProgress?: (line: string) => void } = {},
): Promise<JobResult> {
  const db = adminDb();
  const started = Date.now();
  const budget = opts.budgetMs ?? 45000;
  const { data: job } = await db.from("job_runs").insert({ job: "news", status: "running" }).select("id").single();
  const finish = async (status: string, ok: number, failures: { symbol: string; error: string }[], detail: object, error?: string): Promise<JobResult> => {
    if (job?.id) {
      await db
        .from("job_runs")
        .update({ status, finished_at: new Date().toISOString(), ok_count: ok, fail_count: failures.length, detail: { ...detail, failures: failures.slice(0, 40) }, error: error ?? null })
        .eq("id", job.id);
    }
    return { status, ok, failed: failures.length, detail, error };
  };
  try {
    const [{ data: stocks, error }, { data: states }] = await Promise.all([
      db.from("stocks").select("symbol,name").eq("kind", "equity").eq("backfill_status", "done").order("symbol"),
      db.from("news_state").select("symbol,fetched_at").limit(5000),
    ]);
    if (error) throw new Error(error.message);
    const fetchedAt = new Map((states ?? []).map((s) => [s.symbol as string, s.fetched_at as string | null]));
    const cutoff = new Date(Date.now() - REFETCH_HOURS * 3600000).toISOString();
    const todo = ((stocks ?? []) as StockRef[])
      .filter((s) => (opts.symbols ? opts.symbols.includes(s.symbol) : opts.force || !fetchedAt.get(s.symbol) || fetchedAt.get(s.symbol)! < cutoff))
      .sort((a, b) => (fetchedAt.get(a.symbol) ?? "").localeCompare(fetchedAt.get(b.symbol) ?? ""));

    // market feeds are light and hold only about a day of headlines, so they are read on every call
    const market = await fetchMarketNews(db);
    const failures = market.failed.map((f) => ({ symbol: "market", error: f }));
    if (!todo.length) {
      return await finish(failures.length ? "partial" : "ok", 0, failures, { remaining: 0, stocks: 0, marketAdded: market.added, flows: market.flows, events: market.events, note: "every stock was fetched in the last 20 hours" });
    }

    let ok = 0;
    let added = 0;
    let next = 0;
    let limited = false;
    const worker = async () => {
      while (!limited && next < todo.length && next < (opts.maxStocks ?? Infinity) && Date.now() - started < budget) {
        const s = todo[next++];
        try {
          const n = await fetchStockNews(db, s, market.items);
          added += n;
          ok++;
          await db.from("news_state").upsert({ symbol: s.symbol, fetched_at: new Date().toISOString(), last_error: null }, { onConflict: "symbol" });
          opts.onProgress?.(`${s.symbol.padEnd(12)} ${n} new`);
        } catch (e) {
          if (/HTTP 429/.test(msg(e))) {
            // rate limited: stop this run and leave the stock due, so the next call picks it up
            failures.push({ symbol: s.symbol, error: "Google News asked us to slow down (HTTP 429); stopped early" });
            limited = true;
            next--;
            return;
          }
          failures.push({ symbol: s.symbol, error: msg(e) });
          // mark it tried so one bad symbol cannot hold up the queue; the error is kept for the admin page
          await db.from("news_state").upsert({ symbol: s.symbol, fetched_at: new Date().toISOString(), last_error: msg(e) }, { onConflict: "symbol" });
          opts.onProgress?.(`${s.symbol.padEnd(12)} FAILED ${msg(e)}`);
        }
        await sleep(PAUSE_MS);
      }
    };
    await worker();

    // keep 60 days
    await db.from("news_items").delete().lt("published_at", new Date(Date.now() - KEEP_DAYS * 86400000).toISOString());
    const stockFailures = failures.filter((f) => f.symbol !== "market" && !/HTTP 429/.test(f.error)).length;
    const remaining = todo.length - ok - stockFailures;
    return await finish(failures.length || remaining > 0 ? "partial" : "ok", ok, failures, { remaining, stocks: todo.length, added, marketAdded: market.added, flows: market.flows, events: market.events });
  } catch (e) {
    return await finish("error", 0, [], {}, msg(e));
  }
}

/** Record that the user has opened a stock's page, so the "new" count on the stocks list starts again from now. */
export async function markNewsSeen(symbol: string, db: SupabaseClient = adminDb()): Promise<void> {
  await db.from("news_state").upsert({ symbol, seen_at: new Date().toISOString() }, { onConflict: "symbol" });
}
