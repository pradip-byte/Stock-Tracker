/** Settings read from the environment, with defaults. */

/** Round-trip trading cost in percent (brokerage, taxes and slippage, entry plus exit). Used by the signal research and paper trades. */
export function tradeCostPct(): number {
  const v = Number(process.env.TRADE_COST_PCT);
  return Number.isFinite(v) && v >= 0 && v <= 5 ? v : 0.25;
}
