/**
 * External signals: what the wider world is saying about a stock.
 *
 * Cost controls:
 *  1. Sector context (outlook, trade exposure, currency/commodity sensitivity, risks)
 *     is researched once a week per sector and reused for every stock in it.
 *     A stock call searches only for company-specific news, guidance and result dates.
 *  2. A stock call is capped at 2 web searches (3 only when a result is within 30 days,
 *     the third aimed at analyst expectations for that quarter); an industry call at 3.
 *  3. The weekly run skips a stock when it has no result within 30 days, its price
 *     moved less than 5% over the week, and its last read is under 3 weeks old.
 *  4. Every call is logged to ai_runs with searches, tokens and estimated cost.
 *
 * Source quality: searches are limited to an allowlist (the exchanges, established
 * business news, and the company's own site). Only when that finds no usable news
 * is the call repeated once with open search and a blocklist, and the read is then
 * marked as built on low-grade sources.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCost } from "../ai/pricing";
import { ALLOWED_DOMAINS, BLOCKED_DOMAINS, aiConfigured, runResearch, siteDomain, urlKey, verifiedUrl, type ResearchResult, type SearchDomains, type SearchSource } from "../ai/research";
import { dayDiff } from "../format";
import { todayIST } from "../market";
import { adminDb } from "../supabase/admin";
import { recomputeSymbol, type JobResult } from "./core";

export const STOCK_MAX_SEARCHES = 2;
export const STOCK_MAX_SEARCHES_RESULT_SOON = 3;
const RISK_MAX_AGE_DAYS = 90;
const NEWS_MAX_AGE_DAYS = 90;
export const SECTOR_MAX_SEARCHES = 3;
const SECTOR_FRESH_DAYS = 6.5;
const WEEKLY_DONE_DAYS = 6; // a read newer than this means the stock is done for this week's run
const SKIP_READ_DAYS = 21;
const SKIP_MOVE_PCT = 5;
const TOP_BY_TECHNICAL = 30;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const daysSince = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number, fallback = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

// ───────────────────────── schemas (strict JSON) ─────────────────────────

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = (description: string) => ({ type: "string", description });

const RISK_ITEM = obj({
  risk: text("The risk, in one short sentence."),
  url: text("URL of the search result that reports it, copied exactly."),
  published: text("Publication date of that search result as YYYY-MM-DD. It must be within the last 90 days."),
});

const SECTOR_SCHEMA = obj({
  outlook: text("Two or three plain sentences on the sector's outlook over the next 6-12 months in India."),
  outlook_score: { type: "integer", enum: [-2, -1, 0, 1, 2], description: "-2 clearly negative, 0 neutral, +2 clearly positive." },
  export_import_exposure: text("How much the sector depends on exports and on imported inputs. One or two sentences."),
  currency_commodity_sensitivity: text("Which currencies and commodities move the sector's earnings, and in which direction. One or two sentences."),
  key_risks: { type: "array", items: RISK_ITEM, description: "Up to four industry-level risks. Include a risk only if a search result dated within the last 90 days reports it. Otherwise leave it out." },
  confidence: { type: "integer", description: "0 to 100: how well the search results support this note." },
});

const STOCK_SCHEMA = obj({
  news_sentiment: { type: "integer", enum: [-2, -1, 0, 1, 2], description: "Tone of company-specific news in the last 30 days. -2 clearly negative, 0 neutral or no news, +2 clearly positive." },
  sentiment_rationale: text("One or two sentences explaining the sentiment score."),
  key_news: {
    type: "array",
    description: "Up to four company-specific items from the search results, newest first, each from a different source page. Empty if the searches found nothing relevant.",
    items: obj({
      headline: text("What happened, in one sentence."),
      url: text("URL of the search result this came from, copied exactly."),
      published: text("Publication date as YYYY-MM-DD if known, otherwise an empty string."),
      why_it_matters: text("One sentence on why it matters for the stock."),
    }),
  },
  last_quarter_guidance: obj({
    summary: text("What management guided or said at the latest quarterly result. Empty string if the search results do not cover it."),
    tone: { type: "integer", enum: [-1, 0, 1], description: "-1 cautious, 0 neutral or unknown, +1 confident." },
    url: text("URL of the search result this came from, or an empty string."),
  }),
  next_result_expectations: obj({
    summary: text("What the market or analysts expect from the next result. Empty string if the search results do not cover it."),
    tone: { type: "integer", enum: [-1, 0, 1], description: "-1 expectations are weak, 0 neutral or unknown, +1 expectations are strong." },
  }),
  next_result_date: obj({
    date: text("Date of the next quarterly result as YYYY-MM-DD, only if a search result states it. Otherwise an empty string. Never infer it from past patterns."),
    basis: {
      type: "string",
      enum: ["company_announcement", "exchange_filing", "media_report", "none"],
      description: "company_announcement or exchange_filing only when the search result is the company's own notice or an NSE/BSE board-meeting intimation.",
    },
    url: text("URL of the search result that states the date, or an empty string."),
  }),
  company_risks: { type: "array", items: RISK_ITEM, description: "Up to three company-specific risks. Include a risk only if a search result dated within the last 90 days reports it. Otherwise leave it out." },
  confidence: { type: "integer", description: "0 to 100: how well the search results support this read. Use a low number when the searches found little." },
});

export const RULES = `You are a research assistant for one private investor in Indian equities. The output feeds a mechanical scoring model, so accuracy matters more than coverage.

Rules:
- Base every statement on the web search results from this conversation. If the results do not cover something, leave that field empty or neutral. Do not fill gaps from memory.
- Copy URLs exactly as they appear in the search results. Do not construct or guess a URL.
- Prefer primary sources: exchange filings (bseindia.com, nseindia.com) and the company's own investor pages first, then established business news (Business Standard, Economic Times, Mint, Moneycontrol, Reuters). Use other sites only when none of these cover the point.
- Use each source page for at most one news item.
- A risk counts only if a search result published in the last 90 days reports it. Give that result's URL and publication date. Leave out any risk you cannot source this way; an empty list is fine.
- Write plainly and briefly. No recommendations to buy or sell.
- When you have finished searching, call submit_research exactly once.`;

// ───────────────────────── ai_runs log ─────────────────────────

export async function startRun(db: SupabaseClient, kind: "sector" | "stock" | "macro", key: string, trigger: "weekly" | "manual") {
  const { data } = await db.from("ai_runs").insert({ kind, key, trigger, status: "running" }).select("id").single();
  return (data?.id as number | undefined) ?? null;
}

export async function finishRun(db: SupabaseClient, id: number | null, started: number, r: ResearchResult) {
  if (id == null) return;
  await db
    .from("ai_runs")
    .update({
      model: r.model,
      status: r.ok ? "ok" : r.status,
      duration_ms: Date.now() - started,
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_read_tokens: r.usage.cacheReadTokens,
      cache_write_tokens: r.usage.cacheWriteTokens,
      searches: r.usage.searches,
      cost_usd: estimateCost(r.usage),
      error: r.ok ? null : r.error,
    })
    .eq("id", id);
}

export const dedupe = (sources: SearchSource[]) => [...new Map(sources.map((s) => [s.url, s])).values()].slice(0, 30);

/** Turn a search result's page age ("April 30, 2026", "112 days ago", "3 weeks ago") into a date, or null. */
export function pageDate(pageAge: string | null | undefined): string | null {
  if (!pageAge) return null;
  const rel = pageAge.trim().match(/^(\d+|an?)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (rel) {
    const n = /^an?$/i.test(rel[1]) ? 1 : Number(rel[1]);
    const days = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }[rel[2].toLowerCase() as "day"] * n;
    return new Date(Date.now() - days * 86400000 + 330 * 60000).toISOString().slice(0, 10);
  }
  if (/^(today|yesterday)$/i.test(pageAge.trim())) {
    return new Date(Date.now() - (/yesterday/i.test(pageAge) ? 86400000 : 0) + 330 * 60000).toISOString().slice(0, 10);
  }
  const parsed = new Date(pageAge);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** The publication date of a source if it is known and no more than `maxDays` old, otherwise null. */
export function recentDate(published: unknown, pageAge: string | null, maxDays: number): string | null {
  const today = todayIST();
  const fromModel = /^\d{4}-\d{2}-\d{2}$/.test(str(published, 10)) ? str(published, 10) : null;
  const fromSearch = pageDate(pageAge);
  // when the search engine reports the page's age, that wins over the model's reading of the date
  const date = fromSearch ?? fromModel;
  if (!date) return null;
  const age = dayDiff(date, today);
  return age >= -1 && age <= maxDays ? date : null;
}

export type DatedRisk = { risk: string; url: string; published: string };

/** Keep a risk only when it has a link the model actually saw and that source is dated within the last 90 days. */
function datedRisks(raw: unknown, sources: SearchSource[], max: number): DatedRisk[] {
  const out: DatedRisk[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = (item ?? {}) as Record<string, unknown>;
    const url = verifiedUrl(r.url, sources);
    if (!url || !str(r.risk)) continue;
    const src = sources.find((s) => s.url === url);
    const published = recentDate(r.published, src?.pageAge ?? null, RISK_MAX_AGE_DAYS);
    if (published) out.push({ risk: str(r.risk, 240), url, published });
  }
  return out.slice(0, max);
}

/** Sector notes are keyed by the provider's industry ("Marine Ports"), falling back to the exchange sector. */
export const sectorKey = (stock: { industry?: string | null; sector?: string | null }) => stock.industry?.trim() || stock.sector?.trim() || null;

// ───────────────────────── sector research (weekly, shared) ─────────────────────────

type SectorNote = { id: number; run_at: string; outlook_score: number | null; payload: Record<string, unknown> };

async function latestSector(db: SupabaseClient, sector: string): Promise<SectorNote | null> {
  const { data } = await db
    .from("sector_research")
    .select("id,run_at,outlook_score,payload")
    .eq("sector", sector)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SectorNote | null) ?? null;
}

