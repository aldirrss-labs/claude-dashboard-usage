"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountsTable, type AccountListItem } from "@/components/AccountsTable";
import { AutoSwitchPanel } from "@/components/AutoSwitchPanel";
import { BackupPanel } from "@/components/BackupPanel";
import { MappingsPanel } from "@/components/MappingsPanel";
import { PageHeader } from "@/components/Panel";
import { formatRelativeTime } from "@/lib/format-usage";
import { usePersistentToggle } from "@/lib/use-persistent-toggle";

interface AccountsResponse {
  accounts: AccountListItem[];
  live: { email: string | null; saved: boolean };
}

const WATCH_INTERVAL_MS = 60_000;

export default function AccountsPage() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [watching, setWatching] = usePersistentToggle("accounts.watch");
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Rendered relative times ("2m ago") would otherwise freeze between fetches.
  const [, setTick] = useState(0);
  const inFlight = useRef(false);

  const refetch = useCallback(async (force = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/accounts${force ? "?refresh=1" : ""}`);
      setData(await res.json());
      setReloadKey((k) => k + 1);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  // Kept as an inline async load rather than a bare `refetch()` call so no
  // state is set synchronously in the effect body, and so a fetch still in
  // flight when the page unmounts is dropped instead of setting state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      if (cancelled) return;
      setData(json);
      setReloadKey((k) => k + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => refetch(true), WATCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [watching, refetch]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>
        Loading accounts…
      </div>
    );
  }

  const lastFetched = data.accounts
    .map((a) => a.usageFetchedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader
        kicker={`${data.accounts.length} saved · quota ${lastFetched ? (formatRelativeTime(lastFetched) ?? "just now") : "not fetched"}`}
        title="Accounts"
        action={
          <>
            <label className="label-mono flex items-center gap-1.5">
              <input type="checkbox" checked={watching} onChange={(e) => setWatching(e.target.checked)} />
              Watch
            </label>
            <button onClick={() => refetch(true)} disabled={refreshing} className="btn-ghost">
              {refreshing ? "Refreshing…" : "Refresh usage"}
            </button>
          </>
        }
      />

      <AutoSwitchPanel onSwitched={() => refetch(true)} reloadKey={reloadKey} />
      <AccountsTable accounts={data.accounts} live={data.live} onRefetch={() => refetch(true)} />
      <MappingsPanel
        accounts={data.accounts.map((a) => ({ id: a.id, label: a.label, email: a.email }))}
        reloadKey={reloadKey}
      />
      <BackupPanel onImported={() => refetch(true)} />
    </main>
  );
}
