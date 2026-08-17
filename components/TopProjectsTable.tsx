"use client";

import Link from "next/link";
import { SparkAreaChart } from "@tremor/react";

interface TopProjectRow {
  slug: string;
  displayName: string;
  costUsd: number;
  totalTokens: number;
  sparkline: number[];
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="h-8 w-24 text-xs" style={{ color: "var(--text-muted)" }}>—</div>;
  }
  const data = values.map((v, i) => ({ day: i, tokens: v }));
  return (
    <SparkAreaChart data={data} index="day" categories={["tokens"]} colors={["blue"]} className="h-8 w-24" />
  );
}

export function TopProjectsTable({ projects }: { projects: TopProjectRow[] }) {
  if (projects.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        No usage data in this range yet.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
          <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide">Project</th>
          <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Trend</th>
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
