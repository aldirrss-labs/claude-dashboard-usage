"use client";

import { useEffect, useState } from "react";

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

  function loadPricing() {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then((json) => setPricing(json.pricing));
  }

  useEffect(loadPricing, []);

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
        <h1 className="text-xl font-semibold">Settings</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync Pricing"}
        </button>
      </div>

      {syncMessage && <p className="text-sm text-neutral-500">{syncMessage}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-2 pr-4">Model</th>
            <th className="py-2 pr-4 whitespace-nowrap">Input $/1M</th>
            <th className="py-2 pr-4 whitespace-nowrap">Cache write $/1M</th>
            <th className="py-2 pr-4 whitespace-nowrap">Cache read $/1M</th>
            <th className="py-2 pr-4 whitespace-nowrap">Output $/1M</th>
            <th className="py-2 pr-4 whitespace-nowrap">Source</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {pricing.map((row) => (
            <tr key={row.model} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 pr-4 font-medium">{row.model}</td>
              {(["input_price", "cache_write_price", "cache_read_price", "output_price"] as const).map((field) => (
                <td key={field} className="py-2 pr-4">
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                    value={row[field]}
                    onChange={(e) => handleFieldChange(row.model, field, Number(e.target.value))}
                  />
                </td>
              ))}
              <td className="py-2 pr-4 whitespace-nowrap text-xs text-neutral-400">
                {row.source} · {row.updated_at}
              </td>
              <td className="py-2">
                <button onClick={() => handleSave(row)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
