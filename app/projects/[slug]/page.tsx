"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Figure, PageHeader, Panel } from "@/components/Panel";
import { BarList } from "@/components/BarList";
import { AccountComparison, type AccountUsageRow } from "@/components/AccountComparison";
import { ProjectCostChart, type ProjectDailyPoint } from "@/components/ProjectCostChart";
import { formatCompact, formatUsd, modelHue, shortModel } from "@/lib/format-usage";

interface DetailResponse {
  project: ProjectDetail;
  daily: ProjectDailyPoint[];
  models: Array<{ model: string; tokens: number; costUsd: number }>;
  branches: Array<{ branch: string; tokens: number; costUsd: number; sessions: number }>;
  byAccount: AccountUsageRow[];
  attributionStartedAt: string | null;
  rangeDays: number;
}

interface ProjectDetail {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
  sessions: Array<{
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    messageCount: number;
    totalTokens: number;
    costUsd: number;
    dominantModel: string | null;
  }>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Wall-clock span of a session, which says more than its start time alone. */
function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "—";
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export default function ProjectDetailPage() {
  const params = useParams<{ slug: string }>();
  const [data, setData] = useState<DetailResponse | null | undefined>(undefined);

  // The fetch runs inside the effect (rather than a call out to a helper that
  // sets state synchronously), so nothing is written to state in the effect
  // body, and a response arriving after a slug change is discarded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/projects/${params.slug}?rangeDays=90`);
      const json = res.ok ? await res.json() : null;
      if (!cancelled) setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  if (data === undefined) {
    return <div className="label-mono p-8">Loading…</div>;
  }
  if (data === null) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-primary)" }}>
        Project not found.
        <div className="font-data mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          slug: {params.slug}
        </div>
      </div>
    );
  }

  const { project, daily, models, branches, byAccount, attributionStartedAt } = data;
  const totalMessages = project.sessions.reduce((sum, s) => sum + s.messageCount, 0);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <Link href="/projects" className="label-mono mb-4 inline-flex items-center hover:underline">
        ← Back to projects
      </Link>

      <PageHeader kicker={project.displayPath} title={project.displayName} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Panel className="md:col-span-5" accent>
          <Figure
            label="Total tokens"
            value={formatCompact(project.totalTokens)}
            scale="md"
            hint={`${project.totalTokens.toLocaleString()} exact`}
          />
        </Panel>
        <Panel className="md:col-span-3 md:mt-6">
          <Figure label="Estimated cost" value={formatUsd(project.costUsd)} scale="sm" tone="accent" />
        </Panel>
        <Panel className="md:col-span-2">
          <Figure
            label="Sessions"
            value={String(project.sessionCount)}
            scale="sm"
            hint={`${totalMessages.toLocaleString()} messages`}
          />
        </Panel>
        <Panel className="md:col-span-2 md:mt-6">
          <p className="label-mono mb-2">Last active</p>
          <p className="font-data text-sm" style={{ color: "var(--text-primary)" }}>
            {formatDate(project.lastActiveAt)}
          </p>
        </Panel>

        <Panel className="md:col-span-4">
          <Figure
            label="Cost per session"
            value={project.sessionCount ? formatUsd(project.costUsd / project.sessionCount) : "—"}
            scale="sm"
          />
        </Panel>
        <Panel className="md:col-span-4">
          <Figure
            label="Cost per message"
            value={totalMessages ? formatUsd(project.costUsd / totalMessages) : "—"}
            scale="sm"
            hint={totalMessages ? `${formatCompact(project.totalTokens / totalMessages)} tokens each` : undefined}
          />
        </Panel>
        <Panel className="md:col-span-4">
          <Figure
            label="Active days"
            value={String(daily.length)}
            scale="sm"
            hint={daily.length ? `${formatUsd(project.costUsd / daily.length)} per active day` : undefined}
          />
        </Panel>

        <Panel label="Spend over time" index={1} className="md:col-span-12">
          <ProjectCostChart data={daily} />
        </Panel>

        <Panel label="By model" index={2} className="md:col-span-6">
          <BarList
            emptyLabel="No model usage in this range."
            items={models.map((m) => ({
              key: m.model,
              label: shortModel(m.model),
              value: m.costUsd,
              detail: formatCompact(m.tokens),
              emphasis: formatUsd(m.costUsd),
              hue: modelHue(m.model),
            }))}
          />
        </Panel>

        <Panel label="By git branch" index={3} className="md:col-span-6">
          <BarList
            emptyLabel="No branch data in this range."
            items={branches.map((b) => ({
              key: b.branch,
              label: b.branch,
              value: b.costUsd,
              detail: `${formatCompact(b.tokens)} · ${b.sessions} ${b.sessions === 1 ? "session" : "sessions"}`,
              emphasis: formatUsd(b.costUsd),
              hue: b.branch === "unknown" ? "var(--line-strong)" : "var(--accent-500)",
            }))}
          />
          {branches.some((b) => b.branch === "unknown") && (
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Branch is recorded per event, and was only added to the ingest recently — usage logged
              before that is grouped as unknown and cannot be backfilled.
            </p>
          )}
        </Panel>

        <Panel label="By account" index={4} className="md:col-span-12">
          <AccountComparison rows={byAccount} attributionStartedAt={attributionStartedAt} />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel label="Session log" index={5} padded={false}>
          <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <th className="label-mono px-4 py-2.5 text-left">Session</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Started</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Duration</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Model</th>
              <th className="label-mono px-4 py-2.5 text-right whitespace-nowrap">Msgs</th>
              <th className="label-mono px-4 py-2.5 text-right whitespace-nowrap">Tokens</th>
              <th className="label-mono px-4 py-2.5 text-right whitespace-nowrap">$/msg</th>
              <th className="label-mono px-4 py-2.5 text-right whitespace-nowrap">Cost</th>
            </tr>
          </thead>
          <tbody>
            {project.sessions.map((s, index) => (
              <motion.tr
                key={s.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.4) }}
                style={{ borderBottom: "1px solid var(--line-hairline)" }}
              >
                <td className="font-data px-4 py-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {s.id.slice(0, 8)}
                </td>
                <td className="font-data px-4 py-2 text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {formatDate(s.startedAt)}
                </td>
                <td className="font-data px-4 py-2 text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {formatDuration(s.startedAt, s.endedAt)}
                </td>
                <td className="font-data px-4 py-2 text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                  {s.dominantModel ? shortModel(s.dominantModel) : "—"}
                </td>
                <td className="font-data px-4 py-2 text-right whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  {s.messageCount}
                </td>
                <td className="font-data px-4 py-2 text-right whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  {formatCompact(s.totalTokens)}
                </td>
                <td className="font-data px-4 py-2 text-right whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {s.messageCount > 0 ? formatUsd(s.costUsd / s.messageCount) : "—"}
                </td>
                <td className="font-data px-4 py-2 text-right whitespace-nowrap" style={{ color: "var(--accent-500)" }}>
                  {formatUsd(s.costUsd)}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
          </div>
        </Panel>
      </div>
    </main>
  );
}
