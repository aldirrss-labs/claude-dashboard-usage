"use client";

import { useEffect, useState } from "react";
import { SummaryCard } from "@/components/SummaryCard";
import { UsageTimeSeriesChart } from "@/components/UsageTimeSeriesChart";
import { ModelBreakdownChart } from "@/components/ModelBreakdownChart";

interface SummaryResponse {
  summary: { totalTokens: number; totalCostUsd: number; activeProjectCount: number; cacheEfficiencyPct: number };
  timeSeries: Array<{
    bucketStart: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }>;
  modelBreakdown: Array<{ model: string; totalTokens: number; costUsd: number }>;
}

const POLL_INTERVAL_MS = 20_000;

export default function DashboardPage() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      const res = await fetch(`/api/summary?rangeDays=${rangeDays}&bucket=day`);
      const json = (await res.json()) as SummaryResponse;
      if (!cancelled) setData(json);
    }
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rangeDays]);

  if (!data) {
    return <div className="p-8 text-neutral-500">Loading dashboard…</div>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Claude Code Usage Dashboard</h1>
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Total tokens" value={data.summary.totalTokens.toLocaleString()} />
        <SummaryCard label="Estimated cost" value={`$${data.summary.totalCostUsd.toFixed(2)}`} />
        <SummaryCard label="Active projects" value={String(data.summary.activeProjectCount)} />
        <SummaryCard label="Cache efficiency" value={`${data.summary.cacheEfficiencyPct.toFixed(1)}%`} />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Usage over time</h2>
        <UsageTimeSeriesChart data={data.timeSeries} />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Usage by model</h2>
        <ModelBreakdownChart data={data.modelBreakdown} />
      </div>
    </main>
  );
}
