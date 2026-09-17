"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * Every page opens the same way: a small monospace kicker, an oversized
 * wordmark with a blinking-cursor underscore, then a heavy rule. Defining it
 * once keeps the five pages from drifting apart.
 */
export function PageHeader({
  kicker,
  title,
  action,
}: {
  kicker: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono mb-1.5">{kicker}</p>
          <h1
            className="font-data text-3xl font-semibold"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.03em" }}
          >
            {title.toUpperCase()}
            <span style={{ color: "var(--accent-500)" }}>_</span>
          </h1>
        </div>
        {action && <div className="flex flex-wrap items-center gap-3">{action}</div>}
      </header>
      <hr className="rule-strong mb-6" />
    </>
  );
}

/**
 * The one box shape in this theme: hard 1px edge, flat surface, no radius, no
 * shadow. Its header is a monospace rule — label on the left, an optional
 * bracketed index on the right — which is what carries the terminal reading
 * while leaving the body free to stay quiet and legible.
 */
export function Panel({
  label,
  index,
  action,
  accent = false,
  padded = true,
  delay = 0,
  className = "",
  children,
}: {
  label?: string;
  index?: number | string;
  action?: ReactNode;
  accent?: boolean;
  padded?: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className={`panel ${accent ? "panel-accent" : ""} ${className}`}
    >
      {label && (
        <header
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--line-hairline)" }}
        >
          <div className="flex items-baseline gap-2">
            {index !== undefined && (
              <span className="index-mono label-mono" style={{ color: "var(--line-strong)" }}>
                {typeof index === "number" ? String(index).padStart(2, "0") : index}
              </span>
            )}
            <h2 className="label-mono" style={{ color: "var(--text-secondary)" }}>
              {label}
            </h2>
          </div>
          {action}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </motion.section>
  );
}

/**
 * A number presented as a graphic object rather than a table cell — the one
 * place this theme allows itself to be loud. `scale` picks the type size;
 * everything else (tabular figures, tight tracking) is fixed so columns of
 * these still line up.
 */
export function Figure({
  label,
  value,
  hint,
  scale = "md",
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  scale?: "sm" | "md" | "lg";
  tone?: "default" | "accent";
}) {
  const size = { sm: "text-2xl", md: "text-4xl", lg: "text-6xl" }[scale];

  return (
    <div>
      <p className="label-mono mb-2">{label}</p>
      <p
        className={`figure ${size} break-all`}
        style={{ color: tone === "accent" ? "var(--accent-500)" : "var(--text-primary)" }}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
