"use client";

import { useState } from "react";
import { AreaChart } from "@tremor/react";

interface TimeSeriesPoint {
  bucketStart: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface ChartRow {
  bucketStart: string;
  Input: number;
  Output: number;
  "Cache read": number;
  "Cache write": number;
}

const CATEGORIES = ["Input", "Output", "Cache read", "Cache write"];
// Categorical set chosen for a near-black ground: each is a Tailwind 400
// shade, all clear 4.5:1 on the panel surface, and the hues stay separable
// for the common red/green colour deficiencies.
const COLORS = ["lime", "cyan", "orange", "violet"];
const LEGEND_SWATCHES = ["#a3e635", "#22d3ee", "#fb923c", "#a78bfa"];

type StackMode = "absolute" | "percentage";

function toChartRows(data: TimeSeriesPoint[], mode: StackMode): ChartRow[] {
  return data.map((point) => {
    const total = point.input_tokens + point.output_tokens + point.cache_creation_input_tokens + point.cache_read_input_tokens;
    const scale = mode === "percentage" && total > 0 ? 100 / total : 1;
    return {
      bucketStart: point.bucketStart,
      Input: point.input_tokens * scale,
      Output: point.output_tokens * scale,
      "Cache read": point.cache_read_input_tokens * scale,
      "Cache write": point.cache_creation_input_tokens * scale,
    };
  });
}

export function UsageTimeSeriesChart({ data }: { data: TimeSeriesPoint[] }) {
  const [mode, setMode] = useState<StackMode>("absolute");
  const chartData = toChartRows(data, mode);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {CATEGORIES.map((category, i) => (
            <span key={category} className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: LEGEND_SWATCHES[i] }}
              />
              {category}
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setMode("absolute")}
            className="rounded px-2 py-1"
            style={
              mode === "absolute"
                ? { background: "var(--surface-0)", fontWeight: 500, color: "var(--text-primary)", border: "1px solid var(--line-hairline)" }
                : { color: "var(--text-muted)" }
            }
          >
            Stacked
          </button>
          <button
            onClick={() => setMode("percentage")}
            className="rounded px-2 py-1"
            style={
              mode === "percentage"
                ? { background: "var(--surface-0)", fontWeight: 500, color: "var(--text-primary)", border: "1px solid var(--line-hairline)" }
                : { color: "var(--text-muted)" }
            }
          >
            100% Stacked
          </button>
        </div>
      </div>
      <AreaChart
        data={chartData}
        index="bucketStart"
        categories={CATEGORIES}
        colors={COLORS}
        stack
        showGradient
        showLegend={false}
        curveType="monotone"
        valueFormatter={(v) => (mode === "percentage" ? `${Math.round(v)}%` : Math.round(v).toLocaleString())}
        yAxisWidth={56}
        className="h-72"
      />
    </div>
  );
}
