"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { AccountUsage } from "@/lib/claude-oauth";
import { formatRelativeTime } from "@/lib/format-usage";
import { UsageBars, UsageSummaryLine } from "./UsageBars";

export interface AccountListItem {
  id: number;
  label: string;
  email: string | null;
  organizationUuid: string;
  updatedAt: string;
  active: boolean;
  disabled: boolean;
  lastUsedAt: string | null;
  refreshTokenExpired: boolean;
  reloginRequired: boolean;
  usage: AccountUsage | null;
  usageFetchedAt: string | null;
  usageError: string | null;
  usageStale: boolean;
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

  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  async function runAction(id: number, fn: () => Promise<Response>) {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setActionError(await readError(res));
        return;
      }
      onRefetch();
    } finally {
      setBusyId(null);
    }
  }

  const handleSwitch = (id: number) => runAction(id, () => fetch(`/api/accounts/${id}/switch`, { method: "POST" }));

  const handleToggleDisabled = (id: number, disabled: boolean) =>
    runAction(id, () =>
      fetch(`/api/accounts/${id}/disabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      })
    );

  const handleRemove = (id: number) => runAction(id, () => fetch(`/api/accounts/${id}`, { method: "DELETE" }));

  async function handleConfirmRename(id: number) {
    const label = renameValue.trim();
    if (!label) return;
    setRenamingId(null);
    await runAction(id, () =>
      fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      })
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5" style={{ background: "var(--surface-1)", border: "1px solid var(--line-hairline)" }}>
        <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Save current session
        </h2>
        <div className="flex flex-wrap items-center gap-3">
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

      {actionError && (
        <p className="text-sm" style={{ color: "var(--danger-500, #dc2626)" }}>
          {actionError}
        </p>
      )}

      <div className="space-y-2">
        {accounts.map((account, index) => {
          const expanded = expandedId === account.id || account.active;
          const lastUsed = formatRelativeTime(account.lastUsedAt);
          const busy = busyId === account.id;

          return (
            <div
              key={account.id}
              className="rounded-xl p-4"
              style={{
                background: "var(--surface-1)",
                border: `1px solid ${account.active ? "var(--accent-500)" : "var(--line-hairline)"}`,
                opacity: account.disabled ? 0.6 : 1,
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-data text-xs" style={{ color: "var(--text-muted)" }}>
                      {index + 1}
                    </span>

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
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {account.email ?? account.label}
                      </span>
                    )}

                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      [{account.label}]
                    </span>

                    {account.active && (
                      <span className="text-xs font-medium" style={{ color: "var(--accent-500)" }}>
                        ● active
                      </span>
                    )}
                    {account.disabled && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        disabled
                      </span>
                    )}
                    {lastUsed && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        · {lastUsed}
                      </span>
                    )}
                  </div>

                  {!expanded && (
                    <div className="mt-1 pl-6">
                      <UsageSummaryLine usage={account.usage} />
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
                  <button
                    onClick={() => handleSwitch(account.id)}
                    disabled={account.active || busy}
                    className="font-medium hover:underline disabled:opacity-40"
                    style={{ color: "var(--accent-500)" }}
                  >
                    {busy ? "Working…" : "Switch"}
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded && !account.active ? null : account.id)}
                    disabled={account.active}
                    className="hover:underline disabled:opacity-40"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {expanded ? "Hide" : "Details"}
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
                    onClick={() => handleToggleDisabled(account.id, !account.disabled)}
                    disabled={busy}
                    className="hover:underline disabled:opacity-40"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {account.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    onClick={() => handleRemove(account.id)}
                    disabled={busy}
                    className="hover:underline disabled:opacity-40"
                    style={{ color: "var(--danger-500, #dc2626)" }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {account.reloginRequired && (
                <p className="mt-2 pl-6 text-xs" style={{ color: "var(--danger-500, #dc2626)" }}>
                  ⚠ re-login needed — refresh token dead; log in with Claude Code, then save this
                  session again to refresh the stored credentials.
                </p>
              )}

              {expanded && (
                <div className="mt-3 pl-6">
                  {account.usage ? (
                    <UsageBars usage={account.usage} dimmed={account.usageStale} />
                  ) : (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {account.disabled
                        ? "Disabled — not polled for usage."
                        : (account.usageError ?? "No usage data yet.")}
                    </p>
                  )}

                  {account.usage && account.usageError && (
                    <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      Showing last known values — {account.usageError}
                    </p>
                  )}

                  <p className="mt-2 font-data text-xs" style={{ color: "var(--text-muted)" }}>
                    org {account.organizationUuid}
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {accounts.length === 0 && (
          <p className="rounded-xl py-8 text-center text-sm" style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}>
            No accounts saved yet.
          </p>
        )}
      </div>
    </div>
  );
}
