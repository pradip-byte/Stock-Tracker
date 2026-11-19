"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addStock, refreshQuotes, runEod, type JobResult } from "@/lib/jobs/core";
import { adminDb } from "@/lib/supabase/admin";
import { allowedEmail, requireUser, userDb } from "@/lib/supabase/server";

export async function signIn(_prev: { error: string } | null, form: FormData): Promise<{ error: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // same message for every failure so the form does not reveal which email is allowed
  const fail = { error: "Those details did not match." };
  if (!email || !password || email !== allowedEmail()) return fail;
  const db = await userDb();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return fail;
  redirect("/");
}

export async function signOut() {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/login");
}

export async function addStockAction(symbol: string) {
  await requireUser();
  const res = await addStock(symbol);
  revalidatePath("/", "layout");
  return res;
}

export async function removeStockAction(symbol: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  // candles, quotes, indicators and scores go with it (on delete cascade)
  const { error } = await adminDb().from("stocks").delete().eq("symbol", symbol).eq("kind", "equity");
  revalidatePath("/", "layout");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setWatchlistAction(symbol: string, value: boolean): Promise<{ ok: boolean }> {
  await requireUser();
  const { error } = await adminDb().from("stocks").update({ in_watchlist: value }).eq("symbol", symbol);
  revalidatePath("/", "layout");
  return { ok: !error };
}

export async function runJobAction(job: "quotes" | "eod"): Promise<JobResult> {
  await requireUser();
  const res = job === "quotes" ? await refreshQuotes({ force: true }) : await runEod({ force: true, budgetMs: 40000 });
  revalidatePath("/", "layout");
  return res;
}
