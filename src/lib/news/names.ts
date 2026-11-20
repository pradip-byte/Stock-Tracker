/**
 * Which headlines are about which company.
 *
 * A headline counts for a company only when it contains the company's full
 * name or one of its common short names. The ticker is never used on its own:
 * a short name such as "TCS" or "HUL" is listed here because newspapers use it,
 * not because it is the symbol.
 *
 * Rules of matching:
 *  - A name in capitals ("TCS", "ONGC") must appear as a whole word in capitals.
 *  - Any other name matches as whole words, ignoring case.
 *  - A regular expression is used where a short name is also the start of a
 *    different listed company ("SBI" but not "SBI Life", "L&T" but not "L&T Finance").
 *  - Exchanges (MCX, BSE) are named constantly as the place where something
 *    traded. For them the headline must be about the company itself: see VENUES.
 */

type Name = string | RegExp;

/** Common headline names, by symbol. When a symbol is listed here these replace the automatic short name. */
const ALIASES: Record<string, Name[]> = {
  "360ONE": ["360 ONE"],
  ABB: ["ABB India", /\bABB\b (shares?|stock|Q[1-4])/],
  ADANIENSOL: ["Adani Energy Solutions", "AESL"],
  ADANIGREEN: ["Adani Green"],
  ADANIPORTS: ["Adani Ports", "APSEZ"],
  AMBUJACEM: ["Ambuja Cements", "Ambuja Cement"],
  APLAPOLLO: ["APL Apollo"],
  APOLLOHOSP: ["Apollo Hospitals"],
  ASTRAL: [/\bAstral\b (Ltd|Limited|Pipes|shares?|stock|Q[1-4])/, "Astral Poly"],
  AUBANK: ["AU Small Finance Bank", "AU Bank", "AU SFB"],
  BAJAJHLDNG: ["Bajaj Holdings"],
  BANKINDIA: [/(?<!(State|Union|Central|Reserve|Exim|Overseas|Development) )\bBank of India\b/],
  INDIANB: [/\bIndian Bank\b(?!s|ing)/],
  BDL: ["Bharat Dynamics", "BDL"],
  BEL: ["Bharat Electronics", "BEL"],
  BHARTIARTL: ["Bharti Airtel", "Airtel"],
  BHEL: ["Bharat Heavy Electricals", "BHEL"],
  BOSCHLTD: [/\bBosch\b (Ltd|Limited|India|shares?|stock|Q[1-4])/],
  BPCL: ["Bharat Petroleum", "BPCL"],
  BRITANNIA: ["Britannia"],
  BSE: ["BSE Ltd", "BSE Limited", "BSE"],
  CGPOWER: ["CG Power"],
  CHOLAFIN: ["Cholamandalam Investment", "Cholamandalam Finance", "Chola Finance"],
  COALINDIA: ["Coal India"],
  COLPAL: ["Colgate-Palmolive", "Colgate Palmolive"],
  CONCOR: ["Container Corporation", "CONCOR", "Concor"],
  CUMMINSIND: ["Cummins India"],
  DIVISLAB: ["Divi's Lab", "Divi’s Lab", "Divis Lab"],
  DIXON: ["Dixon Technologies", "Dixon Tech"],
  DMART: ["DMart", "D-Mart", "Avenue Supermarts"],
  DRREDDY: ["Dr Reddy", "Dr. Reddy"],
  ENRIN: ["Siemens Energy India"],
  ETERNAL: ["Zomato", /\bEternal\b (Ltd|Limited|shares?|stock|Q[1-4])/, /\bEternal\b.*\b(Blinkit|Zomato)\b/],
  GLENMARK: ["Glenmark"],
  GMRAIRPORT: ["GMR Airports"],
  GODREJCP: ["Godrej Consumer"],
  GROWW: ["Groww"],
  "GVT&D": ["GE Vernova T&D", "GE Vernova"],
  HAL: ["Hindustan Aeronautics", "HAL"],
  HCLTECH: ["HCL Technologies", "HCL Tech", "HCLTech"],
  HDFCAMC: ["HDFC AMC", "HDFC Asset Management"],
  HDFCBANK: ["HDFC Bank"],
  HDFCLIFE: ["HDFC Life"],
  HINDPETRO: ["Hindustan Petroleum", "HPCL"],
  HINDUNILVR: ["Hindustan Unilever", "HUL"],
  HYUNDAI: ["Hyundai Motor India", "Hyundai India"],
  ICICIAMC: ["ICICI Prudential AMC", "ICICI Prudential Asset Management"],
  ICICIBANK: ["ICICI Bank"],
  ICICIGI: ["ICICI Lombard"],
  IDEA: ["Vodafone Idea"],
  INDHOTEL: ["Indian Hotels", "IHCL"],
  INDIGO: ["IndiGo", "InterGlobe Aviation"],
  INFY: ["Infosys"],
  IOC: ["Indian Oil", "IOCL", "IOC"],
  IRCTC: ["IRCTC"],
  IREDA: ["IREDA"],
  IRFC: ["IRFC"],
  // "ITC" is also input tax credit in every GST story
  ITC: [/^(?!.*\b(GST|CBIC|input tax credit|tax credit)\b).*\bITC\b(?! Hotels)/i],
  JINDALSTEL: ["Jindal Steel"],
  JIOFIN: ["Jio Financial"],
  JUBLFOOD: ["Jubilant FoodWorks"],
  KOTAKBANK: ["Kotak Mahindra Bank", "Kotak Bank"],
  LENSKART: ["Lenskart"],
  LGEINDIA: ["LG Electronics India"],
  LICHSGFIN: ["LIC Housing"],
  LICI: [/\bLIC\b(?! Housing| HFL| MF| Mutual)/, "Life Insurance Corporation"],
  LODHA: ["Lodha Developers", "Macrotech", /\bLodha\b (shares?|stock|Q[1-4]|group)/i],
  LT: [/\bL&T\b(?! Finance| Tech| Technology|TS)/, /Larsen (&|and) Toubro/i],
  LTF: ["L&T Finance"],
  LTM: ["LTIMindtree", "LTM"],
  "M&M": [/\bM&M\b(?! Fin)/, /Mahindra (&|and) Mahindra(?! Fin)/i],
  "M&MFIN": ["Mahindra Finance", "M&M Financial", /Mahindra (&|and) Mahindra Financial/i],
  MARUTI: ["Maruti Suzuki", "Maruti"],
  MAXHEALTH: ["Max Healthcare"],
  MAZDOCK: ["Mazagon Dock"],
  MCX: ["Multi Commodity Exchange", "MCX"],
  MFSL: ["Max Financial"],
  MOTHERSON: ["Samvardhana Motherson", "Motherson"],
  MOTILALOFS: ["Motilal Oswal Financial", "MOFSL"],
  MPHASIS: ["Mphasis"],
  NATIONALUM: ["National Aluminium", "NALCO", "Nalco"],
  NAUKRI: ["Info Edge", "Naukri"],
  NESTLEIND: ["Nestle India", "Nestlé India"],
  NLCINDIA: ["NLC India"],
  NTPC: [/\bNTPC\b(?! Green)/],
  NYKAA: ["Nykaa"],
  OFSS: ["Oracle Financial Services", "OFSS"],
  OIL: ["Oil India"],
  OLAELEC: ["Ola Electric"],
  ONGC: ["ONGC", /Oil (&|and) Natural Gas Corp/i],
  PATANJALI: ["Patanjali Foods", "Patanjali"],
  PAYTM: ["Paytm", "One 97 Communications"],
  PERSISTENT: ["Persistent Systems", /\bPersistent\b (shares?|stock|Q[1-4])/],
  PFC: ["Power Finance Corporation", "PFC"],
  PIDILITIND: ["Pidilite"],
  PNB: [/\bPNB\b(?! Housing)/, "Punjab National Bank"],
  POLICYBZR: ["PB Fintech", "Policybazaar"],
  POWERGRID: ["Power Grid"],
  POWERINDIA: ["Hitachi Energy India", "Hitachi Energy"],
  PRESTIGE: ["Prestige Estates"],
  RECLTD: ["REC Ltd", "REC Limited", /\bREC\b (shares?|stock|Q[1-4]|board|raises|to raise)/],
  RELIANCE: ["Reliance Industries", "RIL"],
  RVNL: ["Rail Vikas Nigam", "RVNL"],
  SAIL: ["Steel Authority of India", "SAIL"],
  SBICARD: ["SBI Card"],
  SBILIFE: ["SBI Life"],
  SBIN: [/\bSBI\b(?! Card| Life| Mutual| MF| General| Funds?| Securities| Caps| Capital)/, "State Bank of India"],
  SIEMENS: [/\bSiemens\b(?! Energy)/],
  SOLARINDS: ["Solar Industries"],
  SUNPHARMA: ["Sun Pharma"],
  SUZLON: ["Suzlon"],
  TATACONSUM: ["Tata Consumer"],
  TCS: ["Tata Consultancy Services", "TCS"],
  TIINDIA: ["Tube Investments"],
  TITAN: ["Titan Company", "Titan Co", "Tanishq", /\bTitan\b['’]?s? (shares?|stock|Q[1-4]|jewellery|net|profit|revenue|launches|opens|eyes|reports|posts|gains|falls|rises|slips|jumps)\b/],
  TMCV: [/Tata Motors(?! Passenger| PV)/],
  TMPV: ["Tata Motors Passenger", "Tata Motors PV"],
  TORNTPHARM: ["Torrent Pharma"],
  // Trent is also a common first name and a Rolls-Royce engine: the headline must have retail or market context
  TRENT: [/\bTrent\b(?=.*\b(Tata|Westside|Zudio|shares?|stock|Q[1-4]|retail(er)?|Noel|Nifty|Sensex)\b)|\b(Tata|Westside|Zudio|Nifty|Sensex|stocks?)\b.*\bTrent\b(?! 1000| XWB| 7000)/],
  ULTRACEMCO: ["UltraTech Cement", "UltraTech"],
  UNIONBANK: ["Union Bank of India", "Union Bank"],
  UNITDSPR: ["United Spirits"],
  VAML: ["Vedanta Aluminium"],
  VEDL: [/\bVedanta\b(?! Alumin)/],
  WAAREEENER: ["Waaree Energies", "Waaree"],
  ZYDUSLIFE: ["Zydus Lifesciences", "Zydus Life", "Zydus"],
};

/** Search terms for the few companies whose matching pattern cannot be turned into a plain search phrase. */
const QUERIES: Record<string, string> = {
  BANKINDIA: '"Bank of India" -"State Bank" -"Union Bank" -"Central Bank" -"Reserve Bank"',
  INDIANB: '"Indian Bank" -"Indian Banks"',
  ITC: '"ITC" (shares OR stock OR cigarette OR FMCG OR hotels OR Q2 OR Q3 OR results)',
  LICI: '"LIC" (insurer OR insurance OR shares OR stake OR premium) -"LIC Housing"',
  LT: '"L&T" OR "Larsen & Toubro"',
  "M&M": '"M&M" OR "Mahindra & Mahindra"',
  NTPC: '"NTPC"',
  PNB: '"PNB" OR "Punjab National Bank"',
  SBIN: '"SBI" OR "State Bank of India"',
  SIEMENS: '"Siemens" India',
  TITAN: '"Titan Company" OR "Titan shares" OR "Tanishq"',
  TMCV: '"Tata Motors"',
  TRENT: '"Trent" (shares OR stock OR Westside OR Zudio OR Tata)',
  VEDL: '"Vedanta" (shares OR stock OR demerger OR Agarwal OR dividend)',
  ABB: '"ABB India"',
  ASTRAL: '"Astral" (pipes OR shares OR stock)',
  BOSCHLTD: '"Bosch" India (shares OR stock OR Ltd)',
  ETERNAL: '"Zomato" OR "Eternal Ltd" OR "Blinkit"',
  LODHA: '"Lodha Developers" OR "Lodha" realty',
  RECLTD: '"REC Ltd" OR "REC Limited"',
};

/**
 * Exchanges are mentioned as a venue far more often than as a company.
 * `venue` marks a headline that only uses the name as a place or a price label;
 * `company` marks one that is clearly about the listed company. A headline is
 * kept only if it matches `company`, or matches neither pattern and has a
 * general company word (shares, results, board and so on).
 */
const VENUES: Record<string, { venue: RegExp; company: RegExp }> = {
  MCX: {
    venue: /\b(on|at|in|as) (the )?MCX\b|\bMCX\b:? ?(gold|silver|crude|copper|zinc|lead|nickel|aluminium|natural gas|cotton|mentha|bullion|futures?|prices?|rates?|contracts?)\b|\b(gold|silver|crude oil|copper|zinc|natural gas|bullion)\b.*\bMCX\b|\bMCX\b.*\b(gold|silver|crude oil|copper|zinc|natural gas|bullion)\b/i,
    company: /\bMCX\b['’]?s? (shares?|stock|share price|scrip|Q[1-4]|results|profit|net|revenue|earnings|board|dividend|ceo|md|to (launch|start|introduce|list)|launches|gets|receives|appoints|names|technical|glitch|outage|penalty|market cap|volumes? (hit|rise|jump|surge)|turnover|trading (session|hours|halt))|\b(shares?|stock) of MCX\b|Multi Commodity Exchange|\bMCX\b.*\b(glitch|outage|penalt\w+|fined|sebi)\b|\b(sebi|penalt\w+|fine[sd]?)\b.*\bMCX\b/i,
  },
  BSE: {
    venue: /\b(on|at|in) (the )?BSE\b|\bBSE\b:? ?(Sensex|SME|500|100|200|midcap|smallcap|bankex|index|indices|filing|data|website|code|listed|listing)\b|\b(NSE|Sensex|Nifty)\b|\b(lists?|listed|listing|debuts?|IPO)\b/i,
    company: /\bBSE\b['’]?s? (shares?|stock|share price|scrip|Q[1-4]|results|profit|net|revenue|earnings|board|dividend|ceo|md|to (launch|start|introduce|offer)|launches|gets|wins|receives|appoints|names|market cap|market share|turnover)|\b(shares?|stock) of BSE\b|\bBSE (Ltd|Limited)\b|\bBSE\b,[^.]*\b(shares?|stocks?)\b (fall|fell|rise|rose|pare|gain|slip|jump|drop|tumble|surge|in focus)|stocks? to watch\b.*\bBSE\b(?! Sensex)/i,
  },
};
const COMPANY_WORDS = /\b(shares?|stock|share price|scrip|q[1-4]|results?|profit|revenue|earnings|dividend|board|ceo|md|stake|target price|upgrade|downgrade|sebi|market cap|glitch|outage|penalt\w+|fined)\b/i;

/** Words too general to stand for a company on their own once "India" or "Corporation" is dropped. */
const GENERIC = new Set(["bank", "oil", "coal", "container", "steel", "power", "state", "union", "life", "indian", "national", "general", "united", "tata", "adani", "bajaj", "hdfc", "icici", "sbi", "reliance", "max", "info", "page", "supreme", "premier", "prestige", "solar", "federal", "motor", "energy", "finance"]);

/** Companies whose registered name also begins another company's name or is an everyday word, so only the listed patterns are used. */
const ONLY_LISTED = new Set(["TMCV", "ITC", "NTPC", "SIEMENS", "VEDL", "TRENT", "M&M", "ETERNAL", "ASTRAL", "BOSCHLTD", "RECLTD"]);

/** General terms that stay general even in pairs. */
const STRICT = new Set(["bank", "oil", "coal", "container", "steel", "power", "state", "union", "life", "indian", "national", "general", "united", "federal", "motor", "energy", "finance", "india", "insurance"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The company's registered name without "Limited" / "Ltd". Everything else, including "of India", is kept. */
export function fullName(name: string): string {
  return name
    .replace(/\b(limited|ltd\.?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[.,&-]+$/g, "")
    .trim();
}

/**
 * A shorter form that headlines use: the full name without a trailing
 * "Corporation", "Company", "Industries", "of India", "India" and the like,
 * kept only if what is left is still distinctive (two or more words, or one
 * word that is not a general term).
 */
export function shortName(name: string): string {
  const full = fullName(name);
  let s = full.replace(/\((india)\)/gi, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\s+(of india|india|corporation|corp\.?|company|co\.?|industries|enterprises?|international|and|of|&)$/i, "").trim();
  const words = s.split(" ").filter(Boolean);
  // several words are distinctive unless every one is a general term ("Union Bank", "State Bank");
  // a single word must not be a general term or a brand shared by many companies ("Coal", "Tata")
  const distinctive = words.length >= 2 ? !words.every((w) => STRICT.has(w.toLowerCase())) : s.length >= 4 && !GENERIC.has(s.toLowerCase());
  return distinctive ? s : full;
}

/** The names a headline may use for this company, most specific first. */
export function namesFor(symbol: string, name: string): Name[] {
  const full = fullName(name);
  const listed = ALIASES[symbol];
  if (listed) {
    // a registered name made only of general words ("Bank of India", "Indian Bank") sits inside other
    // companies' names, so for those only the listed patterns are used
    const words = full.split(" ").filter((w) => !/^(of|and|&|india)$/i.test(w));
    const general = words.every((w) => GENERIC.has(w.toLowerCase()));
    return general || ONLY_LISTED.has(symbol) ? listed : [full, ...listed];
  }
  const short = shortName(name);
  return short === full ? [full] : [full, short];
}

function hit(title: string, n: Name): boolean {
  if (n instanceof RegExp) return n.test(title);
  // capitals are an abbreviation: whole word, exact case. Anything else: whole words, any case.
  const abbreviation = /^[A-Z0-9&-]{2,}$/.test(n);
  return new RegExp(`(^|[^A-Za-z0-9])${escape(n)}($|[^A-Za-z0-9])`, abbreviation ? "" : "i").test(title);
}

/** True when the headline names the company and, for an exchange, is about the company rather than a price on it. */
export function namesCompany(title: string, symbol: string, name: string): boolean {
  if (!namesFor(symbol, name).some((n) => hit(title, n))) return false;
  const v = VENUES[symbol];
  if (!v) return true;
  if (v.company.test(title)) return true;
  if (v.venue.test(title)) return false;
  return COMPANY_WORDS.test(title);
}

/** Google News query for one company, limited to the last week: its two most useful plain names. */
export function companyQuery(symbol: string, name: string): string {
  if (QUERIES[symbol]) return `${QUERIES[symbol]} when:7d`;
  const listed = (ALIASES[symbol] ?? []).filter((n): n is string => typeof n === "string");
  const own = namesFor(symbol, name).filter((n): n is string => typeof n === "string");
  const terms = [...new Set(listed.length ? listed : own)].slice(0, 2);
  const safe = terms.length ? terms : [fullName(name)];
  return `${safe.map((t) => `"${t}"`).join(" OR ")} when:7d`;
}