export async function researchSector(db: SupabaseClient, sector: string, trigger: "weekly" | "manual"): Promise<SectorNote & { costUsd: number }> {
  let costUsd = 0;
  const call = async (domains: SearchDomains) => {
    const started = Date.now();
    const runId = await startRun(db, "sector", sector, trigger);
    const res = await runResearch({ system: RULES, maxSearches: SECTOR_MAX_SEARCHES, schema: SECTOR_SCHEMA, domains, prompt });
    await finishRun(db, runId, started, res);
    costUsd += estimateCost(res.usage);
    return res;
  };
  const prompt = `Research the "${sector}" industry in India as it stands today (${todayIST()}).

Use at most ${SECTOR_MAX_SEARCHES} web searches. Cover: the outlook for the next 6-12 months, dependence on exports and imported inputs, sensitivity to the rupee and to commodity prices, and the main industry-level risks. This note will be reused for every listed company in this industry, so keep it at industry level and do not single out individual companies.`;
  let r = await call({ allowed: ALLOWED_DOMAINS });
  // the allowlisted sites returned nothing at all: try once more with open search
  let lowGrade = false;
  if (r.ok && !r.sources.length) {
    const open = await call({ blocked: BLOCKED_DOMAINS });
    if (open.ok && open.sources.length) {
      r = open;
      lowGrade = true;
    }
  }
  if (!r.ok) throw new Error(`Sector research failed for ${sector}: ${r.error}`);

  const d = r.data;
  const payload = {
    outlook: str(d.outlook, 1200),
    outlook_score: int(d.outlook_score, -2, 2),
    export_import_exposure: str(d.export_import_exposure),
    currency_commodity_sensitivity: str(d.currency_commodity_sensitivity),
    key_risks: datedRisks(d.key_risks, r.sources, 4),
    confidence: r.sources.length ? int(d.confidence, 0, 100) : Math.min(30, int(d.confidence, 0, 100)),
    low_grade_sources: lowGrade,
  };
  const { data, error } = await db
    .from("sector_research")
    .insert({ sector, model: r.model, outlook_score: payload.outlook_score, payload, sources: dedupe(r.sources) })
    .select("id,run_at,outlook_score,payload")
    .single();
  if (error) throw new Error(`sector_research insert: ${error.message}`);
  return { ...(data as SectorNote), costUsd };
}

