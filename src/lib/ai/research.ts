/**
 * One research call to Claude with the web search tool.
 *
 * - Web search is capped with `max_uses`, and called directly (no dynamic
 *   filtering) so the cap is enforced the same way on every search.
 * - The answer comes back as the input of a strict tool (`submit_research`),
 *   so it always matches the JSON schema.
 * - Every URL Claude saw in search results is collected; callers keep only
 *   links that appear in that set, so a made-up URL can never be stored.
 * - No Batch API and no prompt caching, by design: at this volume the saving
 *   is too small to justify the moving parts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { aiModel, emptyUsage, requestTokenCost, type AiUsage } from "./pricing";

export type SearchSource = { url: string; title: string; pageAge: string | null };

/** Sites the web search tool is told never to return: stock-tip aggregators and Wikipedia. Subdomains are covered. */
export const BLOCKED_DOMAINS = ["marketsmojo.com", "scanx.trade", "multibagg.ai", "ad-hoc-news.de", "wikipedia.org"];

export type ResearchResult =
  | { ok: true; data: Record<string, unknown>; sources: SearchSource[]; usage: AiUsage; model: string }
  | { ok: false; status: "error" | "refused"; error: string; sources: SearchSource[]; usage: AiUsage; model: string };

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  // A key that is not tied to one workspace must say which workspace to bill, via ANTHROPIC_WORKSPACE_ID.
  const workspace = (process.env.ANTHROPIC_WORKSPACE_ID ?? "").trim();
  client ??= new Anthropic({
    maxRetries: 2,
    timeout: 240_000,
    defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
  });
  return client;
}

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

function addUsage(total: AiUsage, model: string, u: Anthropic.Beta.BetaUsage) {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  total.inputTokens += u.input_tokens ?? 0;
  total.outputTokens += u.output_tokens ?? 0;
  total.cacheReadTokens += cacheRead;
  total.cacheWriteTokens += cacheWrite;
  total.searches += u.server_tool_use?.web_search_requests ?? 0;
  total.tokenCostUsd += requestTokenCost(model, (u.input_tokens ?? 0) + cacheRead + cacheWrite, u.output_tokens ?? 0);
}

export async function runResearch(opts: {
  system: string;
  prompt: string;
  /** JSON schema of the answer. Strict mode: every object needs `required` and additionalProperties:false. */
  schema: Record<string, unknown>;
  maxSearches: number;
}): Promise<ResearchResult> {
  const usage = emptyUsage();
  const sources: SearchSource[] = [];
  const requested = aiModel();
  let model = requested;
  // Server-side refusal fallback exists for the Sonnet 5.5 family but not for Haiku 5.5.
  const fallback: Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks"> = requested.startsWith("claude-sonnet-5-5")
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];

  try {
    // A long search turn can come back as pause_turn; resend it unchanged to let the server continue.
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await anthropic().beta.messages.create({
        model: requested,
        max_tokens: 16000,
        system: opts.system,
        messages,
        output_config: { effort: "medium" },
        ...fallback,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: opts.maxSearches,
            allowed_callers: ["direct"],
            blocked_domains: BLOCKED_DOMAINS,
            user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" },
          },
          {
            name: "submit_research",
            description: "Submit the final research result. Call this exactly once, after you have finished searching.",
            strict: true,
            input_schema: opts.schema as Anthropic.Beta.BetaTool.InputSchema,
          },
        ],
      });
      model = res.model;
      addUsage(usage, model, res.usage);

      for (const block of res.content) {
        // a successful search has a list of results; an error (for example max_uses_exceeded) has a single object
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r.type === "web_search_result") sources.push({ url: r.url, title: r.title, pageAge: r.page_age ?? null });
          }
        }
      }

      if (res.stop_reason === "refusal") {
        return { ok: false, status: "refused", error: `Declined by the model (${res.stop_details?.category ?? "no category"})`, sources, usage, model };
      }
      const submitted = res.content.find((b) => b.type === "tool_use" && b.name === "submit_research");
      if (submitted && submitted.type === "tool_use") {
        return { ok: true, data: submitted.input as Record<string, unknown>, sources, usage, model };
      }
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      return { ok: false, status: "error", error: `Model stopped (${res.stop_reason}) without submitting a result`, sources, usage, model };
    }
    return { ok: false, status: "error", error: "Search turn did not finish after three continuations", sources, usage, model };
  } catch (e) {
    let error = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.AuthenticationError) error = "Anthropic rejected the API key";
    else if (e instanceof Anthropic.RateLimitError) error = "Anthropic rate limit reached; try again later";
    else if (e instanceof Anthropic.APIConnectionError) error = `Could not reach Anthropic: ${error}`;
    else if (e instanceof Anthropic.BadRequestError && /not scoped to a workspace/i.test(error)) {
      error = "The Anthropic API key is not tied to a workspace. Set ANTHROPIC_WORKSPACE_ID, or use a key created inside a workspace.";
    } else if (e instanceof Anthropic.APIError) error = `Anthropic API error ${e.status}: ${error}`;
    return { ok: false, status: "error", error: error.slice(0, 400), sources, usage, model };
  }
}

/** Compare URLs loosely: ignore scheme, "www.", query string, fragment and a trailing slash. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return "";
  }
}

/** Returns the URL as it appeared in the search results, or null if Claude never saw it there. */
export function verifiedUrl(url: unknown, sources: SearchSource[]): string | null {
  if (typeof url !== "string" || !url) return null;
  const key = urlKey(url);
  if (!key) return null;
  return sources.find((s) => urlKey(s.url) === key)?.url ?? null;
}
