import YahooFinance from "yahoo-finance2";
import { istDateOf } from "../market";
import type { Candle } from "../types";
import type { MarketDataProvider, ProviderEarnings, ProviderFundamentals, ProviderQuote } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 700): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const NO_VALIDATE = { validateResult: false } as const;

export class YahooProvider implements MarketDataProvider {
  readonly name = "yahoo";
  private yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  toProviderSymbol(nseSymbol: string): string {
    return `${nseSymbol}.NS`;
  }

  async getQuotes(providerSymbols: string[]): Promise<ProviderQuote[]> {
    const out: ProviderQuote[] = [];
    for (let i = 0; i < providerSymbols.length; i += 50) {
      const batch = providerSymbols.slice(i, i + 50);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await withRetry(() => this.yf.quote(batch, {}, NO_VALIDATE) as Promise<any[]>);
      for (const q of rows ?? []) {
        const price = num(q?.regularMarketPrice);
        if (!q?.symbol || price == null) continue;
        const t = q.regularMarketTime;
        out.push({
          providerSymbol: q.symbol,
          price,
          prevClose: num(q.regularMarketPreviousClose),
          dayHigh: num(q.regularMarketDayHigh),
          dayLow: num(q.regularMarketDayLow),
          volume: num(q.regularMarketVolume),
          marketTime: t instanceof Date ? t.toISOString() : typeof t === "number" ? new Date(t * 1000).toISOString() : null,
          name: q.longName ?? q.shortName ?? null,
        });
      }
    }
    return out;
  }

  async getDailyHistory(providerSymbol: string, from: Date): Promise<Candle[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await withRetry(() =>
      this.yf.chart(providerSymbol, { period1: from, interval: "1d" }, NO_VALIDATE),
    );
    const byDate = new Map<string, Candle>();
    for (const q of res?.quotes ?? []) {
      const o = num(q.open), h = num(q.high), l = num(q.low), c = num(q.close);
      if (o == null || h == null || l == null || c == null || !q.date) continue; // holiday or empty bar
      const time = istDateOf(new Date(q.date));
      byDate.set(time, { time, open: o, high: h, low: l, close: c, volume: Math.round(num(q.volume) ?? 0) });
    }
    return [...byDate.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  async getFundamentals(providerSymbol: string): Promise<ProviderFundamentals> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await withRetry(() =>
      this.yf.quoteSummary(
        providerSymbol,
        { modules: ["assetProfile", "summaryDetail", "financialData"] },
        NO_VALIDATE,
      ),
    );
    const roe = num(s?.financialData?.returnOnEquity);
    const de = num(s?.financialData?.debtToEquity);
    return {
      pe: num(s?.summaryDetail?.trailingPE),
      roe: roe == null ? null : roe * 100,
      debtToEquity: de == null ? null : de / 100,
      sector: s?.assetProfile?.sector ?? null,
      industry: s?.assetProfile?.industry ?? null,
    };
  }

  async getEarnings(providerSymbol: string): Promise<ProviderEarnings> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await withRetry(() =>
      this.yf.quoteSummary(providerSymbol, { modules: ["calendarEvents", "earnings"] }, NO_VALIDATE),
    );
    const next = s?.calendarEvents?.earnings?.earningsDate?.[0];
    const nextDate = next ? new Date(next) : null;
    const future = nextDate && nextDate.getTime() > Date.now() - 86400000;
    return {
      nextResultDate: future ? istDateOf(nextDate!) : null,
      nextIsEstimate: Boolean(s?.calendarEvents?.earnings?.isEarningsDateEstimate),
      quarters: [],
    };
  }
}
