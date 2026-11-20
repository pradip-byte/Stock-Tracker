import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { cronAuthorised } from "@/lib/cron-auth";
import { PUBLISHER_FEEDS, fetchFeed, googleNewsUrl, headlineName, type FeedItem } from "@/lib/news/rss";
import { adminDb } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYMBOLS = ["RELIANCE", "HDFCBANK", "INFY", "TCS", "ICICIBANK", "OLAELEC", "RADICO", "MCX", "KALYANKJIL", "PHOENIXLTD"];
const hoursAgo = (iso: string | null) => (iso ? Math.round(((Date.now() - new Date(iso).getTime()) / 3600000) * 10) / 10 : null);

function summary(items: FeedItem[]) {
  const dated = items.filter((i) => i.published).sort((a, b) => b.published!.localeCompare(a.published!));
  const within = (h: number) => dated.filter((i) => hoursAgo(i.published)! <= h).length;
  return {
    items: items.length,
    last24h: within(24),
    last7d: within(168),
    newestHours: hoursAgo(dated[0]?.published ?? null),
    oldestHours: hoursAgo(dated[dated.length - 1]?.published ?? null),
    sample: dated[0]?.title.slice(0, 90) ?? items[0]?.title.slice(0, 90) ?? null,
    sources: [...new Set(items.map((i) => i.source).filter(Boolean))].slice(0, 6),
  };
}

/**
 * One-off probe of free news feeds, run from the deployed environment so it shows
 * what Vercel's servers can actually reach. Reads headlines only; stores nothing.
 */
async function handle(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data: stocks } = await adminDb().from("stocks").select("symbol,name,provider_symbol").in("symbol", SYMBOLS);
  const list = SYMBOLS.map((s) => stocks?.find((x) => x.symbol === s)).filter(Boolean) as { symbol: string; name: string; provider_symbol: string }[];

  // publisher feeds: fetched once, then matched against each company name
  const publishers = await Promise.all(
    PUBLISHER_FEEDS.map(async (f) => {
      const r = await fetchFeed(f.url);
      return { ...f, status: r.status, ok: r.ok, ms: r.ms, error: r.error ?? null, ...summary(r.items), all: r.items };
    }),
  );

  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const perStock = [];
  for (const s of list) {
    const name = headlineName(s.name);
    const first = name.split(" ")[0].toLowerCase();
    const g = await fetchFeed(googleNewsUrl(`"${name}"`));
    let yahoo: { ok: boolean; error: string | null; items: FeedItem[]; ms: number };
    const t = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await yf.search(s.provider_symbol, { newsCount: 20, quotesCount: 0 }, { validateResult: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (res?.news ?? []).map((n: any) => ({
        title: String(n.title ?? ""),
        url: String(n.link ?? ""),
        published: n.providerPublishTime ? new Date(n.providerPublishTime instanceof Date ? n.providerPublishTime : Number(n.providerPublishTime) * (Number(n.providerPublishTime) < 1e12 ? 1000 : 1)).toISOString() : null,
        source: n.publisher ?? null,
      }));
      yahoo = { ok: true, error: null, items, ms: Date.now() - t };
    } catch (e) {
      yahoo = { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 120), items: [], ms: Date.now() - t };
    }
    // how many of each source's items actually name the company
    const names = (items: FeedItem[]) => items.filter((i) => i.title.toLowerCase().includes(name.toLowerCase()) || i.title.toLowerCase().includes(first)).length;
    perStock.push({
      symbol: s.symbol,
      searched: name,
      google: { status: g.status, ok: g.ok, ms: g.ms, error: g.error ?? null, ...summary(g.items), namesCompany: names(g.items) },
      yahoo: { ok: yahoo.ok, ms: yahoo.ms, error: yahoo.error, ...summary(yahoo.items), namesCompany: names(yahoo.items) },
      publisherMatches: Object.fromEntries(publishers.map((p) => [p.id, names(p.all)])),
    });
  }
  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? "local",
    at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    publishers: publishers.map(({ all, ...p }) => p),
    perStock,
  });
}

export const GET = handle;
