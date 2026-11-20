/**
 * Minimal RSS reader. Only the headline, source, time and link are taken from a
 * feed; article text and descriptions are never read or stored.
 */

export type FeedItem = { title: string; url: string; published: string | null; source: string | null; sourceUrl: string | null };
export type FeedResult = { ok: boolean; status: number; ms: number; items: FeedItem[]; error?: string };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;

export function parseRss(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = decode(tag(block, "title") ?? "");
    const url = decode(tag(block, "link") ?? "");
    if (!title || !/^https?:\/\//.test(url)) continue;
    const date = tag(block, "pubDate") ?? tag(block, "dc:date");
    const t = date ? new Date(decode(date)) : null;
    const source = tag(block, "source");
    const sourceUrl = block.match(/<source[^>]*\burl="([^"]+)"/i)?.[1] ?? null;
    out.push({ title, url, published: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null, source: source ? decode(source) : null, sourceUrl });
  }
  return out;
}

/** Fetch and parse one feed. A plain reader identity is sent; nothing about the user or the app. */
export async function fetchFeed(url: string, timeoutMs = 10000): Promise<FeedResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; rss-reader/1.0)", Accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const text = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, ms: Date.now() - started, items: res.ok ? parseRss(text) : [] };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, items: [], error: (e instanceof Error ? e.name + ": " + e.message : String(e)).slice(0, 120) };
  }
}

/** Google News search feed, India English edition. */
export const googleNewsUrl = (query: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

/** Publisher feeds that cover Indian markets and companies. Moneycontrol's RSS is left out: it stopped updating in 2024. */
export const PUBLISHER_FEEDS = [
  { id: "et-markets", publisher: "Economic Times", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms" },
  { id: "et-stocks", publisher: "Economic Times", url: "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms" },
  { id: "bs-markets", publisher: "Business Standard", url: "https://www.business-standard.com/rss/markets-106.rss" },
  { id: "bs-companies", publisher: "Business Standard", url: "https://www.business-standard.com/rss/companies-101.rss" },
  { id: "mint-markets", publisher: "Mint", url: "https://www.livemint.com/rss/markets" },
  { id: "mint-companies", publisher: "Mint", url: "https://www.livemint.com/rss/companies" },
] as const;
