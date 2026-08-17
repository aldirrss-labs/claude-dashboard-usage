"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface SessionPoint {
  id: string;
  startedAt: string | null;
  totalTokens: number;
}

const COLOR_ACCENT = "#2a78d6";

export function SessionTokensChart({ sessions }: { sessions: SessionPoint[] }) {
  const chronological = [...sessions].reverse();
  const data = chronological.map((s) => ({
    label: s.id.slice(0, 6),
    tokens: s.totalTokens,
  }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} />
        <YAxis tick={{ fontSize: 11, fill: "#898781" }} tickFormatter={(v) => v.toLocaleString()} />
        <Tooltip formatter={(value) => Number(value).toLocaleString()} />
        <Bar dataKey="tokens" fill={COLOR_ACCENT} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
