/**
 * Model choice and the list prices used to ESTIMATE spend on the admin page.
 * Source: platform.claude.com/docs/en/about-claude/pricing (checked 19 Nov 2026).
 * The Anthropic Console is the source of truth for the actual bill.
 */
export const DEFAULT_AI_MODEL = "claude-haiku-5-5";

/** Set EXTERNAL_SIGNALS_MODEL in the environment to change the model. */
export const aiModel = () => (process.env.EXTERNAL_SIGNALS_MODEL ?? "").trim() || DEFAULT_AI_MODEL;

type Rate = { input: number; output: number };
/** USD per million tokens. `long` applies to a request whose prompt is over 100K tokens, where the model has a second rate card. */
const PER_MTOK: Record<string, { base: Rate; long?: Rate }> = {
  "claude-haiku-5-5": { base: { input: 0.1, output: 0.5 }, long: { input: 0.5, output: 2.5 } },
  "claude-sonnet-5-5": { base: { input: 2, output: 10 } },
  "claude-sonnet-5": { base: { input: 2, output: 10 } },
  "claude-opus-5-5": { base: { input: 4, output: 20 } },
};

/** Web search is billed per search on top of tokens: $10 per 1,000. */
export const USD_PER_SEARCH = 0.01;

export const priceLabel = (model: string) => {
  const p = PER_MTOK[model]?.base;
  return p ? `$${p.input} / $${p.output} per million tokens in / out` : "unknown model: priced as " + DEFAULT_AI_MODEL;
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  searches: number;
  /** Token cost in USD, summed request by request (a search turn can span several requests). */
  tokenCostUsd: number;
};

export const emptyUsage = (): AiUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0, tokenCostUsd: 0 });

/** Token cost of one API request. Prompt caching is not used, so cache tokens are priced as plain input if they ever appear. */
export function requestTokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const card = PER_MTOK[model] ?? PER_MTOK[DEFAULT_AI_MODEL];
  const rate = card.long && inputTokens > 100_000 ? card.long : card.base;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
}

export function estimateCost(u: AiUsage): number {
  return Math.round((u.tokenCostUsd + u.searches * USD_PER_SEARCH) * 1e5) / 1e5;
}
