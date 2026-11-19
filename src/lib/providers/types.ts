import type { Candle } from "../types";

export type ProviderQuote = {
  providerSymbol: string;
  price: number;
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  marketTime: string | null; // ISO
  name: string | null;
};

export type ProviderFundamentals = {
  pe: number | null;
  roe: number | null;
  debtToEquity: number | null;
  sector: string | null;
  industry: string | null;
};

export type ProviderEarnings = {
  /** Next result date if the provider knows it. Never guessed. */
  nextResultDate: string | null;
  nextIsEstimate: boolean;
  quarters: { periodEnd: string; revenue: number | null; netProfit: number | null; eps: number | null }[];
};

/**
 * Everything the app needs from a market data source. YahooProvider is the
 * only implementation today; Upstox or Angel One can be added behind the same
 * interface and selected in providers/index.ts.
 */
export interface MarketDataProvider {
  readonly name: string;
  /** Map an NSE symbol (RELIANCE) to this provider's symbol (RELIANCE.NS). */
  toProviderSymbol(nseSymbol: string): string;
  getQuotes(providerSymbols: string[]): Promise<ProviderQuote[]>;
  /** Daily candles from `from` (inclusive) to now, oldest first, dates in IST. */
  getDailyHistory(providerSymbol: string, from: Date): Promise<Candle[]>;
  getFundamentals(providerSymbol: string): Promise<ProviderFundamentals>;
  getEarnings(providerSymbol: string): Promise<ProviderEarnings>;
}
