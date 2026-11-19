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
  // Filled by later phases
  external: number | null;
  overall: number | null;
  shortVerdict: Verdict | null;
  longVerdict: Verdict | null;
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
  shortSetups: string[];
  longCandidates: string[];
  highRisk: string[];
  sectors: SectorGroup[];
  counts: { tracked: number; pending: number; bounce: number; trend: number; breakdown: number };
};

export type StockDetail = { row: StockRow; candles: Candle[]; quarters: Quarter[]; today: string };

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
export type BacktestWindow = { days: 5 | 20 | 60; hitRate: number; avgReturn: number };
