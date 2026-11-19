"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { useId } from "react";
import { dur, ease } from "../motion/tokens";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="metal-raised inline-flex rounded-sm p-0.5">
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={clsx(
            "label relative h-6 min-w-8 px-2 text-[11px]",
            o === value ? "text-night" : "text-steel hover:text-ink",
          )}
        >
          {o === value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-sm bg-amber"
              transition={{ duration: dur.sm, ease: ease.out }}
            />
          )}
          <span className="relative">{o}</span>
        </button>
      ))}
    </div>
  );
}
