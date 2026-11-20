/**
 * Rule-based reading of headlines. No AI anywhere in this file: every tag,
 * date and figure comes from keyword and pattern matching on the headline text,
 * so it can be wrong in both directions. The page always shows the headline
 * itself and its link next to anything derived from it.
 */

// ───────────────────────── stock headline tags ─────────────────────────

export const STOCK_TAGS = ["results", "guidance", "order win", "rating change", "regulatory", "management change", "block deal", "other"] as const;
export type StockTag = (typeof STOCK_TAGS)[number];

const STOCK_RULES: [StockTag, RegExp][] = [
  ["results", /\b(q[1-4]\b|q[1-4]\s?fy|quarter(ly)? (results?|earnings|profit|numbers)|results?\b|earnings|net profit|profit (rises?|falls?|jumps?|drops?|up|down|surges?|slumps?|declines?)|pat\b|revenue (rises?|falls?|up|down|grows?)|board meeting)/i],
  ["guidance", /\b(guidance|outlook|forecasts?|expects?\b.*\b(growth|revenue|margin)|targets? (revenue|growth|margin)|raises? (its )?(forecast|guidance|outlook)|cuts? (its )?(forecast|guidance|outlook)|commentary)/i],
  // only a won or received order or contract: "order book" and "order inflow" on their own do not count
  ["order win", /\b(bags?|bagged|wins?|won|secures?|secured|receives?|received|gets?|got|awarded|lands?|landed|clinch(es|ed)?)\b[^.;:]{0,60}\b(orders?|contracts?|mandate|tender|work order|letter of (award|intent))\b|\b(orders?|contracts?) (wins?|won|worth|from|for)\b.*\b(bags?|wins?|secures?|receives?|gets?)\b|\border wins?\b|\bletter of award\b|\bLoA\b/i],
  // includes broker-call headlines: "Buy HDFC Bank; target of Rs 1,850: ICICI Securities"
  ["rating change", /\b(upgrades?|downgrades?|target price|price target|raises? target|cuts? target|initiates? coverage|maintains? (buy|sell|hold)|(buy|sell|hold|accumulate|reduce|overweight|underweight|outperform|underperform) (rating|call)|brokerages?|credit rating|rating (upgrade|downgrade|cut|raised))|\btarget (price )?of (rs\.?|₹|inr)|^(buy|hold|sell|accumulate|reduce|add|neutral) [A-Z0-9]/i],
  ["regulatory", /\b(sebi|rbi|cci|nclt|nclat|irdai|trai|fssai|usfda|us fda|fda|cbi|\bed\b|enforcement directorate|income[- ]tax|gst (notice|demand)|tax (notice|demand)|show[- ]cause|penalt(y|ies)|fine[sd]?\b|probe|investigation|raid|ban(s|ned)?\b|court|tribunal|lawsuit|warning letter|form 483|regulator|compliance)/i],
  ["management change", /\b(ceo|cfo|coo|cto|md\b|managing director|chairman|chairperson|chief executive|chief financial)\b.*\b(appoint|resign|quit|step|steps|named|names|joins?|exit|retire|elevat|replac|successor)|\b(appoints?|resigns?|quits?|steps? down|named as|to succeed|re-?appoint)\b/i],
  ["block deal", /\b(block deal|bulk deal|stake sale|sells? .*stake|offloads?|pares? stake|buys? .*stake|acquires? .*stake|promoters? (sell|buy|pledge)|ofs\b|offer for sale|qip\b|open offer|pledg)/i],
];

/** Every tag whose keywords appear in the headline; "other" when none do. */
export function tagStockHeadline(title: string): StockTag[] {
  const tags = STOCK_RULES.filter(([, re]) => re.test(title)).map(([t]) => t);
  return tags.length ? tags : ["other"];
}

// ───────────────────────── market headline tags ─────────────────────────

export const MACRO_TAGS = ["crude", "Fed", "RBI", "FII", "geopolitics", "policy"] as const;
export type MacroTag = (typeof MACRO_TAGS)[number];

