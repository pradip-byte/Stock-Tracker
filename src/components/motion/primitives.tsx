"use client";

import clsx from "clsx";
import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";
import { dur, ease, seq, stampSpring } from "./tokens";

/** Respects prefers-reduced-motion for every Motion animation in the tree. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

type Segment = { text: string; accent?: boolean };

/** Kinetic headline: types in character by character. */
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
                {word.split("").map((ch, ci) => {
                  const n = i++;
                  return (
                    <motion.span
                      key={ci}
                      className="inline-block"
                      initial={{ opacity: 0, y: "0.35em" }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: dur.sm, ease: ease.out, delay: delay + n * 0.018 }}
                    >
                      {ch}
                    </motion.span>
                  );
                })}
              </span>
            ),
          )}
        </span>
      ))}
    </Tag>
  );
}

/** Cards rise in with stagger. `index` sets the position in the sequence. */
export function Rise({
  children,
  index = 0,
  className,
  as = "div",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.md, ease: ease.out, delay: seq.cards + index * seq.cardStagger }}
    >
      {children}
    </Tag>
  );
}

/** Verdict badge stamps in: overshoot scale and a slight rotation. */
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
    <motion.div
      className={clsx("inline-block origin-center", className)}
      initial={{ opacity: 0, scale: 1.9, rotate: -9 }}
      animate={{ opacity: 1, scale: 1, rotate: -2 }}
      transition={{ ...stampSpring, delay, opacity: { duration: dur.xs, delay } }}
    >
      {children}
    </motion.div>
  );
}
