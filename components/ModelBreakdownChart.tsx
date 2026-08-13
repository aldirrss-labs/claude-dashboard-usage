"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}

// Validated categorical palette (dataviz skill, references/palette.md).
// Only the first 4 slots are used for bars; anything past that folds into "Other" below.
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const OTHER_COLOR = "#898781"; // muted, matches chart chrome — deliberately not a 5th hue

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
  const chartData = foldIntoOther(data);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.6} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12, fill: "#898781" }} />
        <YAxis type="category" dataKey="model" tick={{ fontSize: 12, fill: "#52514e" }} width={200} />
        <Tooltip />
        <Bar dataKey="totalTokens" name="Tokens" radius={[0, 4, 4, 0]} maxBarSize={24}>
          {chartData.map((row, index) => (
            <Cell key={row.model} fill={row.model.startsWith("Other") ? OTHER_COLOR : SERIES_COLORS[index]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
