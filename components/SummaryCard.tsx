"use client";

import { motion } from "framer-motion";
import { AnimatedNumber } from "./AnimatedNumber";

interface SummaryCardProps {
  label: string;
  value: number;
  formatter?: (n: number) => string;
  hint?: string;
}

export function SummaryCard({ label, value, formatter, hint }: SummaryCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl p-5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}
    >
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
        <AnimatedNumber value={value} formatter={formatter} />
      </div>
      {hint && (
        <div className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </div>
      )}
    </motion.div>
  );
}
