"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { AutoSwitchEvaluation, AutoSwitchStrategy } from "@/lib/autoswitch";
import { formatReset, utilizationColor } from "@/lib/format-usage";

interface Settings {
  enabled: boolean;
  strategy: AutoSwitchStrategy;
  thresholdPercent: number;
  hysteresisPercent: number;
  cooldownSeconds: number;
  restrictToGroup: boolean;
}

export function AutoSwitchPanel({ onSwitched, reloadKey }: { onSwitched: () => void; reloadKey: number }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [evaluation, setEvaluation] = useState<AutoSwitchEvaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/accounts/autoswitch");
    const json = await res.json();
    setEvaluation(json.evaluation);
    setSettings(json.settings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/accounts/autoswitch");
      const json = await res.json();
      if (cancelled) return;
      setEvaluation(json.evaluation);
      setSettings(json.settings);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function patchSettings(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setError(null);
    await fetch("/api/accounts/autoswitch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    await load();
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/accounts/autoswitch", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Auto-switch failed.");
        return;
      }
      setNote(json.reason ?? null);
      if (json.acted) onSwitched();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function applyRecommendation() {
    if (!evaluation?.recommendedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${evaluation.recommendedId}/switch`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Switch failed.");
        return;
      }
      onSwitched();
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !evaluation) return null;

  const recommended = evaluation.candidates.find((c) => c.id === evaluation.recommendedId) ?? null;

  const inputStyle = {
    borderColor: "var(--line-hairline)",
    background: "var(--surface-0)",
    color: "var(--text-primary)",
  };

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            Auto-switch
          </h2>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => patchSettings({ enabled: e.target.checked })}
            />
            Switch automatically
          </label>
        </div>

        <button
          onClick={runNow}
          disabled={busy}
          className="text-xs font-medium hover:underline disabled:opacity-50"
          style={{ color: "var(--accent-500)" }}
        >
          {busy ? "Working…" : "Evaluate now"}
        </button>
      </div>

      {settings.enabled ? (
        <p className="mt-2 text-xs" style={{ color: "var(--warning-500, #d97706)" }}>
          The background scheduler will change your active Claude login on its own, every 5 minutes.
          It waits until no Claude Code session is running before acting.
        </p>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Recommendation only — nothing changes your active account unless you press the button.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          Strategy
          <select
            value={settings.strategy}
            onChange={(e) => patchSettings({ strategy: e.target.value as AutoSwitchStrategy })}
            className="rounded border px-1.5 py-1 outline-none"
            style={inputStyle}
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
            value={settings.thresholdPercent}
            onChange={(e) => patchSettings({ thresholdPercent: Number(e.target.value) })}
            className="font-data w-16 rounded border px-1.5 py-1 outline-none"
            style={inputStyle}
          />
          %
        </label>

        <label
          className="flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
          title="How much more headroom a candidate needs before a switch is worth it. Stops two accounts near the line from trading places every tick."
        >
          Hysteresis
          <input
            type="number"
            min={0}
            max={100}
            value={settings.hysteresisPercent}
            onChange={(e) => patchSettings({ hysteresisPercent: Number(e.target.value) })}
            className="font-data w-16 rounded border px-1.5 py-1 outline-none"
            style={inputStyle}
          />
          pt
        </label>

        <label
          className="flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
          title="Minimum gap between switches. Bypassed when the active account is completely exhausted."
        >
          Cooldown
          <input
            type="number"
            min={0}
            value={Math.round(settings.cooldownSeconds / 60)}
            onChange={(e) => patchSettings({ cooldownSeconds: Number(e.target.value) * 60 })}
            className="font-data w-16 rounded border px-1.5 py-1 outline-none"
            style={inputStyle}
          />
          min
        </label>

        <label
          className="flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
          title="Only rotate between accounts in the same group, so work never falls back onto a personal account."
        >
          <input
            type="checkbox"
            checked={settings.restrictToGroup}
            onChange={(e) => patchSettings({ restrictToGroup: e.target.checked })}
          />
          Stay within group
        </label>
      </div>

      <p
        className="mt-3 text-xs"
        style={{ color: evaluation.shouldSwitch ? "var(--warning-500, #d97706)" : "var(--text-muted)" }}
      >
        {evaluation.rationale}
      </p>

      {note && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {note}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--danger-500, #dc2626)" }}>
          {error}
        </p>
      )}

      {recommended && (
        <div className="mt-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={applyRecommendation}
            disabled={busy}
            className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent-500)" }}
          >
            {busy ? "Switching…" : `Switch to ${recommended.label}`}
          </motion.button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
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
                <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
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
                <td
                  className="font-data py-1.5 pr-3"
                  style={{ color: c.pressurePercent === null ? "var(--text-muted)" : utilizationColor(c.pressurePercent) }}
                >
                  {c.pressurePercent === null ? "—" : `${Math.round(c.pressurePercent)}%`}
                </td>
                <td className="font-data py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                  {c.headroomPercent === null ? "—" : `${Math.round(c.headroomPercent)}%`}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {formatReset(c.nextResetAt) ?? "—"}
                </td>
                <td className="py-1.5" style={{ color: c.eligible ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {c.eligible ? "yes" : (c.reason ?? "no")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
