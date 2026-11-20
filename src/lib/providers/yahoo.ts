import YahooFinance from "yahoo-finance2";
import { istDateOf } from "../market";
import type { Candle } from "../types";
import type {
  MarketDataProvider,
  ProviderEarnings,
  ProviderFundamentals,
  ProviderQuarter,
  ProviderQuote,
} from "./types";

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
          dayOpen: num(q.regularMarketOpen),
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
        { modules: ["assetProfile", "summaryDetail", "financialData", "defaultKeyStatistics"] },
        NO_VALIDATE,
      ),
    );
    const roe = num(s?.financialData?.returnOnEquity);
    const de = num(s?.financialData?.debtToEquity); // Yahoo reports this as a percentage
    const margin = num(s?.financialData?.profitMargins);
    const fye = s?.defaultKeyStatistics?.lastFiscalYearEnd ?? s?.defaultKeyStatistics?.nextFiscalYearEnd;
    return {
      pe: num(s?.summaryDetail?.trailingPE),
      roe: roe == null ? null : roe * 100,
      debtToEquity: de == null ? null : de / 100,
      profitMargin: margin == null ? null : margin * 100,
      fiscalYearEndMonth: fye ? new Date(fye).getUTCMonth() + 1 : null,
      sector: s?.assetProfile?.sector ?? null,
      industry: s?.assetProfile?.industry ?? null,
      website: s?.assetProfile?.website ?? null,
    };
  }

  /**
   * Quarterly results and the next result date.
   * Yahoo carries only the last four or five quarters for NSE stocks, sometimes
   * with gaps, so quarters are merged from two of its feeds and anything it
   * does not have stays null.
   */
  async getEarnings(providerSymbol: string): Promise<ProviderEarnings> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await withRetry(() =>
      this.yf.quoteSummary(providerSymbol, { modules: ["calendarEvents", "earnings"] }, NO_VALIDATE),
    );
    const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);
    type Fin = { revenue: number | null; netProfit: number | null; eps: number | null };

    // Feed A: income statement time series, keyed by period end
    const series = new Map<string, Fin>();
    try {
      const from = new Date();
      from.setUTCFullYear(from.getUTCFullYear() - 3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await withRetry(
        () =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.yf as any).fundamentalsTimeSeries(
            providerSymbol,
            { period1: from, type: "quarterly", module: "financials" },
            NO_VALIDATE,
          ),
        2,
      );
      for (const r of rows ?? []) {
        const pe = day(r?.date);
        const revenue = num(r?.totalRevenue) ?? num(r?.operatingRevenue);
        const netProfit = num(r?.netIncome) ?? num(r?.netIncomeCommonStockholders);
        if (!pe || (revenue == null && netProfit == null)) continue;
        series.set(pe, { revenue, netProfit, eps: num(r?.dilutedEPS) ?? num(r?.basicEPS) });
      }
    } catch {
      // the summary feed below still gives the latest four quarters
    }

    // Feed B: earnings summary (latest four quarters), which also carries the announcement time
    const byQuarter = new Map<string, { revenue: number | null; earnings: number | null }>();
    for (const f of s?.earnings?.financialsChart?.quarterly ?? []) {
      // a zero here is Yahoo's "missing", not a real zero
      if (f?.date) byQuarter.set(String(f.date), { revenue: num(f.revenue) || null, earnings: num(f.earnings) || null });
    }
    const summary = new Map<string, Fin>();
    const meta = new Map<string, { reportedAt: string | null; epsEstimate: number | null; epsActual: number | null }>();
    for (const e of s?.earnings?.earningsChart?.quarterly ?? []) {
      const pe = day(e?.periodEndDate);
      if (!pe) continue;
      meta.set(pe, {
        reportedAt: e.reportedDate ? new Date(e.reportedDate).toISOString() : null,
        epsEstimate: num(e.estimate),
        epsActual: num(e.actual),
      });
      const f = byQuarter.get(String(e.calendarQuarter ?? e.date));
      if (f && (f.revenue != null || f.earnings != null)) {
        summary.set(pe, { revenue: f.revenue, netProfit: f.earnings, eps: num(e.actual) });
      }
    }

    // The two feeds can define revenue differently (banks especially), so they are
    // only combined when they agree on every quarter they share. Otherwise the feed
    // with more quarters is used alone, which keeps growth and margins comparable.
    const shared = [...series.keys()].filter((k) => summary.has(k));
    const agree =
      shared.length > 0 &&
      shared.every((k) => {
        const a = series.get(k)!.revenue;
        const b = summary.get(k)!.revenue;
        return a == null || b == null || Math.abs(a - b) <= Math.abs(b) * 0.05;
      });
    const primary = summary.size >= series.size ? summary : series;
    const secondary = primary === summary ? series : summary;
    const fin = new Map(primary);
    if (agree) for (const [k, v] of secondary) if (!fin.has(k)) fin.set(k, v);

    const quarters = new Map<string, ProviderQuarter>();
    for (const k of new Set([...fin.keys(), ...meta.keys()])) {
      const f = fin.get(k);
      const m = meta.get(k);
      quarters.set(k, {
        periodEnd: k,
        revenue: f?.revenue ?? null,
        netProfit: f?.netProfit ?? null,
        eps: f?.eps ?? m?.epsActual ?? null,
        epsEstimate: m?.epsEstimate ?? null,
        reportedAt: m?.reportedAt ?? null,
      });
    }

    const cal = s?.calendarEvents?.earnings;
    const dates: Date[] = (cal?.earningsDate ?? []).map((d: string) => new Date(d));
    const today = istDateOf(new Date());
    const next = dates.map(istDateOf).filter((d) => d >= today).sort()[0] ?? null;
    return {
      nextResultDate: next,
      // two dates means Yahoo is giving a window rather than a confirmed day
      nextIsEstimate: Boolean(cal?.isEarningsDateEstimate) || dates.length > 1,
      source: "Yahoo",
      quarters: [...quarters.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)),
    };
  }
}
