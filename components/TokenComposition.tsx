"use client";

import { motion } from "framer-motion";
import { formatCompact, formatUsd } from "@/lib/format-usage";

export interface TokenCompositionRow {
  kind: string;
  tokens: number;
  costUsd: number;
}

// Same order and hues as the usage-over-time chart, so a reader moving between
// the two panels does not have to re-learn which colour means what.
const HUE: Record<string, string> = {
  Input: "#a3e635",
  Output: "#22d3ee",
  "Cache read": "#fb923c",
  "Cache write": "#a78bfa",
};

function Share({
  title,
  rows,
  valueOf,
  format,
}: {
  title: string;
  rows: TokenCompositionRow[];
  valueOf: (row: TokenCompositionRow) => number;
  format: (value: number) => string;
}) {
  const total = rows.reduce((sum, row) => sum + valueOf(row), 0);

  return (
    <div>
      <p className="label-mono mb-2">{title}</p>

      {/* One stacked bar, so the shares are comparable at a glance. */}
      <div className="mb-3 flex h-2 w-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
        {rows.map((row) => {
          const pct = total > 0 ? (valueOf(row) / total) * 100 : 0;
          return (
            <motion.div
              key={row.kind}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              style={{ background: HUE[row.kind] ?? "var(--text-muted)" }}
              title={`${row.kind} ${pct.toFixed(2)}%`}
            />
          );
        })}
      </div>

      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => {
            const value = valueOf(row);
            const pct = total > 0 ? (value / total) * 100 : 0;
            return (
              <tr key={row.kind}>
                <td className="py-1 pr-2 whitespace-nowrap">
                  <span
                    className="mr-2 inline-block h-2 w-2 align-middle"
                    style={{ background: HUE[row.kind] ?? "var(--text-muted)" }}
                  />
                  <span style={{ color: "var(--text-secondary)" }}>{row.kind}</span>
                </td>
                <td className="font-data py-1 pr-3 text-right" style={{ color: "var(--text-primary)" }}>
                  {format(value)}
                </td>
                <td className="font-data py-1 text-right" style={{ color: "var(--text-muted)" }}>
                  {/* Two decimals: one of these shares is routinely under 0.01%,
                      and rounding it to "0.0%" hides that it exists at all. */}
                  {pct.toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The same four token kinds measured two ways. Reading them side by side is the
 * point: cache reads dominate the token count but are billed at a tenth of the
 * input rate, so their share of the bill is much smaller than their share of
 * volume — and output is the mirror image, a rounding error in tokens and a
 * large slice of spend.
 */
export function TokenComposition({ rows }: { rows: TokenCompositionRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Share title="Share of tokens" rows={rows} valueOf={(r) => r.tokens} format={formatCompact} />
      <Share title="Share of cost" rows={rows} valueOf={(r) => r.costUsd} format={formatUsd} />
    </div>
  );
}
