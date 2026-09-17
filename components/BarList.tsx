"use client";

import { motion } from "framer-motion";

export interface BarListItem {
  key: string;
  label: string;
  /** Drives the bar length and the share percentage. */
  value: number;
  /** Shown under the bar on the left, e.g. a token count. */
  detail?: string;
  /** Shown under the bar on the right, e.g. a cost. */
  emphasis?: string;
  hue?: string;
}

/**
 * A horizontal bar list: label above, full-width bar, figures below.
 *
 * Panels on these pages are often four of twelve columns, where a charting
 * library's bar chart spends most of its width on a label gutter. Stacking the
 * label above its own bar uses the whole panel instead.
 */
export function BarList({ items, emptyLabel = "Nothing to show." }: { items: BarListItem[]; emptyLabel?: string }) {
  if (items.length === 0) {
    return <p className="label-mono">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((i) => i.value));
  const total = items.reduce((sum, i) => sum + i.value, 0);

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span
              className="font-data truncate text-xs"
              style={{ color: "var(--text-primary)" }}
              title={item.label}
            >
              {item.label}
            </span>
            <span className="font-data shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
              {total > 0 ? ((item.value / total) * 100).toFixed(1) : "0.0"}%
            </span>
          </div>

          <div className="h-2 w-full" style={{ background: "var(--surface-2)" }}>
            <motion.div
              className="h-full"
              style={{ background: item.hue ?? "var(--accent-500)" }}
              initial={{ width: 0 }}
              animate={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
              transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
            />
          </div>

          {(item.detail || item.emphasis) && (
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="font-data text-xs" style={{ color: "var(--text-secondary)" }}>
                {item.detail}
              </span>
              <span className="font-data text-xs" style={{ color: "var(--accent-500)" }}>
                {item.emphasis}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
