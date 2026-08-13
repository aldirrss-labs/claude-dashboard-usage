"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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
    fetch(`/api/projects/${params.slug}`)
      .then((res) => (res.ok ? res.json() : Promise.resolve({ project: null })))
      .then((json) => setProject(json.project));
  }, [params.slug]);

  if (project === undefined) return <div className="p-8 text-neutral-500">Loading…</div>;
  if (project === null) return <div className="p-8 text-red-500">Project not found.</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">{project.displayName}</h1>
        <p className="text-sm text-neutral-500">{project.displayPath}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Total tokens</div>
          <div className="text-xl font-semibold">{project.totalTokens.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Estimated cost</div>
          <div className="text-xl font-semibold">${project.costUsd.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Sessions</div>
          <div className="text-xl font-semibold">{project.sessionCount}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Last active</div>
          <div className="text-xl font-semibold">{formatDate(project.lastActiveAt)}</div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Sessions</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-4">Session</th>
              <th className="py-2 pr-4 whitespace-nowrap">Started</th>
              <th className="py-2 pr-4 whitespace-nowrap">Ended</th>
              <th className="py-2 pr-4 whitespace-nowrap">Messages</th>
              <th className="py-2 pr-4 whitespace-nowrap">Tokens</th>
              <th className="py-2 whitespace-nowrap">Cost</th>
            </tr>
          </thead>
          <tbody>
            {project.sessions.map((s) => (
              <tr key={s.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2 pr-4 font-mono text-xs">{s.id.slice(0, 8)}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">{formatDate(s.startedAt)}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">{formatDate(s.endedAt)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{s.messageCount}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{s.totalTokens.toLocaleString()}</td>
                <td className="py-2 whitespace-nowrap">${s.costUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
