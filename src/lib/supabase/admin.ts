import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { countingFetch } from "../perf";

let client: SupabaseClient | null = null;

/** Service-role client. Server, cron routes and local scripts only. Bypasses RLS. */
export function adminDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: countingFetch } });
  return client;
}
