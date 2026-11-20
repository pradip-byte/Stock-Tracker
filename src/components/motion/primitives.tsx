"use client";

import clsx from "clsx";
import { MotionConfig } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { seq } from "./tokens";

/** Respects prefers-reduced-motion for every Motion animation in the tree. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

type Segment = { text: string; accent?: boolean };
const ms = (seconds: number) => `${Math.round(seconds * 1000)}ms`;
const delayVar = (seconds: number) => ({ "--d": ms(seconds) }) as CSSProperties;

/**
 * Kinetic headline: types in character by character.
 * A CSS animation, so the text appears from the first paint without waiting for
 * JavaScript. The whole headline is in within about half a second however long it is.
 */
export function TypeIn({
  segments,
  className,
  delay = seq.headline,
  as: Tag = "h1",
}: {
  segments: Segment[];
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "p";
}) {
  const full = segments.map((s) => s.text).join("");
  const step = Math.min(0.018, 0.42 / Math.max(1, full.replace(/ /g, "").length));
  let i = 0;
  return (
    <Tag className={className} aria-label={full}>
      {segments.map((seg, si) => (
        <span key={si} aria-hidden className={clsx(seg.accent && "text-amber")}>
          {seg.text.split(/( +)/).map((word, wi) =>
            /^ +$/.test(word) ? (
              <span key={wi}>{word}</span>
            ) : (
              <span key={wi} className="inline-block whitespace-nowrap">
                {word.split("").map((ch, ci) => (
                  <span key={ci} className="type-in" style={delayVar(delay + i++ * step)}>
                    {ch}
                  </span>
                ))}
              </span>
            ),
          )}
        </span>
      ))}
    </Tag>
  );
}

/**
 * Cards rise in with stagger. `index` sets the position in the sequence.
 * A CSS animation on the server-rendered element, so the card is visible from
 * the first paint and does not wait for the page to hydrate.
 */
export function Rise({
  children,
  index = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag className={clsx("rise-in", className)} style={delayVar(seq.cards + Math.min(index, 12) * seq.cardStagger)}>
      {children}
    </Tag>
  );
}

/** Verdict badge stamps in: overshoot scale and a slight rotation. CSS, so the verdict is readable without waiting for JavaScript. */
export function Stamp({
  children,
  delay = seq.charts,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={clsx("stamp-in", className)} style={delayVar(delay)}>
      {children}
    </div>
  );
}
