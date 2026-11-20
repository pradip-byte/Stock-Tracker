/**
 * Renders the Phase 5 components to static HTML with small fixtures and checks
 * for the text each one must show. A smoke test for when the pages cannot be
 * opened in a signed-in browser.
 *   npx tsx scripts/smoke-render.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MacroPanel } from "../src/components/dashboard/MacroPanel";
import { ScoreboardView } from "../src/components/scoreboard/ScoreboardView";
import { MacroItems } from "../src/components/stock/MacroItems";
import { EntryTag } from "../src/components/ui/core";
import type { Scoreboard } from "../src/lib/data";
import { regimeOf, type MacroEvent, type MacroView } from "../src/lib/macro";
import { breakdown, summarise, type MarkedTrade, type PaperTrade } from "../src/lib/paper";

const event: MacroEvent = {
  id: 1,
  eventDate: "2026-11-17",
  title: "Brent crude slides",
  category: "Crude oil",
  summary: "Supply surplus expected.",
  url: "https://www.business-standard.com/x",
  published: "2026-11-18",
  helped: [{ sector: "Services", why: "Lower fuel costs for airlines." }],
  hurt: [{ sector: "Oil Gas & Consumable Fuels", why: "Lower realisations upstream." }],
  nifty: { d1: 0.38, d5: null, d20: null },
  sectorMoves: { Services: { d1: 1.28, d5: null, d20: null, stocks: 4 } },
};
const read = regimeOf({ nifty: 25514, niftySma200: 23996, breadth200: 55, vix: 16.1, vixSma20: 16.1 })!;
const macro: MacroView = {
  date: "2026-11-19",
  regime: read.regime,
  score: read.score,
  inputs: read.inputs,
  breadth50: 67.7,
  breadth200: 55,
  breadthCount: 200,
  series: [
    { id: "NIFTY50", label: "Nifty 50", unit: "", point: { value: 25514.3, date: "2026-11-19", chg1: 1.1, chg20: -0.4 } },
    { id: "US10Y", label: "US 10-year yield", unit: "%", point: { value: 5.052, date: "2026-11-18", chg1: null, chg20: 2 } },
    { id: "BRENT", label: "Brent crude", unit: "$", point: null },
  ],
  note: { runAt: "2026-11-20T06:29:00Z", summary: "Crude and flows drive the week.", lowGrade: true, flows: { fii: "+94,963 crore", dii: "", period: "November to date", url: "https://www.business-standard.com/y" } },
  events: [event],
};

const trade = (id: number, over: Partial<PaperTrade>): PaperTrade => ({
  id, book: "mine", horizon: "ST", symbol: "INFY", status: "closed", amount: 25000, requestedAt: "2026-11-20T06:00:00Z", fillRule: "quote",
  entryAt: "2026-11-20T06:19:00Z", entryPrice: 1111.5, qty: 22.49, niftyEntry: 25563, target: 1178, stop: 1078, maxSessions: 20, closeRequestedAt: null,
  exitAt: null, exitPrice: null, exitReason: null, niftyExit: null, costPct: 0.25, pnlInr: null, pnlPct: null, flag: null,
  context: { signal: "Trend", entryRating: "Good entry", marketUp: true }, ...over,
});
const marked: MarkedTrade[] = [
  { trade: trade(1, { exitPrice: 1178, exitReason: "target", exitAt: "2026-11-25T10:00:00Z" }), pnlInr: 1430, pnlPct: 5.72, niftyInr: 210, closed: true },
  { trade: trade(2, { symbol: "TCS", exitPrice: 2330, exitReason: "stop" }), pnlInr: -820, pnlPct: -3.28, niftyInr: -40, closed: true },
  { trade: trade(3, { symbol: "SBIN", horizon: "LT", status: "open", target: null, stop: null, flag: "Long-term verdict is now Avoid", context: { regime: "Risk-off" } }), pnlInr: 300, pnlPct: 1.2, niftyInr: null, closed: false },
];
const board = (book: "mine" | "shadow", m: MarkedTrade[]): Scoreboard => ({
  book,
  overall: summarise("All trades", m),
  byHorizon: breakdown(m, (t) => (t.horizon === "ST" ? "Short term" : "Long term")),
  bySignal: breakdown(m, (t) => t.context.signal ?? "No signal"),
  byEntry: breakdown(m, (t) => t.context.entryRating ?? "Unknown"),
  byRegime: breakdown(m, (t) => t.context.regime ?? "Nifty above 200 DMA"),
  recent: m,
  pending: 1,
});

const checks: [string, string, string[]][] = [
  ["MacroPanel", renderToStaticMarkup(<MacroPanel macro={macro} />), ["Neutral", "Nifty 50 vs 200 DMA", "Low-grade sources", "Brent crude slides", "not yet", "+94,963 crore", "5.05%", "no data"]],
  ["MacroPanel (empty)", renderToStaticMarkup(<MacroPanel macro={{ ...macro, regime: null, inputs: [], note: null, events: [] }} />), ["No regime read yet", "has not run yet"]],
  ["MacroItems", renderToStaticMarkup(<MacroItems sector="Services" index={0} items={[{ event, effect: "helps", why: "Lower fuel costs.", move: event.sectorMoves.Services }]} />), ["helps the sector", "Lower fuel costs.", "4 stocks"]],
  ["MacroItems (empty)", renderToStaticMarkup(<MacroItems sector="Realty" index={0} items={[]} />), ["No macro event in the last 45 days"]],
  ["Scoreboard", renderToStaticMarkup(<ScoreboardView boards={[board("mine", marked), board("shadow", [])]} quotesAt="2026-11-20T06:19:00Z" />), ["My paper trades", "Shadow portfolio", "Too few trades to judge", "50%", "closed: target", "Long-term verdict is now Avoid", "No trades have filled yet", "Risk-off"]],
  ["EntryTag", renderToStaticMarkup(<EntryTag rating="Wait for pullback" />) + renderToStaticMarkup(<EntryTag rating="Extended, don't chase" full />), ["Wait", "Extended, don&#x27;t chase"]],
];
let failed = 0;
for (const [name, html, needles] of checks) {
  const missing = needles.filter((n) => !html.includes(n));
  if (missing.length) failed++;
  console.log(`${missing.length ? "FAIL" : "ok  "} ${name.padEnd(20)} ${html.length} chars${missing.length ? ` | missing: ${missing.join(" | ")}` : ""}`);
}
process.exit(failed ? 1 : 0);
