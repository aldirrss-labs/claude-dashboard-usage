"use client";

import { useState } from "react";
import { AreaChart } from "@tremor/react";
import { formatCompact, formatUsd } from "@/lib/format-usage";

export interface ProjectDailyPoint {
  date: string;
  tokens: number;
  costUsd: number;
}

/**
 * Daily spend for one project.
 *
 * This replaces a bar chart of tokens per session, which plotted opaque
 * eight-character session ids along the x-axis in no meaningful order — it
 * could not answer "is this project getting more expensive", which is the
 * question a project page exists to answer. Cost leads because that is the
 * number that matters; tokens are a click away.
 */
export function ProjectCostChart({ data }: { data: ProjectDailyPoint[] }) {
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");

  if (data.length === 0) {
    return <p className="label-mono">No activity in this range.</p>;
  }

  const rows = data.map((point) => ({
    date: point.date,
    [metric === "cost" ? "Cost" : "Tokens"]: metric === "cost" ? point.costUsd : point.tokens,
  }));

  const total = data.reduce((sum, p) => sum + (metric === "cost" ? p.costUsd : p.tokens), 0);
  const peak = data.reduce((best, p) => ((metric === "cost" ? p.costUsd : p.tokens) > (metric === "cost" ? best.costUsd : best.tokens) ? p : best), data[0]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-4">
          <span className="label-mono">
            {data.length} active {data.length === 1 ? "day" : "days"}
          </span>
          <span className="font-data text-xs" style={{ color: "var(--text-secondary)" }}>
            peak {peak.date} ·{" "}
            <span style={{ color: "var(--accent-500)" }}>
              {metric === "cost" ? formatUsd(peak.costUsd) : formatCompact(peak.tokens)}
            </span>
          </span>
          <span className="font-data text-xs" style={{ color: "var(--text-secondary)" }}>
            avg/day{" "}
            <span style={{ color: "var(--accent-500)" }}>
              {metric === "cost" ? formatUsd(total / data.length) : formatCompact(total / data.length)}
            </span>
          </span>
        </div>

        <div className="flex gap-1">
          {(["cost", "tokens"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setMetric(option)}
              className="label-mono px-2 py-1"
              style={
                metric === option
                  ? { background: "var(--surface-0)", color: "var(--text-primary)", border: "1px solid var(--line-hairline)" }
                  : { color: "var(--text-muted)", border: "1px solid transparent" }
              }
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <AreaChart
        data={rows}
        index="date"
        categories={[metric === "cost" ? "Cost" : "Tokens"]}
        colors={["lime"]}
        showGradient
        showLegend={false}
        curveType="monotone"
        valueFormatter={(v) => (metric === "cost" ? formatUsd(v) : formatCompact(v))}
        yAxisWidth={72}
        className="h-64"
      />
    </div>
  );
}
