"use client";

import { BarChart } from "@tremor/react";
import { formatCompact } from "@/lib/format-usage";

interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}

const SERIES_COLORS = ["lime", "cyan", "orange", "violet"];
const OTHER_COLOR = "gray";

const MAX_SERIES = 4;

function foldIntoOther(rows: ModelBreakdownRow[]): ModelBreakdownRow[] {
  const sorted = [...rows].sort((a, b) => b.totalTokens - a.totalTokens);
  if (sorted.length <= MAX_SERIES) return sorted;
  const head = sorted.slice(0, MAX_SERIES);
  const tail = sorted.slice(MAX_SERIES);
  const other: ModelBreakdownRow = {
    model: `Other (${tail.length})`,
    totalTokens: tail.reduce((sum, r) => sum + r.totalTokens, 0),
    costUsd: tail.reduce((sum, r) => sum + r.costUsd, 0),
  };
  return [...head, other];
}

export function ModelBreakdownChart({ data }: { data: ModelBreakdownRow[] }) {
  const chartData = foldIntoOther(data).map((row, index) => ({
    model: row.model,
    Tokens: row.totalTokens,
    color: row.model.startsWith("Other") ? OTHER_COLOR : SERIES_COLORS[index],
  }));

  return (
    <BarChart
      data={chartData}
      index="model"
      categories={["Tokens"]}
      colors={[SERIES_COLORS[0]]}
      layout="vertical"
      valueFormatter={(v) => formatCompact(v)}
      yAxisWidth={200}
      className="h-60"
      showLegend={false}
    />
  );
}