const MACRO_RULES: [MacroTag, RegExp][] = [
  ["crude", /\b(crude|brent|wti|oil prices?|opec|barrel)\b/i],
  ["Fed", /\b(fed\b|federal reserve|fomc|powell|us rate (cut|hike)|treasury yields?|us inflation|us jobs|payrolls)\b/i],
  ["RBI", /\b(rbi|reserve bank of india|repo rate|monetary policy committee|\bmpc\b|crr\b|governor (das|malhotra))\b/i],
  ["FII", /\b(fiis?|fpis?|diis?|foreign (institutional|portfolio) investors?|foreign (inflows?|outflows?|selling|buying)|domestic institutional)\b/i],
  ["geopolitics", /\b(war|wars|ceasefire|missiles?|strikes? on|attacks?|sanctions?|iran|israel|gaza|ukraine|russia|taiwan|hormuz|red sea|houthis?|border tensions?|military)\b|\bgeopolit/i],
  ["policy", /\b(tariffs?|trade deal|trade talks|budget|gst council|gst rate|import duty|export (ban|duty)|pli scheme|sebi (rule|norm|board|proposal)|cabinet (approves|clears)|fiscal deficit|disinvestment|trump)\b/i],
];

export function tagMarketHeadline(title: string): MacroTag[] {
  return MACRO_RULES.filter(([, re]) => re.test(title)).map(([t]) => t);
}

/** The event-log category and the sectors usually sensitive to each kind of market headline. No direction is implied. */
export const MACRO_TAG_INFO: Record<MacroTag, { category: string; exposed: { sector: string; why: string }[] }> = {
  crude: {
    category: "Crude oil",
    exposed: [
      { sector: "Oil Gas & Consumable Fuels", why: "Producers gain and fuel retailers lose when crude rises; the reverse when it falls." },
      { sector: "Chemicals", why: "Crude derivatives are a main input cost." },
      { sector: "Automobile and Auto Components", why: "Fuel prices affect demand and input costs." },
    ],
  },
  Fed: {
    category: "US Federal Reserve",
    exposed: [
      { sector: "Information Technology", why: "US rates and growth drive client spending and the rupee." },
      { sector: "Financial Services", why: "Global rates move foreign flows into banks." },
      { sector: "Metals & Mining", why: "The dollar and global growth move metal prices." },
    ],
  },
  RBI: {
    category: "RBI",
    exposed: [
      { sector: "Financial Services", why: "Policy rates and liquidity set lending margins." },
      { sector: "Realty", why: "Home-loan rates drive housing demand." },
      { sector: "Automobile and Auto Components", why: "Vehicle loans get cheaper or dearer." },
    ],
  },
  FII: {
    category: "FII/DII flows",
    exposed: [
      { sector: "Financial Services", why: "The largest foreign holding in Indian equities." },
      { sector: "Information Technology", why: "Heavily foreign-owned large caps." },
    ],
  },
  geopolitics: {
    category: "Geopolitics",
    exposed: [
      { sector: "Oil Gas & Consumable Fuels", why: "Conflict risk moves energy prices." },
      { sector: "Capital Goods", why: "Defence and shipbuilding orders react to security news." },
      { sector: "Metals & Mining", why: "Supply disruptions move commodity prices." },
    ],
  },
  policy: {
    category: "Policy",
    exposed: [
      { sector: "Capital Goods", why: "Government spending and tariffs change order flows." },
      { sector: "Power", why: "Tariff and capacity policy sets returns." },
      { sector: "Information Technology", why: "US trade and visa policy affects exporters." },
    ],
  },
};

// ───────────────────────── company matching ─────────────────────────

// Which headline is about which company lives in ./names (full names and common short names, never the ticker alone).
export { companyQuery, fullName, namesCompany, namesFor, shortName } from "./names";

