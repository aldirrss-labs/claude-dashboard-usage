"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { SummaryCard } from "@/components/SummaryCard";

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

  useEffect(() => {
    setProject(undefined);
    fetch(`/api/projects/${params.slug}`)
      .then((res) => (res.ok ? res.json() : Promise.resolve({ project: null })))
      .then((json) => setProject(json.project));
  }, [params.slug]);

  if (project === undefined) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }
  if (project === null) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-primary)" }}>
        Project not found.
        <div className="mt-1 font-data text-xs" style={{ color: "var(--text-muted)" }}>
          slug: {params.slug}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {project.displayName}
        </h1>
        <p className="font-data text-sm" style={{ color: "var(--text-muted)" }}>
          {project.displayPath}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Total tokens" value={project.totalTokens} />
        <SummaryCard label="Estimated cost" value={project.costUsd} formatter={(n) => `$${n.toFixed(2)}`} />
        <SummaryCard label="Sessions" value={project.sessionCount} />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-lg p-4"
          style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}
        >
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Last active
          </div>
          <div className="font-data mt-1.5 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatDate(project.lastActiveAt)}
          </div>
        </motion.div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Sessions
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
              <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide">Session</th>
              <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Started</th>
              <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Ended</th>
              <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Messages</th>
              <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Tokens</th>
              <th className="py-2 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Cost</th>
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
                <td className="font-data py-2 pr-4 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {s.id.slice(0, 8)}
                </td>
                <td className="font-data py-2 pr-4 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                  {formatDate(s.startedAt)}
                </td>
                <td className="font-data py-2 pr-4 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                  {formatDate(s.endedAt)}
                </td>
                <td className="font-data py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  {s.messageCount}
                </td>
                <td className="font-data py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  {s.totalTokens.toLocaleString()}
                </td>
                <td className="font-data py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                  ${s.costUsd.toFixed(2)}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
