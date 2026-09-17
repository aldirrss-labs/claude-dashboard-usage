"use client";

import { useState } from "react";
import { motion } from "framer-motion";

export interface AccountListItem {
  id: number;
  label: string;
  email: string | null;
  organizationUuid: string;
  updatedAt: string;
  active: boolean;
  refreshTokenExpired: boolean;
}

interface LiveSessionInfo {
  email: string | null;
  saved: boolean;
}

async function readError(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return typeof json.error === "string" ? json.error : `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function AccountsTable({
  accounts,
  live,
  onRefetch,
}: {
  accounts: AccountListItem[];
  live: LiveSessionInfo;
  onRefetch: () => void;
}) {
  const [newLabel, setNewLabel] = useState(live.email ?? "");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [removingId, setRemovingId] = useState<number | null>(null);

  async function handleSaveCurrentSession() {
    const label = newLabel.trim();
    if (!label) return;
    setSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        setAddError(await readError(res));
        return;
      }
      setNewLabel("");
      onRefetch();
    } finally {
      setSaving(false);
    }
  }

  async function handleSwitch(id: number) {
    setSwitchingId(id);
    setSwitchError(null);
    try {
      const res = await fetch(`/api/accounts/${id}/switch`, { method: "POST" });
      if (!res.ok) {
        setSwitchError(await readError(res));
        return;
      }
      onRefetch();
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleConfirmRename(id: number) {
    const label = renameValue.trim();
    if (!label) return;
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setRenamingId(null);
    onRefetch();
  }

  async function handleRemove(id: number) {
    setRemovingId(id);
    try {
      await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      onRefetch();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
        <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Save current session
        </h2>
        <div className="flex items-center gap-3">
          <input
            className="w-64 rounded border px-2 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface-0)", color: "var(--text-primary)" }}
            placeholder="Label (e.g. Kerja Tim A)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSaveCurrentSession}
            disabled={saving || !newLabel.trim()}
            className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent-500)" }}
          >
            {saving ? "Saving…" : "Save current session"}
          </motion.button>
          {live.saved && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Current session is already saved.
            </span>
          )}
        </div>
        {addError && (
          <p className="mt-2 text-xs" style={{ color: "var(--danger-500, #dc2626)" }}>
            {addError}
          </p>
        )}
      </div>

      {switchError && (
        <p className="text-sm" style={{ color: "var(--danger-500, #dc2626)" }}>
          {switchError}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ borderBottom: "1px solid var(--line-hairline)", color: "var(--text-muted)" }}>
            <th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide">Label</th>
            <th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide">Email</th>
            <th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide">Organization</th>
            <th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide">Status</th>
            <th className="py-2 pr-4 whitespace-nowrap text-xs font-medium uppercase tracking-wide">Last saved</th>
            <th className="py-2 text-xs font-medium uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <td className="py-2 pr-4">
                {renamingId === account.id ? (
                  <input
                    autoFocus
                    className="rounded border px-2 py-1 text-sm outline-none"
                    style={{ borderColor: "var(--line-hairline)", background: "var(--surface-0)", color: "var(--text-primary)" }}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmRename(account.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {account.label}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4" style={{ color: "var(--text-primary)" }}>
                {account.email ?? "—"}
              </td>
              <td className="font-data py-2 pr-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {account.organizationUuid}
              </td>
              <td className="py-2 pr-4 text-xs">
                {account.active ? (
                  <span style={{ color: "var(--accent-500)" }}>● Active now</span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>Saved</span>
                )}
                {account.refreshTokenExpired && (
                  <div style={{ color: "var(--danger-500, #dc2626)" }}>⚠ refresh token expired</div>
                )}
              </td>
              <td className="font-data py-2 pr-4 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                {account.updatedAt}
              </td>
              <td className="py-2 text-xs">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleSwitch(account.id)}
                    disabled={account.active || switchingId === account.id}
                    className="font-medium hover:underline disabled:opacity-50"
                    style={{ color: "var(--accent-500)" }}
                  >
                    {switchingId === account.id ? "Switching…" : "Switch"}
                  </button>
                  {renamingId === account.id ? (
                    <button
                      onClick={() => handleConfirmRename(account.id)}
                      className="font-medium hover:underline"
                      style={{ color: "var(--text-primary)" }}
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setRenamingId(account.id);
                        setRenameValue(account.label);
                      }}
                      className="hover:underline"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Rename
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(account.id)}
                    disabled={removingId === account.id}
                    className="hover:underline disabled:opacity-50"
                    style={{ color: "var(--danger-500, #dc2626)" }}
                  >
                    {removingId === account.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No accounts saved yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
