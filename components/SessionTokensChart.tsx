"use client";

import { BarChart } from "@tremor/react";
import { formatCompact } from "@/lib/format-usage";

interface SessionPoint {
  id: string;
  startedAt: string | null;
  totalTokens: number;
}

export function SessionTokensChart({ sessions }: { sessions: SessionPoint[] }) {
  const chronological = [...sessions].reverse();
  const data = chronological.map((s) => ({
    label: s.id.slice(0, 6),
    Tokens: s.totalTokens,
  }));

  if (data.length === 0) return null;

  return (
    <BarChart
      data={data}
      index="label"
      categories={["Tokens"]}
      colors={["lime"]}
      valueFormatter={(v) => formatCompact(v)}
      className="h-36"
      showLegend={false}
    />
  );
}
