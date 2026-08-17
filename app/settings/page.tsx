"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface PricingRow {
  model: string;
  input_price: number;
  cache_write_price: number;
  cache_read_price: number;
  output_price: number;
  updated_at: string;
  source: string;
}

export default function SettingsPage() {
  const [pricing, setPricing] = useState<PricingRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaved, setBudgetSaved] = useState<number | null>(null);

  function loadPricing() {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then((json) => setPricing(json.pricing));
  }

  function loadBudget() {
    fetch("/api/budget")
      .then((res) => res.json())
      .then((json) => {
        setBudgetSaved(json.limitUsd);
        setBudgetInput(json.limitUsd !== null ? String(json.limitUsd) : "");
      });
  }

  useEffect(loadPricing, []);
  useEffect(loadBudget, []);

  async function handleSaveBudget() {
    const parsed = budgetInput.trim() === "" ? null : Number(budgetInput);
    await fetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limitUsd: parsed }),
    });
    loadBudget();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/pricing/sync", { method: "POST" });
      const json = await res.json();
      setSyncMessage(json.ok ? `Synced: ${json.updated.join(", ")}` : `Sync failed: ${json.error}`);
      loadPricing();
    } finally {
      setSyncing(false);
    }
  }

  function handleFieldChange(model: string, field: keyof PricingRow, value: number) {
    setPricing((prev) => prev.map((p) => (p.model === model ? { ...p, [field]: value } : p)));
  }

  async function handleSave(row: PricingRow) {
    await fetch("/api/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    loadPricing();
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Settings
        </h1>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleSync}
          disabled={syncing}
          className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent-500)" }}
        >
          {syncing ? "Syncing…" : "Sync Pricing"}
        </motion.button>
      </div>

      {syncMessage && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {syncMessage}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
            <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide">Model</th>
            <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">
              Input $/1M
            </th>
            <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">
              Cache write $/1M
            </th>
            <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">
              Cache read $/1M
            </th>
            <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">
              Output $/1M
            </th>
            <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap">Source</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {pricing.map((row) => (
            <tr key={row.model} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <td className="py-2 pr-4 font-medium" style={{ color: "var(--text-primary)" }}>
                {row.model}
              </td>
              {(["input_price", "cache_write_price", "cache_read_price", "output_price"] as const).map((field) => (
                <td key={field} className="py-2 pr-4">
                  <input
                    type="number"
                    step="0.01"
                    className="font-data w-20 rounded border px-1.5 py-0.5 outline-none"
                    style={{ borderColor: "var(--line-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
                    value={row[field]}
                    onChange={(e) => handleFieldChange(row.model, field, Number(e.target.value))}
                  />
                </td>
              ))}
              <td className="font-data py-2 pr-4 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                {row.source} · {row.updated_at}
              </td>
              <td className="py-2">
                <button
                  onClick={() => handleSave(row)}
                  className="text-xs font-medium hover:underline"
                  style={{ color: "var(--accent-500)" }}
                >
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rounded-lg p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Budget harian
        </h2>
        <div className="flex items-center gap-3">
          <input
            type="number"
            step="0.01"
            placeholder="Tanpa batas"
            className="font-data w-32 rounded border px-2 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface-0)", color: "var(--text-primary)" }}
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
          />
          <button
            onClick={handleSaveBudget}
            className="rounded border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface-0)", color: "var(--text-primary)" }}
          >
            Save
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {budgetSaved !== null ? `Aktif: $${budgetSaved.toFixed(2)}/hari` : "Belum diatur"}
          </span>
        </div>
      </div>
    </main>
  );
}
