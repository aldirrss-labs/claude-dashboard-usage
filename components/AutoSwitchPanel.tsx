"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { AutoSwitchEvaluation, AutoSwitchStrategy } from "@/lib/autoswitch";
import { formatReset, utilizationColor } from "@/lib/format-usage";

export function AutoSwitchPanel({ onSwitched, reloadKey }: { onSwitched: () => void; reloadKey: number }) {
  const [strategy, setStrategy] = useState<AutoSwitchStrategy>("best");
  const [threshold, setThreshold] = useState(90);
  const [evaluation, setEvaluation] = useState<AutoSwitchEvaluation | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/accounts/autoswitch?strategy=${strategy}&threshold=${threshold}`)
      .then((res) => res.json())
      .then((json) => setEvaluation(json.evaluation))
      .catch(() => setEvaluation(null));
  }, [strategy, threshold]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  async function applyRecommendation() {
    if (!evaluation?.recommendedId) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${evaluation.recommendedId}/switch`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Switch failed.");
        return;
      }
      onSwitched();
      load();
    } finally {
      setApplying(false);
    }
  }

  const recommended = evaluation?.candidates.find((c) => c.id === evaluation.recommendedId) ?? null;

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Auto-switch
        </h2>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            Strategy
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as AutoSwitchStrategy)}
              className="rounded border px-1.5 py-1 outline-none"
              style={{ borderColor: "var(--line-hairline)", background: "var(--surface-0)", color: "var(--text-primary)" }}
            >
              <option value="best">best — most headroom</option>
              <option value="consume-first">consume-first — soonest reset</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            Threshold
            <input
              type="number"
              min={1}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="font-data w-16 rounded border px-1.5 py-1 outline-none"
              style={{ borderColor: "var(--line-hairline)", background: "var(--surface-0)", color: "var(--text-primary)" }}
            />
            %
          </label>
        </div>
      </div>

      {evaluation && (
        <>
          <p className="mt-3 text-xs" style={{ color: evaluation.shouldSwitch ? "var(--warning-500, #d97706)" : "var(--text-muted)" }}>
            {evaluation.rationale}
          </p>

          {recommended && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={applyRecommendation}
                disabled={applying}
                className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent-500)" }}
              >
                {applying ? "Switching…" : `Switch to ${recommended.label}`}
              </motion.button>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Switching is manual — nothing changes your active account on its own.
              </span>
            </div>
          )}

          {error && (
            <p className="mt-2 text-xs" style={{ color: "var(--danger-500, #dc2626)" }}>
              {error}
            </p>
          )}

          <table className="mt-4 w-full text-xs">
            <thead>
              <tr className="text-left" style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
                <th className="py-1.5 pr-3 font-medium">Account</th>
                <th className="py-1.5 pr-3 font-medium">Pressure</th>
                <th className="py-1.5 pr-3 font-medium">Headroom</th>
                <th className="py-1.5 pr-3 font-medium">Next reset</th>
                <th className="py-1.5 font-medium">Eligible</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.candidates.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                  <td className="py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                    {c.label}
                    {c.active && (
                      <span className="ml-1.5" style={{ color: "var(--accent-500)" }}>
                        ● active
                      </span>
                    )}
                    {c.id === evaluation.recommendedId && (
                      <span className="ml-1.5" style={{ color: "var(--warning-500, #d97706)" }}>
                        ← recommended
                      </span>
                    )}
                  </td>
                  <td className="font-data py-1.5 pr-3" style={{ color: c.pressurePercent === null ? "var(--text-muted)" : utilizationColor(c.pressurePercent) }}>
                    {c.pressurePercent === null ? "—" : `${Math.round(c.pressurePercent)}%`}
                  </td>
                  <td className="font-data py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                    {c.headroomPercent === null ? "—" : `${Math.round(c.headroomPercent)}%`}
                  </td>
                  <td className="py-1.5 pr-3" style={{ color: "var(--text-muted)" }}>
                    {formatReset(c.nextResetAt) ?? "—"}
                  </td>
                  <td className="py-1.5" style={{ color: c.eligible ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {c.eligible ? "yes" : (c.reason ?? "no")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