// ───────────────────────── stock research ─────────────────────────

/** News items that carry a headline and a link the model actually saw, not older than 90 days, one per source page, at most four. */
function usableNews(d: Record<string, unknown>, sources: SearchSource[]) {
  return (Array.isArray(d.key_news) ? d.key_news : [])
    .map((n) => {
      const item = (n ?? {}) as Record<string, unknown>;
      return { headline: str(item.headline, 300), url: verifiedUrl(item.url, sources), published: str(item.published, 10), why_it_matters: str(item.why_it_matters, 300) };
    })
    .filter((n) => n.headline && n.url)
    // an item known to be older than 90 days is not news; undated items are kept
    .filter((n) => {
      const date = pageDate(sources.find((x) => x.url === n.url)?.pageAge) ?? (/^\d{4}-\d{2}-\d{2}$/.test(n.published) ? n.published : null);
      return date == null || dayDiff(date, todayIST()) <= NEWS_MAX_AGE_DAYS;
    })
    .filter((n, i, all) => all.findIndex((m) => urlKey(m.url!) === urlKey(n.url!)) === i)
    .slice(0, 4);
}

/** External score: 50 is neutral. The pull away from 50 is scaled by how confident the read is. */
export function externalScore(p: { sentiment: number; guidanceTone: number; expectationsTone: number; sectorOutlook: number; confidence: number }): number {
  const raw = 50 + p.sentiment * 10 + p.guidanceTone * 8 + p.expectationsTone * 6 + p.sectorOutlook * 6;
  return Math.round(Math.min(100, Math.max(0, 50 + (raw - 50) * (p.confidence / 100))));
}

