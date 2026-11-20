/**
 * Per-request query counter. A probe route runs a page's data loaders inside
 * `measure()`, and every Supabase HTTP call made meanwhile is counted and timed.
 * Outside a probe this adds nothing but one AsyncLocalStorage lookup per call.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Call = { what: string; ms: number };
type Store = { calls: Call[] };
const store = new AsyncLocalStorage<Store>();

export const probing = () => store.getStore() != null;

/** fetch wrapper handed to the Supabase clients. */
export const countingFetch: typeof fetch = async (input, init) => {
  const s = store.getStore();
  if (!s) return fetch(input, init);
  const started = performance.now();
  try {
    return await fetch(input, init);
  } finally {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    // table or endpoint only: no query values
    s.calls.push({ what: url.pathname.replace(/^\/(rest|auth)\/v1\//, ""), ms: Math.round(performance.now() - started) });
  }
};

export async function measure<T>(fn: () => Promise<T>): Promise<{ ms: number; queries: number; calls: Call[]; result: T }> {
  const s: Store = { calls: [] };
  const started = performance.now();
  const result = await store.run(s, fn);
  return { ms: Math.round(performance.now() - started), queries: s.calls.length, calls: s.calls, result };
}
