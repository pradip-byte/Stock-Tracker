import type { Candle, Timeframe } from "./types";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder RSI */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      gain += g / period;
      loss += l / period;
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
    if (i >= period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const sig = ema(line, signalPeriod);
  const ready = (i: number) => i >= slow + signalPeriod - 2;
  return {
    macd: line.map((v, i) => (ready(i) ? v : null)),
    signal: sig.map((v, i) => (ready(i) ? v : null)),
    hist: line.map((v, i) => (ready(i) ? v - sig[i] : null)),
  };
}

export function atr(candles: Candle[], period = 14): number {
  const n = candles.length;
  if (n < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(1, n - period); i < n; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    count++;
  }
  return count ? sum / count : 0;
}

function weekKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** Resample daily candles to weekly or monthly bars. */
export function aggregate(daily: Candle[], tf: Timeframe): Candle[] {
  if (tf === "D") return daily;
  const out: Candle[] = [];
  let key = "";
  for (const c of daily) {
    const k = tf === "W" ? weekKey(c.time) : c.time.slice(0, 7);
    if (k !== key) {
      key = k;
      out.push({ ...c });
    } else {
      const b = out[out.length - 1];
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
    }
  }
  return out;
}
