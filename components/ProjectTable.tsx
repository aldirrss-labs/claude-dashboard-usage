"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}

type SortKey = "totalTokens" | "costUsd" | "lastActiveAt";

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

export function ProjectTable({ projects }: { projects: ProjectListRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return projects
      .filter((p) => p.displayName.toLowerCase().includes(term) || p.displayPath.toLowerCase().includes(term))
      .sort((a, b) => {
        if (sortKey === "lastActiveAt") return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
        return b[sortKey] - a[sortKey];
      });
  }, [projects, search, sortKey]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="totalTokens">Sort by tokens</option>
          <option value="costUsd">Sort by cost</option>
          <option value="lastActiveAt">Sort by last active</option>
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-2 pr-4">Project</th>
            <th className="py-2 pr-4 whitespace-nowrap">Tokens</th>
            <th className="py-2 pr-4 whitespace-nowrap">Cost</th>
            <th className="py-2 pr-4 whitespace-nowrap">Sessions</th>
            <th className="py-2 whitespace-nowrap">Last active</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.slug} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 pr-4">
                <Link href={`/projects/${p.slug}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {p.displayName}
                </Link>
                <div className="text-xs text-neutral-400">{p.displayPath}</div>
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">{p.totalTokens.toLocaleString()}</td>
              <td className="py-2 pr-4 whitespace-nowrap">${p.costUsd.toFixed(2)}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{p.sessionCount}</td>
              <td className="py-2 whitespace-nowrap text-neutral-500">{formatDate(p.lastActiveAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