export async function researchStock(
  symbol: string,
  trigger: "weekly" | "manual",
): Promise<{ ok: boolean; error?: string; score?: number; costUsd?: number }> {
  if (!aiConfigured()) return { ok: false, error: "AI reads are switched off (EXTERNAL_AI_ENABLED is not true) or ANTHROPIC_API_KEY is not set." };
  const db = adminDb();
  const { data: stock } = await db
    .from("stock_latest")
    .select("symbol,name,sector,industry,next_result_date,next_result_is_estimate")
    .eq("symbol", symbol)
    .eq("kind", "equity")
    .maybeSingle();
  if (!stock) return { ok: false, error: `${symbol} is not tracked.` };
  const key = sectorKey(stock);

  try {
    // 1. sector context: reuse this week's note, or research it once
    let sector: SectorNote | null = key ? await latestSector(db, key) : null;
    let sectorCost = 0;
    if (key && (!sector || daysSince(sector.run_at) > SECTOR_FRESH_DAYS)) {
      const fresh = await researchSector(db, key, trigger);
      sectorCost = fresh.costUsd;
      sector = fresh;
    }

    // 2. company-specific call: two searches, or three when a result is within 30 days
    const { data: fund } = await db.from("fundamentals").select("website").eq("symbol", symbol).maybeSingle();
    const companySite = siteDomain(fund?.website as string | null | undefined);
    const today = todayIST();
    const resultSoon = stock.next_result_date != null && stock.next_result_date >= today && dayDiff(today, stock.next_result_date) <= 30;
    const maxSearches = resultSoon ? STOCK_MAX_SEARCHES_RESULT_SOON : STOCK_MAX_SEARCHES;
    // The provider's own date is deliberately not shown to the model: given one, it tends to echo it back as "confirmed".
    const known = "Report a next result date only if a search result states it explicitly, such as a board-meeting intimation naming the date. If none does, leave the date empty.";
    const prompt = `Company: ${stock.name} (NSE: ${symbol}). Today is ${today}.

You have at most ${maxSearches} web searches. Spend them on company-specific information only:
1. News about the company from the last 30 days, and what management guided at its latest quarterly result.
2. The date of its next quarterly result (a board-meeting intimation to NSE/BSE or a company notice)${resultSoon ? "." : " and what the market expects from it."}${
        resultSoon
          ? `
3. Its next result is due within 30 days, so use the third search for analyst and brokerage expectations for that specific quarter: revenue, profit and margin estimates, and what would count as a beat or a miss.`
          : ""
      }

${known}

Sector context is already researched and will be attached separately, so do not search for sector outlook, export/import exposure or currency sensitivity.`;
    let stockCost = 0;
    const call = async (domains: SearchDomains) => {
      const started = Date.now();
      const runId = await startRun(db, "stock", symbol, trigger);
      const res = await runResearch({ system: RULES, maxSearches, schema: STOCK_SCHEMA, domains, prompt });
      await finishRun(db, runId, started, res);
      stockCost += estimateCost(res.usage);
      return { res, runId };
    };
    // allowlisted sites plus the company's own domain first
    let { res: r, runId } = await call({ allowed: companySite ? [...ALLOWED_DOMAINS, companySite] : ALLOWED_DOMAINS });
    if (!r.ok) return { ok: false, error: r.error, costUsd: stockCost + sectorCost };
    // no usable news from those: one retry with open search and the blocklist, and the read is marked low-grade
    let lowGrade = false;
    if (!usableNews(r.data, dedupe(r.sources)).length) {
      const open = await call({ blocked: BLOCKED_DOMAINS });
      if (open.res.ok) {
        r = open.res;
        runId = open.runId;
        lowGrade = true;
      }
    }

    // 3. keep only what the search results support
    const d = r.data;
    const sources = dedupe(r.sources);
    const news = usableNews(d, sources);
    const g = (d.last_quarter_guidance ?? {}) as Record<string, unknown>;
    const x = (d.next_result_expectations ?? {}) as Record<string, unknown>;
    const nd = (d.next_result_date ?? {}) as Record<string, unknown>;
    const guidance = { summary: str(g.summary), tone: str(g.summary) ? int(g.tone, -1, 1) : 0, url: verifiedUrl(g.url, sources) };
    const expectations = { summary: str(x.summary), tone: str(x.summary) ? int(x.tone, -1, 1) : 0 };

    const dateUrl = verifiedUrl(nd.url, sources);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(nd.date, 10)) ? str(nd.date, 10) : null;
    const basis = str(nd.basis, 30);
    const inWindow = date != null && date >= today && dayDiff(today, date) <= 150;
    // "confirmed" needs a company or exchange notice, a link the model actually saw, a sensible future date,
    // and a source page the search engine dates within the last 90 days: an old investor page cannot announce a new date.
    const dateSource = sources.find((x) => x.url === dateUrl);
    const noticeIsRecent = recentDate(null, dateSource?.pageAge ?? null, RISK_MAX_AGE_DAYS) != null;
    const confirmed = inWindow && dateUrl != null && noticeIsRecent && (basis === "company_announcement" || basis === "exchange_filing");

    let confidence = int(d.confidence, 0, 100);
    if (!sources.length) confidence = Math.min(confidence, 20); // nothing was found, so nothing is well supported
    const sentiment = news.length || str(d.sentiment_rationale) ? int(d.news_sentiment, -2, 2) : 0;
    const sectorOutlook = sector?.outlook_score ?? 0;
    const score = externalScore({ sentiment, guidanceTone: guidance.tone, expectationsTone: expectations.tone, sectorOutlook, confidence });

    const payload = {
      news_sentiment: sentiment,
      sentiment_rationale: str(d.sentiment_rationale),
      key_news: news,
      last_quarter_guidance: guidance,
      next_result_expectations: expectations,
      next_result_date: { date: inWindow ? date : null, basis: inWindow ? basis : "none", url: dateUrl, confirmed },
      company_risks: datedRisks(d.company_risks, sources, 3),
      confidence,
      searches: r.usage.searches,
      low_grade_sources: lowGrade,
    };
    const { error } = await db.from("external_signals").insert({
      symbol,
      model: r.model,
      sentiment,
      confidence,
      score,
      payload,
      sources,
      sector_research_id: sector?.id ?? null,
      ai_run_id: runId,
    });
    if (error) throw new Error(`external_signals insert: ${error.message}`);

    // 4. a confirmed date overrides the provider's estimate everywhere
    if (confirmed) {
      await db.from("fundamentals").upsert(
        { symbol, confirmed_result_date: date, confirmed_result_url: dateUrl, confirmed_result_at: new Date().toISOString() },
        { onConflict: "symbol" },
      );
    }
    // 5. the external score feeds the verdict
    await recomputeSymbol(db, symbol, 1);
    return { ok: true, score, costUsd: stockCost + sectorCost };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

// ───────────────────────── weekly selection ─────────────────────────

export type Selection = { symbol: string; sector: string | null; run: boolean; reason: string };

/** Watchlist plus the top 30 by technical score, with the skip rule applied. */
export async function selectWeekly(db: SupabaseClient): Promise<Selection[]> {
  const { data: rows, error } = await db
    .from("stock_latest")
    .select("symbol,sector,industry,in_watchlist,technical,spark,next_result_date")
    .eq("kind", "equity")
    .eq("backfill_status", "done")
    .limit(3000);
  if (error) throw new Error(error.message);
  const all = rows ?? [];
  const top = [...all].filter((r) => r.technical != null).sort((a, b) => b.technical - a.technical).slice(0, TOP_BY_TECHNICAL);
  const chosen = new Map<string, (typeof all)[number]>();
  for (const r of all) if (r.in_watchlist) chosen.set(r.symbol, r);
  for (const r of top) chosen.set(r.symbol, r);

  // newest read per stock
  const lastRead = new Map<string, string>();
  const { data: reads } = await db.from("external_signals").select("symbol,run_at").order("run_at", { ascending: false }).limit(3000);
  for (const r of reads ?? []) if (!lastRead.has(r.symbol)) lastRead.set(r.symbol, r.run_at);

  const today = todayIST();
  return [...chosen.values()]
    .sort((a, b) => Number(b.in_watchlist) - Number(a.in_watchlist) || (b.technical ?? 0) - (a.technical ?? 0))
    .map((r): Selection => {
      const age = daysSince(lastRead.get(r.symbol));
      const base = { symbol: r.symbol as string, sector: sectorKey(r) };
      if (age === Infinity) return { ...base, run: true, reason: "never read" };
      if (age < WEEKLY_DONE_DAYS) return { ...base, run: false, reason: `already read ${age.toFixed(1)} days ago` };
      const spark: number[] = Array.isArray(r.spark) ? r.spark.map(Number) : [];
      const move = spark.length >= 6 ? Math.abs((spark[spark.length - 1] / spark[spark.length - 6] - 1) * 100) : null;
      const resultSoon = r.next_result_date != null && r.next_result_date >= today && dayDiff(today, r.next_result_date) <= 30;
      if (resultSoon) return { ...base, run: true, reason: "result within 30 days" };
      if (move == null || move >= SKIP_MOVE_PCT) return { ...base, run: true, reason: move == null ? "week's move unknown" : `moved ${move.toFixed(1)}% this week` };
      if (age >= SKIP_READ_DAYS) return { ...base, run: true, reason: `last read ${Math.round(age)} days ago` };
      return { ...base, run: false, reason: `skipped: no result in 30 days, moved ${move.toFixed(1)}% this week, read ${Math.round(age)} days ago` };
    });
}

/**
 * Weekly run. Works through the selection two stocks at a time and stops
 * starting new calls once the time budget is used, so it can be called
 * repeatedly; stocks read in the last 6 days count as done.
 */
export async function runExternalWeekly(
  opts: { budgetMs?: number; limit?: number; onProgress?: (line: string) => void } = {},
): Promise<JobResult> {
  const db = adminDb();
  const { data: job } = await db.from("job_runs").insert({ job: "external", status: "running" }).select("id").single();
  const finish = async (status: string, ok: number, failures: { symbol: string; error: string }[], detail: object, error?: string) => {
    if (job?.id) {
      await db
        .from("job_runs")
        .update({ status, finished_at: new Date().toISOString(), ok_count: ok, fail_count: failures.length, detail: { ...detail, failures: failures.slice(0, 40) }, error: error ?? null })
        .eq("id", job.id);
    }
    return { status, ok, failed: failures.length, detail, error };
  };
  try {
    if (!aiConfigured()) return await finish("error", 0, [], {}, "Paid AI jobs are switched off (EXTERNAL_AI_ENABLED is not true) or ANTHROPIC_API_KEY is not set");
    const selection = await selectWeekly(db);
    const todo = selection.filter((s) => s.run).slice(0, opts.limit ?? Infinity);
    const skipped = selection.filter((s) => !s.run && s.reason.startsWith("skipped")).length;
    if (!todo.length) return await finish("skipped", 0, [], { reason: "nothing due this week", selected: selection.length, skipped });

    const started = Date.now();
    const budget = opts.budgetMs ?? 150000;
    let ok = 0;
    let cost = 0;
    let next = 0;
    const failures: { symbol: string; error: string }[] = [];
    // sequential within a sector matters: the first stock of a sector researches it, the rest reuse it
    const worker = async () => {
      while (next < todo.length && Date.now() - started < budget) {
        const s = todo[next++];
        const r = await researchStock(s.symbol, "weekly");
        cost += r.costUsd ?? 0;
        if (r.ok) ok++;
        else failures.push({ symbol: s.symbol, error: r.error ?? "unknown error" });
        opts.onProgress?.(`${s.symbol.padEnd(12)} ${r.ok ? `ok  score ${r.score}` : `FAILED ${r.error}`}  (${s.reason})`);
      }
    };
    await worker();
    const remaining = todo.length - ok - failures.length;
    const detail = { remaining, due: todo.length, selected: selection.length, skipped, est_cost_usd: Math.round(cost * 1000) / 1000 };
    return await finish(failures.length || remaining > 0 ? "partial" : "ok", ok, failures, detail);
  } catch (e) {
    return await finish("error", 0, [], {}, msg(e));
  }
}

// ───────────────────────── one-off: move existing reads onto industry notes ─────────────────────────

/**
 * For each stock's latest read that is attached to a note for a different key
 * (for example the exchange's broad sector), attach the industry note instead,
 * researching it if this week's does not exist yet. The stock call is not repeated:
 * the score is recalculated from the stored read and the new outlook. Risks stored
 * without a dated source are removed.
 */
export async function relinkToIndustry(onProgress?: (line: string) => void): Promise<{ relinked: number; costUsd: number }> {
  const db = adminDb();
  const { data: reads } = await db.from("external_signals").select("id,symbol,payload,confidence,sentiment,sector_research_id").order("run_at", { ascending: false }).limit(3000);
  const latest = new Map<string, NonNullable<typeof reads>[number]>();
  for (const r of reads ?? []) if (!latest.has(r.symbol)) latest.set(r.symbol, r);
  let relinked = 0;
  let costUsd = 0;
  for (const read of latest.values()) {
    const { data: stock } = await db.from("stock_latest").select("sector,industry").eq("symbol", read.symbol).maybeSingle();
    const key = stock ? sectorKey(stock) : null;
    if (!key) continue;
    const { data: cur } = read.sector_research_id
      ? await db.from("sector_research").select("sector").eq("id", read.sector_research_id).maybeSingle()
      : { data: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (read.payload ?? {}) as Record<string, any>;
    const risks = (Array.isArray(p.company_risks) ? p.company_risks : []).filter((x: unknown) => typeof x === "object" && x !== null);
    const risksChanged = risks.length !== (Array.isArray(p.company_risks) ? p.company_risks.length : 0);
    if (cur?.sector === key && !risksChanged) continue;

    let note = await latestSector(db, key);
    if (!note || daysSince(note.run_at) > SECTOR_FRESH_DAYS) {
      const fresh = await researchSector(db, key, "manual");
      costUsd += fresh.costUsd;
      note = fresh;
    }
    const score = externalScore({
      sentiment: Number(read.sentiment ?? 0),
      guidanceTone: Number(p.last_quarter_guidance?.tone ?? 0),
      expectationsTone: Number(p.next_result_expectations?.tone ?? 0),
      sectorOutlook: note.outlook_score ?? 0,
      confidence: Number(read.confidence ?? 0),
    });
    await db.from("external_signals").update({ sector_research_id: note.id, score, payload: { ...p, company_risks: risks } }).eq("id", read.id);
    await recomputeSymbol(db, read.symbol, 1);
    relinked++;
    onProgress?.(`${read.symbol.padEnd(12)} -> "${key}" (was "${cur?.sector ?? "none"}")  score ${score}`);
  }
  return { relinked, costUsd };
}
