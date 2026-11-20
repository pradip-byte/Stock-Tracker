"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addStock, refreshQuotes, runEod, type JobResult } from "@/lib/jobs/core";
import { researchStock } from "@/lib/jobs/external";
import { requestClose, requestTrade } from "@/lib/jobs/paper";
import type { PaperHorizon } from "@/lib/paper";
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

/** Per-stock "Refresh" of the AI read. Ignores the weekly skip rule; reuses this week's sector note. */
export async function refreshExternalAction(symbol: string): Promise<{ ok: boolean; error?: string; score?: number; costUsd?: number }> {
  await requireUser();
  const res = await researchStock(symbol, "manual");
  revalidatePath("/", "layout");
  return res;
}

/** Open a paper trade of `amount` rupees. It fills at the next quote (or the next open), never at the price on screen. */
export async function paperBuyAction(symbol: string, horizon: PaperHorizon, amount: number): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const res = await requestTrade("mine", horizon, symbol, Number(amount));
  revalidatePath("/stocks");
  revalidatePath("/scoreboard");
  return { ok: res.ok, error: res.error };
}

/** Close an open paper trade at the next quote, or cancel one that has not filled yet. Only the user's own trades. */
export async function paperCloseAction(id: number): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const { data } = await adminDb().from("paper_trades").select("book").eq("id", id).maybeSingle();
  if (data?.book !== "mine") return { ok: false, error: "Trade not found." };
  const res = await requestClose(id, "manual");
  revalidatePath("/stocks");
  revalidatePath("/scoreboard");
  return res;
}
