import type { NewsTone } from "./news/rules";
import type { MacroView, SectorMacroItem } from "./macro";
import type { EntryPlan } from "./entry";
export type Candle = {
  time: string; // YYYY-MM-DD (IST)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Timeframe = "D" | "W" | "M";
export type Verdict = "Favourable" | "Neutral" | "Avoid";
export type Risk = "Low" | "Medium" | "High";
export type SignalKind = "Bounce" | "Trend" | "Breakdown";

export const INDEX_SYMBOLS = ["NIFTY50", "INDIAVIX"] as const;

export type Quote = { price: number; prevClose: number | null; marketTime: string | null };
export type Quotes = Record<string, Quote>;

/** One tracked stock with its latest quote, indicators and scores. Null means "not available", never a guess. */
export type StockRow = {
  symbol: string;
  name: string;
  sector: string | null;
  source: string;
  inWatchlist: boolean;
  backfillStatus: "pending" | "running" | "done" | "error";
  backfillError: string | null;
  price: number | null;
  prevClose: number | null;
  marketTime: string | null;
  indDate: string | null;
  spark: number[];
  hi52: number | null;
  lo52: number | null;
  distHi52: number | null;
  distLo52: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr: number | null;
  volRatio: number | null;
  support: number[];
  resistance: number[];
  bounce: boolean;
  trend: boolean;
  breakdown: boolean;
  /** Headline signal: Bounce, then Breakdown, then Trend. */
  signal: SignalKind | null;
  tech: number | null;
  techReasons: string[];
  risk: Risk | null;
  rr: number | null;
  target: number | null;
  stop: number | null;
  // Results and fundamentals
  event: number | null;
  eventReasons: string[];
  nextResultDate: string | null;
  nextResultEstimate: boolean;
  nextResultSource: string | null;
  pe: number | null;
  roe: number | null;
  debtToEquity: number | null;
  profitMargin: number | null;
  fundamentalsAt: string | null;
  fiscalYearEndMonth: number | null;
  nextResultUrl: string | null;
  /** The headline a "From headline" result date was read from. */
  nextResultHeadline: string | null;
  // Filled by later phases
  external: number | null;
  overall: number | null;
  shortVerdict: Verdict | null;
  longVerdict: Verdict | null;
  shortScore: number | null;
  longScore: number | null;
  shortReasons: string[];
  longReasons: string[];
  odds: SignalOdds | null;
  // Phase 5
  /** 12-1 month momentum rank among tracked stocks, 0 to 100. */
  momRank: number | null;
  /** Six-month return minus Nifty 50's, percentage points. */
  rs6: number | null;
  /** Nifty 50 above its 200 DMA when the score was computed. */
  marketUp: boolean | null;
  entry: EntryPlan | null;
  /** 30-day news tone from keyword rules. Shown and recorded on paper trades; never part of a verdict. */
  newsTone: NewsTone;
};

export type SectorGroup = { sector: string; symbols: string[] };

export type DashboardData = {
  rows: Record<string, StockRow>;
  niftySeries: { date: string; close: number }[];
  eodDate: string | null;
  today: string;
  fundamentalsAt: string | null;
  results: { symbol: string; date: string; estimate: boolean }[];
  resultsUnknown: number;
  /** Nearest known result dates beyond the 30-day window. */
  resultsLater: { symbol: string; date: string; estimate: boolean }[];
  /** Backtest pooled across every tracked stock. */
  signalBoard: SignalStats[];
  shortSetups: string[];
  longCandidates: string[];
  highRisk: string[];
  sectors: SectorGroup[];
  counts: { tracked: number; pending: number; bounce: number; trend: number; breakdown: number };
  macro: MacroView;
};

/** A risk backed by a news source dated within 90 days of the read. */
export type DatedRisk = { risk: string; url: string; published: string };

/** The latest AI read for a stock. Every link in it appeared in the search results of the run. */
export type ExternalRead = {
  runAt: string;
  model: string | null;
  score: number | null;
  sentiment: number;
  sentimentRationale: string;
  confidence: number;
  searches: number | null;
  /** True when the allowlisted sites had no usable news and the read came from open search. */
  lowGradeSources: boolean;
  keyNews: { headline: string; url: string; published: string; why_it_matters: string }[];
  guidance: { summary: string; tone: number; url: string | null };
  expectations: { summary: string; tone: number };
  resultDate: { date: string | null; basis: string; url: string | null; confirmed: boolean };
  companyRisks: DatedRisk[];
  sources: { url: string; title: string }[];
  sector: {
    name: string;
    runAt: string;
    outlook: string;
    outlookScore: number;
    exportImport: string;
    currencyCommodity: string;
    risks: DatedRisk[];
    sources: { url: string; title: string }[];
  } | null;
};

export type AiRun = {
  id: number;
  kind: "sector" | "stock";
  key: string;
  trigger: "weekly" | "manual";
  model: string | null;
  status: "running" | "ok" | "error" | "refused";
  started_at: string;
  duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  searches: number;
  cost_usd: number;
  error: string | null;
};

export type StockDetail = {
  row: StockRow;
  quarters: Quarter[];
  today: string;
  /** Backtests for this stock and, as a fallback for thin samples, its sector. */
  backtests: { stock: SignalStats[]; sector: SignalStats[] };
  external: ExternalRead | null;
  /** Recent macro events that name this stock's sector. */
  macro: SectorMacroItem[];
  /** Headlines from free feeds, newest first. Headline, publisher, time and link only. */
  news: NewsItem[];
  /** False when the paid AI jobs are switched off. */
  aiEnabled: boolean;
};

export type NewsItem = { id: number; title: string; source: string | null; url: string; publishedAt: string; tags: string[] };

export type JobRun = {
  id: number;
  job: string;
  status: "running" | "ok" | "partial" | "error" | "skipped";
  started_at: string;
  finished_at: string | null;
  ok_count: number;
  fail_count: number;
  detail: { failures?: { symbol: string; error: string }[]; reason?: string; remaining?: number } | null;
  error: string | null;
};

/** One reported quarter. Revenue and profit are in Rs crore. */
export type Quarter = {
  periodEnd: string;
  label: string; // e.g. "Q2 FY27"
  /** Set when the figures look out of line with the company's other quarters. Excluded from the event score. */
  checkData: string | null;
  revenue: number | null;
  profit: number | null;
  margin: number | null;
  revenueYoY: number | null;
  profitYoY: number | null;
  revenueQoQ: number | null;
  profitQoQ: number | null;
  resultDate: string | null;
  reaction1d: number | null;
  reaction5d: number | null;
  epsSurprisePct: number | null;
};

/** Backtest result for one holding period (Phase 3). */
export type BacktestWindow = {
  days: 5 | 20 | 60;
  samples: number;
  /** Percent of past cases that went the signal's way (up for bounce/trend, down for breakdown). */
  hitRate: number | null;
  avgReturn: number | null;
  /** The same measure for any day in the same history, for comparison. */
  baseline: number | null;
};

export type SignalStats = { kind: SignalKind; scope: "stock" | "sector" | "all"; scopeKey: string; windows: BacktestWindow[] };

/** Measured 20-session odds of the signal that is active now. */
export type SignalOdds = {
  signal: SignalKind;
  hitRate: number;
  avgReturn: number;
  samples: number;
  scope: "stock" | "sector" | "all";
  baseline: number | null;
};