/** Sites whose pages are generated stock write-ups or re-published content, not reporting. Matched on the publisher's domain or name. */
export const NEWS_BLOCKED = [
  "marketsmojo", "scanx.trade", "multibagg", "ad-hoc-news", "wikipedia", "perplexity", "simplywall.st", "simply wall st", "tradingview", "univest",
  "whalesbook", "investywise", "stockanalysis", "ainvest", "munafasutra", "blinkx", "sahi", "stocktwits", "investing.com", "marketbeat", "defense world",
  "tipranks", "moomoo", "equitypandit", "trendlyne", "tickertape", "insidermonkey", "zacks", "gurufocus", "seeking alpha", "motley fool",
  "kalkine", "global banking & finance", "globalbankingandfinance", "inshorts", "business upturn", "businessupturn", "markhub24", "stockiq",
  "taxpayers for common sense", "taxpayer.net", "linkedin", "facebook", "youtube", "instagram", "reddit", "quora", "yahoo finance", "yahoo! finance",
];

export function blockedSource(source: string | null, sourceUrl: string | null): boolean {
  const hay = `${source ?? ""} ${sourceUrl ?? ""}`.toLowerCase();
  return NEWS_BLOCKED.some((b) => hay.includes(b));
}

/**
 * Machine-written price blurbs and landing pages that carry no news:
 * "X falls 2.2% in Wednesday's session", "share price today live", "Investor Analysis | StockIQ".
 */
export function lowValueTitle(title: string): boolean {
  return (
    /\b(falls?|rises?|gains?|declines?|drops?|jumps?|slips?|advances?) [\d.]+% in \w+day'?s? (session|trade)/i.test(title) ||
    /live updates?:|\bprice today\b.*\bcheck\b|investor analysis|stocks? today, \w+ \d+:/i.test(title) ||
    /\b(gold|silver)\b.*\b(price|rate)s?\b/i.test(title) ||
    // quote, chart and data pages rather than news. "share price hits a new high" is news; "Share Price Today" is a page.
    /\boption chain\b|\b(share|stock) price(s)? (today|live|updates?|history|chart|quote|target 20\d\d|nse|bse|on nse|on bse)\b|\b(share|stock) price\s*([,|&–-]|$)|stock price, news, quote|market news$/i.test(title) ||
    /returns chart|\(0P[0-9A-Z]+\.[A-Z]+\)|shareholding pattern|company profile|financial statements|futures? (&|and) options quote|\bF&O quote\b|historical (prices|data)|\bstock (quote|forecast|analysis) (\||-|&)|price target (&|and) analyst/i.test(title)
  );
}

/** Google News headlines end with " - Publisher"; strip it. */
export function cleanTitle(title: string, source: string | null): string {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3)).trim();
  return title.replace(/\s+[-|]\s+[^-|]{2,40}$/, (m) => (/\d/.test(m) ? m : "")).trim() || title;
}

/** Normalised headline used to spot the same story stored twice. */
export const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);

// ───────────────────────── result date stated in a headline ─────────────────────────

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * A future result or board-meeting date that a headline states outright, as YYYY-MM-DD.
 * The headline must be about results or a board meeting, must name a day and a month,
 * and the date must fall after the headline was published and within 75 days of it.
 * Phrases about results already out ("reported", "posted", "announced ... results") are skipped.
 */
export function resultDateFromHeadline(title: string, publishedIso: string): string | null {
  if (!/\b(results?|earnings|board meet(ing)?|q[1-4])\b/i.test(title)) return null;
  if (!/\b(to (announce|declare|report|consider|release|post)|will (announce|declare|report|consider|release)|results? (date|on|due)|board (meet(ing)?|to meet)|scheduled|slated|set to|date (fixed|announced)|on which date)\b/i.test(title)) return null;
  const m =
    title.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b(?:,?\\s*(20\\d{2}))?`, "i")) ??
    (() => {
      const r = title.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(20\\d{2}))?`, "i"));
      return r ? [r[0], r[2], r[1], r[3]] : null;
    })();
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[String(m[2]).slice(0, 3).toLowerCase()];
  if (!(day >= 1 && day <= 31) || month == null) return null;
  const pub = new Date(publishedIso);
  const pubDay = new Date(Date.UTC(pub.getUTCFullYear(), pub.getUTCMonth(), pub.getUTCDate()));
  const years = m[3] ? [Number(m[3])] : [pub.getUTCFullYear(), pub.getUTCFullYear() + 1];
  for (const y of years) {
    const d = new Date(Date.UTC(y, month, day));
    if (d.getUTCDate() !== day) continue; // 31 June and the like
    const ahead = (d.getTime() - pubDay.getTime()) / 86400000;
    if (ahead >= 0 && ahead <= 75) return d.toISOString().slice(0, 10);
  }
  return null;
}

