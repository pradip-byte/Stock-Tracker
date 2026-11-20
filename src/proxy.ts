import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Header the proxy sets on the request once the session is verified. Anything the browser sends under this name is discarded. */
const USER_HEADER = "x-st-user";

/**
 * Refreshes the Supabase session and keeps everything behind the single allowed account.
 * The session is verified with Supabase once here; pages then read the verified email
 * from a request header instead of asking Supabase a second time.
 */
export async function proxy(request: NextRequest) {
  request.headers.delete(USER_HEADER);
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
  const ok = Boolean(email && allowed && email === allowed);
  const path = request.nextUrl.pathname;

  if (!ok && path !== "/login") {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (ok && path === "/login") return NextResponse.redirect(new URL("/", request.url));
  if (!ok) return response;
  // forward the verified email, keeping any refreshed session cookies
  request.headers.set(USER_HEADER, email!);
  const verified = NextResponse.next({ request });
  for (const c of response.cookies.getAll()) verified.cookies.set(c);
  return verified;
}

export const config = {
  // cron routes authenticate with CRON_SECRET instead of a session
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|api/cron).*)"],
};
