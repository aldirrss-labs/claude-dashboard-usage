"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountsTable, type AccountListItem } from "@/components/AccountsTable";

interface AccountsResponse {
  accounts: AccountListItem[];
  live: { email: string | null; saved: boolean };
}

export default function AccountsPage() {
  const [data, setData] = useState<AccountsResponse | null>(null);

  const refetch = useCallback(() => {
    fetch("/api/accounts")
      .then((res) => res.json())
      .then((json) => setData(json));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  if (!data) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>
        Loading accounts…
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Accounts
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Store credentials for multiple Claude accounts on this machine and switch which one is
          active.
        </p>
      </div>
      <AccountsTable accounts={data.accounts} live={data.live} onRefetch={refetch} />
    </main>
  );
}
