"use client";

import Link from "next/link";
import { LineChart, Line, ResponsiveContainer } from "recharts";

interface TopProjectRow {
  slug: string;
  displayName: string;
  costUsd: number;
  totalTokens: number;
  sparkline: number[];
}

const COLOR_ACCENT = "#2a78d6";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="h-8 w-24 text-xs" style={{ color: "var(--text-muted)" }}>—</div>;
  }
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={COLOR_ACCENT} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TopProjectsTable({ projects }: { projects: TopProjectRow[] }) {
  if (projects.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum ada data penggunaan pada rentang ini.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
          <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide">Project</th>
          <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Tokens/hari</th>
          <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Tokens</th>
          <th className="py-2 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Cost</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.slug} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <td className="py-2 pr-4">
              <Link href={`/projects/${p.slug}`} className="font-medium hover:underline" style={{ color: "var(--accent-500)" }}>
                {p.displayName}
              </Link>
            </td>
            <td className="py-2 pr-4">
              <Sparkline values={p.sparkline} />
            </td>
            <td className="font-data py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
              {p.totalTokens.toLocaleString()}
            </td>
            <td className="font-data py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
              ${p.costUsd.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
