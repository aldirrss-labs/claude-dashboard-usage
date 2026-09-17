"use client";

import { useEffect, useState } from "react";
import { UsageTimeSeriesChart } from "@/components/UsageTimeSeriesChart";
import { ModelBreakdownChart } from "@/components/ModelBreakdownChart";
import { SyncButton } from "@/components/SyncButton";
import { TopProjectsTable } from "@/components/TopProjectsTable";
import { Figure, PageHeader, Panel } from "@/components/Panel";

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();

interface SummaryResponse {
  summary: {
    totalTokens: number;
    totalCostUsd: number;
    activeProjectCount: number;
    cacheEfficiencyPct: number;
    cacheSavingsUsd: number;
    projectedMonthlyCostUsd: number;
    todayCostUsd: number;
  };
  timeSeries: Array<{
    bucketStart: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }>;
  modelBreakdown: Array<{ model: string; totalTokens: number; costUsd: number }>;
  topProjects: Array<{ slug: string; displayName: string; costUsd: number; totalTokens: number; sparkline: number[] }>;
  budgetLimit: { limitUsd: number | null };
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
    return <div className="label-mono p-8">Loading dashboard…</div>;
  }

  const overBudget =
    data.budgetLimit.limitUsd !== null && data.summary.todayCostUsd > data.budgetLimit.limitUsd;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <PageHeader
        kicker="Claude Code · this machine"
        title="Dashboard"
        action={
          <>
            <SyncButton onSynced={refetch} />
            <select
              className="label-mono border px-2 py-1.5"
              style={{ borderColor: "var(--line-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value))}
            >
              <option value={7}>LAST 7 DAYS</option>
              <option value={30}>LAST 30 DAYS</option>
              <option value={90}>LAST 90 DAYS</option>
            </select>
          </>
        }
      />

      {overBudget && (
        <div
          className="mb-6 px-4 py-2.5 text-sm"
          style={{
            background: "rgba(255, 107, 107, 0.1)",
            color: "var(--danger-500)",
            borderLeft: "3px solid var(--danger-500)",
          }}
        >
          <span className="label-mono mr-2" style={{ color: "var(--danger-500)" }}>
            Over budget
          </span>
          Today is ${data.summary.todayCostUsd.toFixed(2)} against a ${data.budgetLimit.limitUsd!.toFixed(2)} limit.
        </div>
      )}

      {/*
        Deliberately uneven 12-column grid: the two figures that matter get
        unequal weight (7/5), the small stats break 4/4/4 below them, and the
        charts split 8/4. Nothing is centred and no two rows share a rhythm —
        but every span lands on the same grid, which is what keeps the
        disorder from reading as breakage.
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Panel className="md:col-span-7" accent delay={0}>
          <Figure
            label="Total tokens"
            value={compact(data.summary.totalTokens)}
            scale="lg"
            hint={`${data.summary.totalTokens.toLocaleString()} exact`}
          />
        </Panel>

        <Panel className="md:col-span-5 md:mt-8" delay={0.04}>
          <Figure
            label="Estimated cost"
            value={`$${data.summary.totalCostUsd.toFixed(2)}`}
            scale="md"
            tone="accent"
            hint={`≈ $${data.summary.projectedMonthlyCostUsd.toFixed(2)}/mo at this rate`}
          />
        </Panel>

        <Panel className="md:col-span-4" delay={0.08}>
          <Figure label="Active projects" value={String(data.summary.activeProjectCount)} scale="sm" />
        </Panel>

        <Panel className="md:col-span-4" delay={0.1}>
          <Figure
            label="Cache efficiency"
            value={`${data.summary.cacheEfficiencyPct.toFixed(1)}%`}
            scale="sm"
            hint={`Saved $${data.summary.cacheSavingsUsd.toFixed(2)}`}
          />
        </Panel>

        <Panel className="md:col-span-4" delay={0.12}>
          <Figure label="Today" value={`$${data.summary.todayCostUsd.toFixed(2)}`} scale="sm" />
        </Panel>

        <Panel label="Usage over time" index={1} className="md:col-span-8" delay={0.16}>
          <UsageTimeSeriesChart data={data.timeSeries} />
        </Panel>

        <Panel label="By model" index={2} className="md:col-span-4" delay={0.2}>
          <ModelBreakdownChart data={data.modelBreakdown} />
        </Panel>

        <Panel label="Top projects" index={3} className="md:col-span-12" delay={0.24}>
          <TopProjectsTable projects={data.topProjects} />
        </Panel>
      </div>
    </main>
  );
}
