"use client";

import { motion } from "framer-motion";
import type { AccountUsage } from "@/lib/claude-oauth";
import { formatCents, formatReset, utilizationColor } from "@/lib/format-usage";

interface BarRow {
  key: string;
  label: string;
  percent: number;
  detail: string | null;
  resetsAt: string | null;
}

/**
 * Flatten a usage payload into claude-swap's row order: spend, then the two
 * rolling windows, then any per-model caps (e.g. Fable's weekly limit).
 */
export function toBarRows(usage: AccountUsage): BarRow[] {
  const rows: BarRow[] = [];

  if (usage.spend) {
    const { usedCents, limitCents, currency, utilization, resetsAt } = usage.spend;
    rows.push({
      key: "spend",
      label: "$$",
      percent: utilization,
      detail:
        limitCents !== null
          ? `${formatCents(usedCents, currency)} / ${formatCents(limitCents, currency)}`
          : formatCents(usedCents, currency),
      resetsAt,
    });
  }
  if (usage.fiveHour) {
    rows.push({ key: "5h", label: "5h", percent: usage.fiveHour.utilization, detail: null, resetsAt: usage.fiveHour.resetsAt });
  }
  if (usage.sevenDay) {
    rows.push({ key: "7d", label: "7d", percent: usage.sevenDay.utilization, detail: null, resetsAt: usage.sevenDay.resetsAt });
  }
  for (const scoped of usage.scoped) {
    rows.push({
      key: `model:${scoped.label}`,
      label: scoped.label,
      percent: scoped.utilization,
      detail: null,
      resetsAt: scoped.resetsAt,
    });
  }

  return rows;
}

export function UsageBars({ usage, dimmed = false }: { usage: AccountUsage; dimmed?: boolean }) {
  const rows = toBarRows(usage);
  if (rows.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        No quota windows reported for this account.
      </p>
    );
  }

  return (
    <div className="space-y-1.5" style={{ opacity: dimmed ? 0.55 : 1 }}>
      {rows.map((row) => {
        const color = utilizationColor(row.percent);
        const reset = formatReset(row.resetsAt);
        return (
          <div key={row.key} className="flex items-center gap-3 text-xs">
            <span
              className="font-data w-14 shrink-0 truncate"
              style={{ color: "var(--text-secondary)" }}
              title={row.label}
            >
              {row.label}
            </span>

            <div
              className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full"
              style={{ background: "var(--line-hairline)" }}
              role="progressbar"
              aria-valuenow={Math.round(row.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${row.label} usage`}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, row.percent)}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>

            <span className="font-data w-10 shrink-0 text-right" style={{ color }}>
              {Math.round(row.percent)}%
            </span>

            {row.detail && (
              <span className="font-data shrink-0" style={{ color: "var(--text-primary)" }}>
                {row.detail}
              </span>
            )}
            {reset && (
              <span className="truncate" style={{ color: "var(--text-muted)" }}>
                {reset}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One-line "5h 19% · 7d 22%" summary for collapsed rows. */
export function UsageSummaryLine({ usage }: { usage: AccountUsage | null }) {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.fiveHour) parts.push(`5h ${Math.round(usage.fiveHour.utilization)}%`);
  if (usage.sevenDay) parts.push(`7d ${Math.round(usage.sevenDay.utilization)}%`);
  for (const scoped of usage.scoped) parts.push(`${scoped.label} ${Math.round(scoped.utilization)}%`);
  if (parts.length === 0) return null;

  return (
    <span className="font-data text-xs" style={{ color: "var(--text-muted)" }}>
      {parts.join(" · ")}
    </span>
  );
}
