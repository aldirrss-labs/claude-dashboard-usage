"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";

interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}

type SortKey = "totalTokens" | "costUsd" | "lastActiveAt" | "displayName" | "sessionCount";
type SortDirection = "asc" | "desc";

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
  const [sortKey, setSortKey] = useState<SortKey>("lastActiveAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  function handleSortKeyChange(next: SortKey) {
    if (next === sortKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDirection("desc");
    }
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    const dir = sortDirection === "asc" ? 1 : -1;
    return projects
      .filter((p) => p.displayName.toLowerCase().includes(term) || p.displayPath.toLowerCase().includes(term))
      .sort((a, b) => {
        if (sortKey === "lastActiveAt") return dir * (a.lastActiveAt ?? "").localeCompare(b.lastActiveAt ?? "");
        if (sortKey === "displayName") return dir * a.displayName.localeCompare(b.displayName);
        return dir * (a[sortKey] - b[sortKey]);
      });
  }, [projects, search, sortKey, sortDirection]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border px-3 py-1.5 text-sm outline-none transition-colors focus:border-transparent"
          style={{
            borderColor: "var(--line-hairline)",
            background: "var(--surface-1)",
            color: "var(--text-primary)",
          }}
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          value={sortKey}
          onChange={(e) => handleSortKeyChange(e.target.value as SortKey)}
        >
          <option value="lastActiveAt">Sort by last active</option>
          <option value="totalTokens">Sort by tokens</option>
          <option value="costUsd">Sort by cost</option>
          <option value="sessionCount">Sort by sessions</option>
          <option value="displayName">Sort by name</option>
        </select>
        <button
          onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
          className="rounded border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          title={sortDirection === "asc" ? "Ascending" : "Descending"}
        >
          {sortDirection === "asc" ? "↑" : "↓"}
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
            <th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide">Project</th>
            <th className="py-2 pr-4 whitespace-nowrap text-xs font-medium uppercase tracking-wide">Tokens</th>
            <th className="py-2 pr-4 whitespace-nowrap text-xs font-medium uppercase tracking-wide">Cost</th>
            <th className="py-2 pr-4 whitespace-nowrap text-xs font-medium uppercase tracking-wide">Sessions</th>
            <th className="py-2 whitespace-nowrap text-xs font-medium uppercase tracking-wide">Last active</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p, index) => (
            <motion.tr
              key={p.slug}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.4) }}
              style={{ borderBottom: "1px solid var(--line-hairline)" }}
            >
              <td className="py-2 pr-4">
                <Link
                  href={`/projects/${p.slug}`}
                  className="font-medium hover:underline"
                  style={{ color: "var(--accent-500)" }}
                >
                  {p.displayName}
                </Link>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {p.displayPath}
                </div>
              </td>
              <td className="font-data py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                {p.totalTokens.toLocaleString()}
              </td>
              <td className="font-data py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                ${p.costUsd.toFixed(2)}
              </td>
              <td className="font-data py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                {p.sessionCount}
              </td>
              <td className="font-data py-2 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                {formatDate(p.lastActiveAt)}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