// ───────────────────────── FII / DII figures stated in a headline ─────────────────────────

/** A rupee-crore figure near a mention of the investor group, signed by the verb beside it. Null when the headline gives none. */
function flowOf(title: string, who: RegExp): number | null {
  const m = title.match(who);
  if (!m || m.index == null) return null;
  // read from the mention up to the next mention of the other group, or 90 characters
  const rest = title.slice(m.index + m[0].length);
  const stop = rest.search(/\b(fiis?|fpis?|diis?|foreign|domestic)\b/i);
  const span = (stop > 0 ? rest.slice(0, stop) : rest).slice(0, 90);
  const amount = span.match(/(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s?(lakh\s+)?(?:crore|cr)\b/i) ?? span.match(/\b([\d,]+(?:\.\d+)?)\s?(lakh\s+)?(?:crore|cr)\b/i);
  if (!amount) return null;
  let value = Number(amount[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  if (amount[2]) value *= 100000;
  const sell = /\b(sell|sold|sells|selling|offload|offloads|offloaded|dump|dumps|dumped|pull|pulls|pulled|withdraw|withdrew|outflow|outflows|net sellers?|exit)\b/i.test(span);
  const buy = /\b(buy|buys|bought|buying|invest|invests|invested|infuse|infuses|infused|pump|pumps|pumped|inflow|inflows|net buyers?|purchase|purchased|absorb|absorbed)\b/i.test(span);
  if (sell === buy) return null; // no verb, or both: do not guess the sign
  return sell ? -value : value;
}

/** Net FII and DII equity figures in rupees crore, if the headline states them. Monthly or cumulative figures are skipped. */
export function flowsFromHeadline(title: string): { fii: number | null; dii: number | null } | null {
  if (/\b(this month|so far|in (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|month[- ]to[- ]date|year[- ]to[- ]date|ytd|mtd|in 20\d{2}|this year|this week|weekly|monthly|record)\b/i.test(title)) return null;
  const fii = flowOf(title, /\b(fiis?|fpis?|foreign (institutional |portfolio )?investors?)\b/i);
  const dii = flowOf(title, /\b(diis?|domestic institutional investors?|domestic (institutions|funds))\b/i);
  return fii == null && dii == null ? null : { fii, dii };
}

// ───────────────────────── broker calls ─────────────────────────

const BROKERS = [
  "CLSA", "UBS", "Jefferies", "Morgan Stanley", "Goldman Sachs", "JP Morgan", "JPMorgan", "Citi", "Nomura", "Macquarie", "HSBC", "Bernstein", "BofA", "Bank of America",
  "Barclays", "Deutsche Bank", "Daiwa", "BNP Paribas", "Investec", "Mirae", "Kotak Institutional Equities", "Kotak Securities", "Kotak Neo", "Motilal Oswal", "ICICI Securities",
  "ICICI Direct", "HDFC Securities", "Axis Securities", "Axis Capital", "SBI Securities", "Emkay", "Nuvama", "Prabhudas Lilladher", "Anand Rathi", "Sharekhan", "Geojit",
  "Choice Broking", "Choice Equity", "JM Financial", "Antique", "Elara", "Nirmal Bang", "IIFL", "Systematix", "Centrum", "YES Securities", "Ambit", "Avendus", "InCred",
  "Equirus", "DAM Capital", "LKP", "KR Choksey", "PhillipCapital", "Phillip Capital", "Dolat", "Ventura", "Religare", "Arihant", "Asit C Mehta", "BOB Capital", "Mirae Asset",
];
const CALLS: [string, RegExp][] = [
  ["Upgrade", /\bupgrad(es?|ed)\b/i],
  ["Downgrade", /\bdowngrad(es?|ed)\b/i],
  ["Buy", /^buy\b|\b(buy|bullish) (rating|call|on)\b|\b(maintains?|retains?|reiterates?|keeps?|initiates?( coverage)? with|rates?|recommends?) (a |an )?['‘"]?buy\b|\bbuy['’"]? (rating|call|tag)/i],
  ["Accumulate", /^accumulate\b|\baccumulate['’"]? (rating|call)|\b(maintains?|retains?) ['‘"]?accumulate/i],
  ["Add", /^add\b|\b(maintains?|retains?|rates?) ['‘"]?add\b|\badd['’"]? (rating|call)/i],
  ["Hold", /^hold\b|\bhold['’"]? (rating|call)|\b(maintains?|retains?|keeps?) ['‘"]?hold\b/i],
  ["Neutral", /^neutral\b|\bneutral['’"]? (rating|call|stance)|\b(maintains?|retains?) ['‘"]?neutral/i],
  ["Reduce", /^reduce\b|\breduce['’"]? (rating|call)|\b(maintains?|retains?) ['‘"]?reduce/i],
  ["Sell", /^sell\b|\bsell['’"]? (rating|call)|\b(maintains?|retains?|initiates?( coverage)? with) (a )?['‘"]?sell\b/i],
  ["Overweight", /\boverweight\b/i],
  ["Underweight", /\bunderweight\b/i],
  ["Outperform", /\boutperform\b/i],
  ["Underperform", /\bunderperform\b/i],
  ["Target raised", /\b(raises?|raised|hikes?|hiked|lifts?|ups) (its |the )?(price )?target|target (price )?(raised|hiked|lifted)/i],
  ["Target cut", /\b(cuts?|lowers?|lowered|slashes?|trims?|reduces?) (its |the )?(price )?target|target (price )?(cut|lowered|slashed|trimmed)/i],
];

export type BrokerCall = { broker: string | null; call: string | null; target: number | null };

/**
 * The broker, the call and the target price that a rating headline states.
 * Any part the headline does not state is left empty. A headline that only asks
 * the question ("Buy, sell or hold?") gives no call.
 */
export function brokerCall(title: string): BrokerCall | null {
  // round-ups that list many companies cannot be pinned on one of them
  if (/\bamong\b|\btop (upgrades?|downgrades?|picks?|buys?)\b|\b\d+ (nifty |sensex )?(stocks|shares)\b|stocks to (buy|watch|sell)/i.test(title)) return null;
  const asks = /\bbuy,? (sell,? )?or (sell|hold)\b|should you (buy|sell)|\bbuy or sell\b/i.test(title);
  const call = asks ? null : (CALLS.find(([, re]) => re.test(title))?.[0] ?? null);
  const t = title.match(/target(?: price)?(?: of| to| at|:| raised to| cut to| hiked to| lowered to)?\s*(?:rs\.?|₹|inr)\s?([\d,]+(?:\.\d+)?)/i) ?? title.match(/(?:rs\.?|₹|inr)\s?([\d,]+(?:\.\d+)?)\s*(?:price )?target/i);
  const target = t ? Number(t[1].replace(/,/g, "")) : null;
  let broker = BROKERS.find((b) => new RegExp(`(^|[^A-Za-z])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z])`, "i").test(title)) ?? null;
  if (!broker) {
    // "Buy X; target of Rs 1,850: Some Securities"
    const tail = title.match(/:\s*([A-Z][A-Za-z&.' ]{2,40})$/)?.[1]?.trim();
    if (tail && tail.split(" ").length <= 4 && /(securities|capital|broking|research|financial|equities|institutional|direct)$/i.test(tail)) broker = tail;
  }
  if (!broker && call == null && target == null) return null;
  if (call == null && target == null) return null; // a broker's name alone is not a call
  return { broker, call, target: target != null && Number.isFinite(target) && target > 0 ? target : null };
}

// ───────────────────────── news tone ─────────────────────────

const POSITIVE =
  /\b(upgrad(es?|ed)|raises? (its |the )?(price )?(target|guidance|forecast|outlook)|target (price )?(raised|hiked|lifted)|hikes? target|guidance raised|record (orders?|order book|high|profit|revenue|sales|quarter|volumes?)|beats? (estimates?|expectations?|street|forecasts?)|profit (rises?|jumps?|surges?|soars?|up|grows?|doubles|triples|zooms?|climbs?)|net (profit )?(rises?|jumps?|surges?|up|doubles)|revenue (rises?|jumps?|grows?|up|climbs?)|(bags?|bagged|wins?|won|secures?|secured|receives?|received) [^.;:]{0,50}\b(orders?|contracts?)|order wins?|outperform|overweight|rall(y|ies|ied)|surges?|soars?|hits? (a )?(record|new|fresh|52-week|all-time|lifetime) high|turns? profitable|returns? to profit|strong (growth|quarter|results|demand|show|numbers)|buyback|bonus (issue|shares)|(usfda|fda|regulatory) (nod|approval)|gets? (nod|approval|clearance)|top (pick|gainer)|bullish)\b/i;
const NEGATIVE =
  /\b(downgrad(es?|ed)|cuts? (its |the )?(price )?(target|guidance|forecast|outlook)|target (price )?(cut|lowered|slashed|trimmed)|slashes? target|guidance cut|miss(es|ed)? (estimates?|expectations?|street|forecasts?)|profit (falls?|drops?|slumps?|declines?|plunges?|down|halves|shrinks?|dips?|slips?|tumbles?)|net (profit )?(falls?|drops?|declines?|down|slumps?)|net loss|loss (widens|widened)|posts? (a )?loss|revenue (falls?|drops?|declines?|down|slips?)|probes?|penalt(y|ies)|fined|fines\b|halts?|halted|resigns?|resigned|quits?|steps? down|raids?|raided|fraud|defaults?|underperform|underweight|slumps?|plunges?|tumbles?|crash(es|ed)?|hits? (a )?(52-week|record|all-time|new|fresh) low|warning letter|show[- ]cause|ban(s|ned)\b|lawsuit|sued|layoffs?|recalls?|weak (demand|quarter|results|show|numbers)|top loser|bearish|scam|insolvency|bankrupt)\b/i;

/**
 * +1, 0 or -1 for one headline, from keywords and any broker call it states.
 * A headline with both kinds of word, or neither, scores 0. This reads words,
 * not meaning: "profit falls less than feared" scores -1.
 */
export function toneOfHeadline(title: string): -1 | 0 | 1 {
  const call = brokerCall(title)?.call ?? null;
  const up = POSITIVE.test(title) || (call != null && ["Buy", "Accumulate", "Add", "Upgrade", "Overweight", "Outperform", "Target raised"].includes(call));
  const down = NEGATIVE.test(title) || (call != null && ["Sell", "Reduce", "Downgrade", "Underweight", "Underperform", "Target cut"].includes(call));
  return up === down ? 0 : up ? 1 : -1;
}

export type ToneLabel = "Positive" | "Mixed" | "Negative" | "Quiet";
export type NewsTone = { label: ToneLabel; positive: number; negative: number; total: number };

/**
 * 30-day tone for a stock from its headline counts.
 *   Quiet     fewer than 3 headlines scored either way
 *   Positive  at least twice as many positive as negative, and at least 2 more
 *   Negative  the mirror image
 *   Mixed     anything else
 */
export function toneLabel(positive: number, negative: number, total: number): NewsTone {
  const scored = positive + negative;
  const label: ToneLabel =
    scored < 3 ? "Quiet" : positive >= 2 * negative && positive - negative >= 2 ? "Positive" : negative >= 2 * positive && negative - positive >= 2 ? "Negative" : "Mixed";
  return { label, positive, negative, total };
}
