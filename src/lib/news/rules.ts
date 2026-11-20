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
  ["order win", /\b(bags?|wins?|secures?|receives?|awarded|lands?)\b.*\b(orders?|contracts?|deal|project|mandate|tender)|order (win|inflow|book)|letter of (award|intent)\b|\bloa\b/i],
  ["rating change", /\b(upgrades?|downgrades?|target price|price target|raises? target|cuts? target|initiates? coverage|maintains? (buy|sell|hold)|(buy|sell|hold|accumulate|reduce|overweight|underweight|outperform|underperform) (rating|call)|brokerages?|credit rating|rating (upgrade|downgrade|cut|raised))/i],
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

/** A company name as headlines write it: no "Limited", "Ltd", "of India" tails. */
export function shortName(name: string): string {
  return name
    .replace(/\b(limited|ltd\.?|corporation|corp\.?|company|co\.?)\b/gi, " ")
    .replace(/\(india\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\s+(of|and|&|india|of india))+$/i, "")
    .replace(/[.,&-]+$/g, "")
    .trim();
}

/**
 * The symbol, when headlines use it as the company's short form (TCS, MCX, SAIL):
 * all capitals, three to five letters, starting with the name's first letter, and
 * spelt out in order by letters of the full name. "IDEA" for Vodafone Idea fails
 * the first-letter test, so an ordinary word is not mistaken for a company.
 */
export function acronymOf(symbol: string, name: string): string | null {
  if (!/^[A-Z]{3,5}$/.test(symbol)) return null;
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters[0] !== symbol[0]) return null;
  // the name itself already is the symbol ("ITC Limited"): nothing to add
  if (shortName(name).toUpperCase() === symbol) return null;
  let at = 0;
  for (const ch of symbol) {
    at = letters.indexOf(ch, at);
    if (at < 0) return null;
    at++;
  }
  return symbol;
}

/** Google News query for one company, limited to the last week. */
export function companyQuery(symbol: string, name: string): string {
  const acr = acronymOf(symbol, name);
  return `"${shortName(name)}"${acr ? ` OR "${acr}"` : ""} when:7d`;
}

/** True when the headline actually names the company (its short name, its first two words, or its acronym). */
export function namesCompany(title: string, symbol: string, name: string): boolean {
  const t = title.toLowerCase();
  const short = shortName(name).toLowerCase();
  if (short && t.includes(short)) return true;
  const two = short.split(" ").slice(0, 2).join(" ");
  if (two.includes(" ") && two.length >= 7 && t.includes(two)) return true;
  const acr = acronymOf(symbol, name);
  return acr != null && new RegExp(`\\b${acr}\\b`).test(title);
}

/** Sites whose pages are generated stock write-ups or re-published content, not reporting. Matched on the publisher's domain or name. */
export const NEWS_BLOCKED = [
  "marketsmojo", "scanx.trade", "multibagg", "ad-hoc-news", "wikipedia", "perplexity", "simplywall.st", "simply wall st", "tradingview", "univest",
  "whalesbook", "investywise", "stockanalysis", "ainvest", "munafasutra", "blinkx", "sahi", "stocktwits", "investing.com", "marketbeat", "defense world",
  "tipranks", "moomoo", "equitypandit", "trendlyne", "tickertape", "insidermonkey", "zacks", "gurufocus", "seeking alpha", "motley fool",
  "kalkine", "global banking & finance", "globalbankingandfinance", "inshorts", "business upturn", "businessupturn", "markhub24", "stockiq",
  "taxpayers for common sense", "taxpayer.net", "linkedin",
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
    /\b(share|stock) price (today )?(live|updates?)\b|live updates?:|\bprice today\b.*\bcheck\b|investor analysis|stocks? today, \w+ \d+:/i.test(title) ||
    /\b(gold|silver)\b.*\b(price|rate)s?\b/i.test(title)
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
