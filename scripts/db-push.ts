/**
 * Applies supabase/migrations to the database in DATABASE_URL.
 * The URL is passed straight to the CLI process, never through a shell and never printed.
 */
import { spawnSync } from "node:child_process";
import { need } from "./env";

/** Percent-encode the password if it holds characters a URL cannot carry raw. Already-encoded passwords are left alone. */
function normalise(raw: string): string {
  const m = raw.trim().match(/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/);
  if (!m) return raw.trim();
  const [, scheme, user, pw, rest] = m;
  const encoded = /^(?:[A-Za-z0-9\-._~]|%[0-9A-Fa-f]{2})*$/.test(pw) ? pw : encodeURIComponent(pw);
  return `${scheme}${user}:${encoded}@${rest}`;
}

const url = normalise(need("DATABASE_URL"));
if (/\[YOUR[-_ ]?(DATABASE[-_ ]?)?PASSWORD\]/i.test(url)) {
  console.error("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Put the real database password in .env.local.");
  process.exit(1);
}
const r = spawnSync("npx", ["supabase", "db", "push", "--db-url", url, "--yes"], { encoding: "utf8" });
const scrub = (s: string) => s.split(url).join("[db-url]").replace(/postgres(ql)?:\/\/\S+/g, "[db-url]");
process.stdout.write(scrub(r.stdout ?? ""));
process.stderr.write(scrub(r.stderr ?? ""));
process.exit(r.status ?? 1);
