import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { probing } from "../perf";
import { adminDb } from "./admin";

/** Client bound to the signed-in user's cookies. RLS applies. */
export async function userDb() {
  // the timing probe has no session: it runs the same loaders with the service client
  if (probing()) return adminDb();
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}

export const allowedEmail = () => (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();

/**
 * Email of the signed-in user as verified by the proxy for this request, or null.
 * No network call: the proxy has already checked the session with Supabase and
 * overwrites this header on every request, so the browser cannot supply it.
 */
export async function sessionEmail(): Promise<string | null> {
  const email = (await headers()).get("x-st-user")?.toLowerCase() ?? null;
  if (email) return allowedEmail() && email === allowedEmail() ? email : null;
  // No header (a route the proxy does not cover, or the header did not arrive): check with Supabase directly.
  return (await currentUser())?.email?.toLowerCase() ?? null;
}

/** Guard for cached page data, which is read with the service client: only for a verified session. */
export async function assertSignedIn(): Promise<void> {
  if (probing()) return;
  if (!(await sessionEmail())) throw new Error("Not signed in");
}

/** Returns the signed-in user only if it is the single allowed account. */
export async function currentUser() {
  const db = await userDb();
  const { data } = await db.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email || !allowedEmail() || email !== allowedEmail()) return null;
  return data.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}
