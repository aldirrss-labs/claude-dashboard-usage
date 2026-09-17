"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { formatCompact, formatUsd } from "@/lib/format-usage";

export interface ProjectModelCell {
  model: string;
  tokens: number;
  costUsd: number;
}

export interface ProjectModelRow {
  slug: string;
  displayName: string;
  totalTokens: number;
  totalCostUsd: number;
  models: ProjectModelCell[];
}

// Stable colour per model family, so the same model reads the same way in every
// row rather than shifting with its rank within a project.
function modelHue(model: string): string {
  if (model.includes("opus")) return "#a3e635";
  if (model.includes("sonnet")) return "#22d3ee";
  if (model.includes("haiku")) return "#fb923c";
  if (model.includes("fable") || model.includes("mythos")) return "#a78bfa";
  return "var(--text-muted)";
}

/** Strip the shared prefix — every row would otherwise start with "claude-". */
function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

export function ProjectModelTable({ projects }: { projects: ProjectModelRow[] }) {
  if (projects.length === 0) {
    return (
      <p className="label-mono p-4">No project activity in this range.</p>
    );
  }

  const maxCost = Math.max(...projects.map((p) => p.totalCostUsd), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <th className="label-mono px-4 py-2.5 text-left">Project</th>
            <th className="label-mono px-4 py-2.5 text-left">Model split by cost</th>
            <th className="label-mono px-4 py-2.5 text-right whitespace-nowrap">Tokens</th>
            <th className="label-mono px-4 py-2.5 text-right whitespace-nowrap">Cost</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project, index) => (
            <motion.tr
              key={project.slug}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
              style={{ borderBottom: "1px solid var(--line-hairline)" }}
            >
              <td className="px-4 py-2.5 align-top whitespace-nowrap">
                <Link
                  href={`/projects/${project.slug}`}
                  className="hover:underline"
                  style={{ color: "var(--accent-500)" }}
                >
                  {project.displayName}
                </Link>
              </td>

              <td className="px-4 py-2.5">
                {/* Bar width is the project's cost against the biggest project,
                    so row length compares across projects while the segments
                    compare models within one. */}
                <div
                  className="mb-1.5 flex h-1.5 overflow-hidden"
                  style={{
                    width: maxCost > 0 ? `${Math.max((project.totalCostUsd / maxCost) * 100, 2)}%` : "2%",
                    background: "var(--surface-2)",
                  }}
                >
                  {project.models.map((m) => (
                    <div
                      key={m.model}
                      style={{
                        width: `${(m.costUsd / project.totalCostUsd) * 100}%`,
                        background: modelHue(m.model),
                      }}
                      title={`${m.model}: ${formatUsd(m.costUsd)}`}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {project.models.map((m) => (
                    <span key={m.model} className="font-data text-xs whitespace-nowrap">
                      <span
                        className="mr-1 inline-block h-2 w-2 align-middle"
                        style={{ background: modelHue(m.model) }}
                      />
                      <span style={{ color: "var(--text-secondary)" }}>{shortModel(m.model)}</span>
                      <span className="ml-1" style={{ color: "var(--text-muted)" }}>
                        {formatUsd(m.costUsd)} ·{" "}
                        {((m.costUsd / project.totalCostUsd) * 100).toFixed(0)}%
                      </span>
                    </span>
                  ))}
                </div>
              </td>

              <td
                className="font-data px-4 py-2.5 text-right align-top whitespace-nowrap"
                style={{ color: "var(--text-primary)" }}
              >
                {formatCompact(project.totalTokens)}
              </td>
              <td
                className="font-data px-4 py-2.5 text-right align-top whitespace-nowrap"
                style={{ color: "var(--accent-500)" }}
              >
                {formatUsd(project.totalCostUsd)}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
