"use client";

import { useEffect, useState } from "react";

interface SyncButtonProps {
  onSynced?: () => void;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never synced";
  const diffMs = Date.now() - new Date(iso + "Z").getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  return `${diffHour}h ago`;
}

export function SyncButton({ onSynced }: SyncButtonProps) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ingest/status")
      .then((res) => res.json())
      .then((json) => setLastSyncedAt(json.lastSyncedAt))
      .catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest/sync", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Sync failed");
      setLastSyncedAt(json.syncedAt);
      onSynced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {error ?? formatRelativeTime(lastSyncedAt)}
      </span>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="rounded border px-3 py-1 text-sm font-medium disabled:opacity-50"
        style={{ borderColor: "var(--line-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
      >
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}
