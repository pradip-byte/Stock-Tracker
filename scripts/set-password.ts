/**
 * Creates the single sign-in account (ALLOWED_EMAIL) or resets its password.
 * The password is typed at a hidden prompt and goes only to Supabase Auth.
 */
import { createInterface } from "node:readline";
import "./env";
import { need } from "./env";
import { adminDb } from "../src/lib/supabase/admin";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rl as any)._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const email = need("ALLOWED_EMAIL").trim().toLowerCase();
  const db = adminDb();
  const password = process.env.APP_PASSWORD ?? (await askHidden(`New password for ${email}: `));
  if (password.length < 10) throw new Error("Use at least 10 characters.");

  await db.from("allowed_users").upsert({ email }, { onConflict: "email" });
  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(error.message);
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);
  const res = existing
    ? await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
    : await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (res.error) throw new Error(res.error.message);
  console.log(existing ? "Password updated." : "Account created.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
