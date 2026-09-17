"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { SessionTokensChart } from "@/components/SessionTokensChart";
import { Figure, PageHeader, Panel } from "@/components/Panel";

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

export default function ProjectDetailPage() {
  const params = useParams<{ slug: string }>();
  const [project, setProject] = useState<ProjectDetail | null | undefined>(undefined);

  // The fetch runs inside the effect (rather than a call out to a helper that
  // sets state synchronously), so nothing is written to state in the effect
  // body, and a response arriving after a slug change is discarded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/projects/${params.slug}`);
      const json = res.ok ? await res.json() : { project: null };
      if (!cancelled) setProject(json.project);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  if (project === undefined) {
    return <div className="label-mono p-8">Loading…</div>;
  }
  if (project === null) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-primary)" }}>
        Project not found.
        <div className="font-data mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          slug: {params.slug}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <Link href="/projects" className="label-mono mb-4 inline-flex items-center hover:underline">
        ← Back to projects
      </Link>

      <PageHeader kicker={project.displayPath} title={project.displayName} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Panel className="md:col-span-5" accent>
          <Figure label="Total tokens" value={project.totalTokens.toLocaleString()} scale="md" />
        </Panel>
        <Panel className="md:col-span-3 md:mt-6">
          <Figure label="Estimated cost" value={`$${project.costUsd.toFixed(2)}`} scale="sm" tone="accent" />
        </Panel>
        <Panel className="md:col-span-2">
          <Figure label="Sessions" value={String(project.sessionCount)} scale="sm" />
        </Panel>
        <Panel className="md:col-span-2 md:mt-6">
          <p className="label-mono mb-2">Last active</p>
          <p className="font-data text-sm" style={{ color: "var(--text-primary)" }}>
            {formatDate(project.lastActiveAt)}
          </p>
        </Panel>

        <Panel label="Tokens per session" index={1} className="md:col-span-12">
          <SessionTokensChart sessions={project.sessions} />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel label="Session log" index={2} padded={false}>
          <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <th className="label-mono px-4 py-2.5 text-left">Session</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Started</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Ended</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Model</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Msgs</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Tokens</th>
              <th className="label-mono px-4 py-2.5 text-left whitespace-nowrap">Cost</th>
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
                <td className="font-data px-4 py-2text-xs" style={{ color: "var(--text-secondary)" }}>
                  {s.id.slice(0, 8)}
                </td>
                <td className="font-data px-4 py-2whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                  {formatDate(s.startedAt)}
                </td>
                <td className="font-data px-4 py-2whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                  {formatDate(s.endedAt)}
                </td>
                <td className="font-data px-4 py-2whitespace-nowrap text-xs" style={{ color: "var(--text-secondary)" }}>
                  {s.dominantModel ?? "—"}
                </td>
                <td className="font-data px-4 py-2whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  {s.messageCount}
                </td>
                <td className="font-data px-4 py-2whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  {s.totalTokens.toLocaleString()}
                </td>
                <td className="font-data px-4 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  ${s.costUsd.toFixed(2)}
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
