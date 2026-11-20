"use client";

import clsx from "clsx";
import { pct, shortDate } from "@/lib/format";
import type { SectorMacroItem } from "@/lib/macro";
import { Card } from "../ui/core";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const tone = (v: number | null) => (v == null || v === 0 ? "text-steel" : v > 0 ? "text-gain" : "text-loss");

/** Recent macro events that the weekly note links to this stock's sector, with the sector's measured move afterwards. */
export function MacroItems({ sector, items, index }: { sector: string | null; items: SectorMacroItem[]; index: number }) {
  return (
    <Card index={index} className="col-span-12" title={`Macro items for ${sector ?? "this sector"}`}>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-steel">No macro event in the last 45 days names this sector.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          {items.map(({ event: e, effect, why, move }) => (
            <li key={e.id} className="border-t border-line/70 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className={clsx("label text-[10px]", effect === "helps" ? "text-amber" : "text-ink")}>
                  {effect === "sensitive" ? "sector usually sensitive" : `${effect} the sector`}
                </span>
                <span className="num text-[10px] text-steel">
                  {e.category} / {shortDate(e.eventDate)}
                </span>
                <a href={e.url} target="_blank" rel="noreferrer noopener" className="num text-[10px] text-steel underline decoration-line underline-offset-2 hover:text-amber">
                  {host(e.url)}
                </a>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug text-ink">{e.title}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-steel">{why}</p>
              <p className="num mt-1 text-[10px] text-steel">
                Sector after ({move?.stocks ?? 0} stocks): 1 session{" "}
                <span className={tone(move?.d1 ?? null)}>{move?.d1 == null ? "not yet" : pct(move.d1, 1)}</span>, 5{" "}
                <span className={tone(move?.d5 ?? null)}>{move?.d5 == null ? "not yet" : pct(move.d5, 1)}</span>, 20{" "}
                <span className={tone(move?.d20 ?? null)}>{move?.d20 == null ? "not yet" : pct(move.d20, 1)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-snug text-steel">
        Events come from keyword-tagged market headlines (and a few older AI notes). &quot;Usually sensitive&quot; is a fixed rule of thumb with no
        direction implied; the figures are what our stocks in the sector actually did afterwards. Learning only, not advice.
      </p>
    </Card>
  );
}
