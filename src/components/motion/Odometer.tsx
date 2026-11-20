"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { dur, ease } from "./tokens";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ d, delay }: { d: number; delay: number; rollIn?: boolean }) {
  return (
    <span aria-hidden className="relative inline-block">
      {/* in-flow ghost keeps width and baseline */}
      <span className="invisible">0</span>
      <motion.span
        className="absolute left-0 top-0 flex w-full flex-col items-center"
        // Always start on the real digit. Rolling up from zero on load meant the server-rendered
        // page showed 0000.00 until JavaScript arrived, which is a wrong number on screen.
        initial={false}
        animate={{ y: `${-d * 10}%` }}
        transition={{ duration: dur.lg, ease: ease.out, delay }}
      >
        {DIGITS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * Odometer-style rolling number. Each digit is a strip that translates
 * vertically; a brief green or red wash flashes behind it on change.
 */
export function Odometer({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  signed = false,
  flash = true,
  rollIn = false,
  delay = 0,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  signed?: boolean;
  flash?: boolean;
  rollIn?: boolean;
  delay?: number;
  className?: string;
}) {
  const prev = useRef(value);
  const [wash, setWash] = useState<{ up: boolean; key: number } | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    const up = value > prev.current;
    prev.current = value;
    if (flash) setWash((w) => ({ up, key: (w?.key ?? 0) + 1 }));
  }, [value, flash]);

  const body = Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = value < 0 ? "−" : signed ? "+" : "";
  const text = `${sign}${prefix}${body}${suffix}`;
  const chars = text.split("");

  return (
    <span
      className={clsx("relative inline-flex items-baseline overflow-hidden leading-[1.15]", className)}
      style={{ fontVariantNumeric: "tabular-nums" }}
      aria-label={text}
      role="text"
    >
      {wash && (
        <span
          key={wash.key}
          aria-hidden
          className={clsx("absolute inset-0 animate-flash rounded-sm", wash.up ? "bg-gain" : "bg-loss")}
        />
      )}
      {chars.map((ch, i) => {
        const key = chars.length - i; // key from the right so digits keep their column
        return /\d/.test(ch) ? (
          <Digit key={key} d={+ch} delay={rollIn ? delay : 0} rollIn={rollIn} />
        ) : (
          <span key={`${key}${ch}`} aria-hidden>
            {ch}
          </span>
        );
      })}
    </span>
  );
}
