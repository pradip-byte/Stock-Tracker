import type { MarketDataProvider } from "./types";
import { YahooProvider } from "./yahoo";

let provider: MarketDataProvider | null = null;

/** Swap the implementation here (Upstox, Angel One) without touching callers. */
export function getProvider(): MarketDataProvider {
  provider ??= new YahooProvider();
  return provider;
}

export type { MarketDataProvider } from "./types";
