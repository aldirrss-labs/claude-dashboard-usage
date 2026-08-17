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
const COLORS = ["blue", "orange", "emerald", "amber"];

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
      <div className="mb-2 flex justify-end gap-1 text-xs">
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
      <AreaChart
        data={chartData}
        index="bucketStart"
        categories={CATEGORIES}
        colors={COLORS}
        stack
        showGradient
        curveType="monotone"
        valueFormatter={(v) => (mode === "percentage" ? `${Math.round(v)}%` : Math.round(v).toLocaleString())}
        yAxisWidth={56}
        className="h-72"
      />
    </div>
  );
}
