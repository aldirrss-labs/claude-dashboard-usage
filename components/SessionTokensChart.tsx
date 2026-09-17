"use client";

import { BarChart } from "@tremor/react";

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
      valueFormatter={(v) => Math.round(v).toLocaleString()}
      className="h-36"
      showLegend={false}
    />
  );
}
