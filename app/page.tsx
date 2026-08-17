"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SummaryCard } from "@/components/SummaryCard";
import { UsageTimeSeriesChart } from "@/components/UsageTimeSeriesChart";
import { ModelBreakdownChart } from "@/components/ModelBreakdownChart";
import { SyncButton } from "@/components/SyncButton";

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

  function refetch() {
    fetch(`/api/summary?rangeDays=${rangeDays}&bucket=day`)
      .then((res) => res.json())
      .then((json) => setData(json));
  }

  if (!data) {
    return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Loading dashboard…</div>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Dashboard
        </h1>
        <div className="flex items-center gap-3">
          <SyncButton onSynced={refetch} />
          <select
            className="rounded border px-2 py-1 text-sm"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Total tokens" value={data.summary.totalTokens} />
        <SummaryCard
          label="Estimated cost"
          value={data.summary.totalCostUsd}
          formatter={(n) => `$${n.toFixed(2)}`}
        />
        <SummaryCard label="Active projects" value={data.summary.activeProjectCount} />
        <SummaryCard
          label="Cache efficiency"
          value={data.summary.cacheEfficiencyPct}
          formatter={(n) => `${n.toFixed(1)}%`}
        />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-lg p-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}
      >
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Usage over time
        </h2>
        <UsageTimeSeriesChart data={data.timeSeries} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="rounded-lg p-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}
      >
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Usage by model
        </h2>
        <ModelBreakdownChart data={data.modelBreakdown} />
      </motion.div>
    </main>
  );
}
