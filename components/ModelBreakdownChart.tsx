"use client";

import { motion } from "framer-motion";
import { formatCompact, formatUsd, modelHue, shortModel } from "@/lib/format-usage";

interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}

const MAX_SERIES = 5;

function foldIntoOther(rows: ModelBreakdownRow[]): ModelBreakdownRow[] {
  // Models with no tokens (`<synthetic>` bookkeeping rows) would otherwise take
  // a full row to say nothing.
  const used = rows.filter((row) => row.totalTokens > 0);
  const sorted = [...used].sort((a, b) => b.totalTokens - a.totalTokens);
  if (sorted.length <= MAX_SERIES) return sorted;

  const head = sorted.slice(0, MAX_SERIES);
  const tail = sorted.slice(MAX_SERIES);
  return [
    ...head,
    {
      model: `Other (${tail.length})`,
      totalTokens: tail.reduce((sum, r) => sum + r.totalTokens, 0),
      costUsd: tail.reduce((sum, r) => sum + r.costUsd, 0),
    },
  ];
}

/**
 * A bar list rather than a charting-library bar chart.
 *
 * This panel is four of twelve columns wide. A vertical Tremor BarChart needs a
 * y-axis gutter wide enough for "claude-sonnet-5", which left under a third of
 * the panel for the bars themselves and pushed every bar hard against the right
 * edge. Laying the label above its own full-width bar uses the whole panel, and
 * leaves room to show cost beside tokens instead of tokens alone.
 */
export function ModelBreakdownChart({ data }: { data: ModelBreakdownRow[] }) {
  const rows = foldIntoOther(data);
  if (rows.length === 0) {
    return <p className="label-mono">No model usage in this range.</p>;
  }

  const maxTokens = Math.max(...rows.map((r) => r.totalTokens));
  const totalTokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const hue = row.model.startsWith("Other") ? "var(--text-muted)" : modelHue(row.model);
        const share = totalTokens > 0 ? (row.totalTokens / totalTokens) * 100 : 0;

        return (
          <div key={row.model}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span
                className="font-data truncate text-xs"
                style={{ color: "var(--text-primary)" }}
                title={row.model}
              >
                {shortModel(row.model)}
              </span>
              <span className="font-data shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                {share.toFixed(1)}%
              </span>
            </div>

            <div className="h-2 w-full" style={{ background: "var(--surface-2)" }}>
              <motion.div
                className="h-full"
                style={{ background: hue }}
                initial={{ width: 0 }}
                animate={{ width: `${maxTokens > 0 ? (row.totalTokens / maxTokens) * 100 : 0}%` }}
                transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
              />
            </div>

            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="font-data text-xs" style={{ color: "var(--text-secondary)" }}>
                {formatCompact(row.totalTokens)}
              </span>
              <span className="font-data text-xs" style={{ color: "var(--accent-500)" }}>
                {formatUsd(row.costUsd)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
