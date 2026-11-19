import clsx from "clsx";
import type { ReactNode } from "react";
import { Rise, Stamp } from "../motion/primitives";
import type { Risk, Verdict } from "@/lib/types";

/** Metal card: brushed gradient, 1px top highlight, hover sheen. */
export function Card({
  title,
  right,
  children,
  className,
  bodyClassName,
  index = 0,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  index?: number;
}) {
  return (
    <Rise as="section" index={index} className={clsx("metal sheen flex flex-col rounded-md", className)}>
      {title && (
        <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3.5">
          <h2 className="label text-ink">{title}</h2>
          {right}
        </header>
      )}
      <div className={clsx("relative min-h-0 flex-1", bodyClassName ?? "p-3.5")}>{children}</div>
    </Rise>
  );
}

/** Honest placeholder for data a later phase will supply. Never shows invented numbers. */
export function Pending({ phase, what, className }: { phase: number; what: string; className?: string }) {
  return (
    <div
      className={clsx(
        "flex h-full min-h-24 flex-col items-start justify-center gap-1.5 rounded-sm border border-dashed border-line p-4",
        className,
      )}
    >
      <span className="label text-[10px] text-steel">Not available yet</span>
      <span className="text-[12.5px] leading-snug text-steel">
        {what} <span className="text-ink">Arrives in Phase {phase}.</span>
      </span>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  ...rest
}: { children: ReactNode; variant?: "primary" | "ghost" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={clsx(
        "label inline-flex h-8 items-center gap-2 rounded-sm px-3 transition-transform duration-150 ease-out active:scale-[0.97]",
        variant === "primary"
          ? "bg-amber text-night hover:bg-amber-hi"
          : "metal-raised text-ink hover:text-amber",
        rest.className,
      )}
    >
      {children}
    </button>
  );
}

const verdictStyle: Record<Verdict, string> = {
  Favourable: "border-amber bg-amber text-night",
  Neutral: "border-steel text-ink",
  Avoid: "border-dashed border-steel text-steel line-through decoration-1",
};

/** Small inline verdict tag for tables. Amber only when favourable. */
export function VerdictTag({ verdict }: { verdict: Verdict }) {
  return (
    <span className={clsx("label inline-block rounded-sm border px-1.5 py-1 text-[10px]", verdictStyle[verdict])}>
      {verdict}
    </span>
  );
}

/** Large verdict badge that stamps in. */
export function VerdictStamp({
  verdict,
  horizon,
  risk,
  delay,
}: {
  verdict: Verdict;
  horizon: string;
  risk?: Risk;
  delay?: number;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="label text-[10px] text-steel">{horizon}</span>
      <Stamp delay={delay}>
        <span
          className={clsx(
            "display inline-block rounded-sm border-2 px-3 py-2 text-3xl tracking-wide",
            verdictStyle[verdict],
          )}
        >
          {verdict}
        </span>
      </Stamp>
      {risk && (
        <span className="num text-[10px] uppercase tracking-wider text-steel">
          Risk <span className="text-ink">{risk}</span>
        </span>
      )}
    </div>
  );
}

export function SignalTag({ kind }: { kind: string | null }) {
  if (!kind) return <span className="num text-[11px] text-steel">none</span>;
  return (
    <span className="label inline-flex items-center gap-1.5 text-[11px] text-amber">
      <span className="inline-block size-1.5 rotate-45 bg-amber" />
      {kind}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label text-[10px] text-steel">{label}</span>
      {children}
    </div>
  );
}
