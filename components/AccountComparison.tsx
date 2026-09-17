"use client";

import { motion } from "framer-motion";
import { formatCompact, formatUsd } from "@/lib/format-usage";

export interface AccountUsageRow {
  key: string;
  label: string;
  attributed: boolean;
  tokens: number;
  costUsd: number;
  events: number;
  sessions: number;
}

const ACCOUNT_HUES = ["#a3e635", "#22d3ee", "#fb923c", "#a78bfa", "#f472b6"];

function hueFor(index: number, attributed: boolean): string {
  return attributed ? ACCOUNT_HUES[index % ACCOUNT_HUES.length] : "var(--line-strong)";
}

/**
 * Usage split by which account was logged in at the time.
 *
 * The "Unattributed" row is deliberately shown rather than hidden: Claude
 * Code's logs carry no account identity, so attribution only exists for usage
 * recorded after the dashboard started tracking which account was live.
 * Dropping that row would make the split look complete while quietly
 * disagreeing with the project's real total.
 */
export function AccountComparison({
  rows,
  attributionStartedAt,
}: {
  rows: AccountUsageRow[];
  attributionStartedAt: string | null;
}) {
  if (rows.length === 0) {
    return <p className="label-mono">No usage in this range.</p>;
  }

  const totalCost = rows.reduce((sum, r) => sum + r.costUsd, 0);
  const attributedRows = rows.filter((r) => r.attributed);
  const unattributed = rows.find((r) => !r.attributed);

  return (
    <div>
      {/* One stacked bar so two accounts can be compared at a glance. */}
      <div className="mb-4 flex h-3 w-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
        {rows.map((row, index) => (
          <motion.div
            key={row.key}
            initial={{ width: 0 }}
            animate={{ width: `${totalCost > 0 ? (row.costUsd / totalCost) * 100 : 0}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ background: hueFor(index, row.attributed) }}
            title={`${row.label}: ${formatUsd(row.costUsd)}`}
          />
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <th className="label-mono py-2 pr-4 text-left">Account</th>
              <th className="label-mono py-2 pr-4 text-right whitespace-nowrap">Cost</th>
              <th className="label-mono py-2 pr-4 text-right whitespace-nowrap">Share</th>
              <th className="label-mono py-2 pr-4 text-right whitespace-nowrap">Tokens</th>
              <th className="label-mono py-2 pr-4 text-right whitespace-nowrap">Sessions</th>
              <th className="label-mono py-2 text-right whitespace-nowrap">$/session</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.key}
                style={{
                  borderBottom: "1px solid var(--line-hairline)",
                  opacity: row.attributed ? 1 : 0.6,
                }}
              >
                <td className="py-2 pr-4 whitespace-nowrap">
                  <span
                    className="mr-2 inline-block h-2 w-2 align-middle"
                    style={{ background: hueFor(index, row.attributed) }}
                  />
                  <span style={{ color: "var(--text-primary)" }}>{row.label}</span>
                </td>
                <td className="font-data py-2 pr-4 text-right" style={{ color: "var(--accent-500)" }}>
                  {formatUsd(row.costUsd)}
                </td>
                <td className="font-data py-2 pr-4 text-right" style={{ color: "var(--text-muted)" }}>
                  {totalCost > 0 ? ((row.costUsd / totalCost) * 100).toFixed(1) : "0.0"}%
                </td>
                <td className="font-data py-2 pr-4 text-right" style={{ color: "var(--text-primary)" }}>
                  {formatCompact(row.tokens)}
                </td>
                <td className="font-data py-2 pr-4 text-right" style={{ color: "var(--text-primary)" }}>
                  {row.sessions}
                </td>
                <td className="font-data py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                  {row.sessions > 0 ? formatUsd(row.costUsd / row.sessions) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {attributedRows.length < 2 && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Only one account has attributed usage so far — switch accounts and the split appears here.
        </p>
      )}

      {unattributed && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {formatUsd(unattributed.costUsd)} could not be attributed. Claude Code&apos;s session logs
          record no account identity, so usage can only be assigned from when this dashboard began
          tracking which account was live
          {attributionStartedAt ? ` — ${attributionStartedAt.replace(" ", " at ")} UTC` : ""}. Earlier
          usage is real but unassignable, and is kept here so the split still adds up to the total.
        </p>
      )}
    </div>
  );
}
