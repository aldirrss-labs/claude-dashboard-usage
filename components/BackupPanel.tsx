"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";

export function BackupPanel({ onImported }: { onImported: () => void }) {
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/accounts/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: exportPassphrase }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Export failed.");
        return;
      }

      // The response is the file; turn it into a download without a round trip.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `claude-accounts-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setExportPassphrase("");
      setMessage("Export downloaded. Keep it somewhere safe — it holds live logins.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an export file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = JSON.parse(await file.text());
      const res = await fetch("/api/accounts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, passphrase: importPassphrase, overwrite }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Import failed.");
        return;
      }

      const parts = [
        json.added.length ? `${json.added.length} added` : null,
        json.updated.length ? `${json.updated.length} updated` : null,
        json.skipped.length ? `${json.skipped.length} already present` : null,
      ].filter(Boolean);
      setMessage(parts.length ? parts.join(", ") : "Nothing to import.");
      setImportPassphrase("");
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch {
      setError("That file is not valid JSON.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    borderColor: "var(--line-hairline)",
    background: "var(--surface-0)",
    color: "var(--text-primary)",
  };

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
      <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Backup
      </h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        An export contains working logins for every saved account, so it is always encrypted with a
        passphrase. Lose the passphrase and the file is unrecoverable — there is no reset.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="mb-1 block">Export passphrase (min 8 chars)</span>
          <input
            type="password"
            autoComplete="new-password"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
            className="w-56 rounded border px-2 py-1.5 text-sm outline-none"
            style={inputStyle}
          />
        </label>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleExport}
          disabled={busy || exportPassphrase.length < 8}
          className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent-500)" }}
        >
          Export accounts
        </motion.button>
      </div>

      <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--line-hairline)" }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">Import file</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="text-xs"
              style={{ color: "var(--text-primary)" }}
            />
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">Passphrase</span>
            <input
              type="password"
              autoComplete="off"
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
              className="w-56 rounded border px-2 py-1.5 text-sm outline-none"
              style={inputStyle}
            />
          </label>
          <button
            onClick={handleImport}
            disabled={busy || !importPassphrase}
            className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ ...inputStyle, borderColor: "var(--line-hairline)" }}
          >
            Import
          </button>
        </div>

        <label
          className="mt-2 flex items-center gap-1.5 text-xs"
          style={{ color: "var(--text-muted)" }}
          title="Off by default: a stored token may be newer than the one in the backup, and overwriting it with an older refresh token breaks the next refresh."
        >
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Overwrite accounts that already exist
        </label>
      </div>

      {message && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-primary)" }}>
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs" style={{ color: "var(--danger-500, #dc2626)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
