"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

interface MappingRow {
  canonicalDir: string;
  accountId: number;
  accountLabel: string | null;
  accountEmail: string | null;
  createdAt: string;
}

interface AccountOption {
  id: number;
  label: string;
  email: string | null;
}

export function MappingsPanel({ accounts, reloadKey }: { accounts: AccountOption[]; reloadKey: number }) {
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [dir, setDir] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState("");
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/accounts/mappings");
    const json = await res.json();
    setMappings(json.mappings ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/accounts/mappings");
      const json = await res.json();
      if (!cancelled) setMappings(json.mappings ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function addMapping() {
    const target = accountId ?? accounts[0]?.id;
    if (!dir.trim() || target === undefined) return;
    setError(null);

    const res = await fetch("/api/accounts/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, accountId: target }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(typeof json.error === "string" ? json.error : "Could not save mapping.");
      return;
    }
    setDir("");
    await load();
  }

  async function removeMapping(canonicalDir: string) {
    await fetch(`/api/accounts/mappings?dir=${encodeURIComponent(canonicalDir)}`, { method: "DELETE" });
    await load();
  }

  async function runProbe() {
    if (!probe.trim()) return;
    const res = await fetch(`/api/accounts/mappings?dir=${encodeURIComponent(probe)}`);
    const json = await res.json();
    setProbeResult(
      json.resolved
        ? `→ ${json.resolved.accountLabel} (via ${json.resolved.canonicalDir})`
        : "→ no mapping matches; the active account would be left alone"
    );
  }

  const inputStyle = {
    borderColor: "var(--line-hairline)",
    background: "var(--surface-0)",
    color: "var(--text-primary)",
  };

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
      <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Directory mapping
      </h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Tie a folder to an account, so a freelance project bills the freelance account and work bills
        work. Subfolders inherit, and the deepest mapping wins.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="mb-1 block">Directory</span>
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMapping()}
            placeholder="~/Project/client-x"
            className="font-data w-80 rounded border px-2 py-1.5 text-sm outline-none"
            style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="mb-1 block">Account</span>
          <select
            value={accountId ?? accounts[0]?.id ?? ""}
            onChange={(e) => setAccountId(Number(e.target.value))}
            className="rounded border px-2 py-1.5 text-sm outline-none"
            style={inputStyle}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={addMapping}
          disabled={!dir.trim() || accounts.length === 0}
          className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent-500)" }}
        >
          Map
        </motion.button>
      </div>

      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger-500, #dc2626)" }}>
          {error}
        </p>
      )}

      {mappings.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
                <th className="py-1.5 pr-3 font-medium">Directory</th>
                <th className="py-1.5 pr-3 font-medium">Account</th>
                <th className="py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.canonicalDir} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                  <td className="font-data py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                    {m.canonicalDir}
                  </td>
                  <td className="py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                    {m.accountLabel ?? <span style={{ color: "var(--danger-500, #dc2626)" }}>account removed</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => removeMapping(m.canonicalDir)}
                      className="hover:underline"
                      style={{ color: "var(--danger-500, #dc2626)" }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line-hairline)" }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">Test a path</span>
            <input
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runProbe()}
              placeholder="~/Project/client-x/src"
              className="font-data w-80 rounded border px-2 py-1.5 text-sm outline-none"
              style={inputStyle}
            />
          </label>
          <button
            onClick={runProbe}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ ...inputStyle, borderColor: "var(--line-hairline)" }}
          >
            Resolve
          </button>
        </div>
        {probeResult && (
          <p className="font-data mt-2 text-xs" style={{ color: "var(--text-primary)" }}>
            {probeResult}
          </p>
        )}
      </div>
    </div>
  );
}
