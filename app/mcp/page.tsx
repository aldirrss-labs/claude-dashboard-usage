"use client";

import { useCallback, useEffect, useState } from "react";
import { Figure, PageHeader, Panel } from "@/components/Panel";
import { McpServerList, type McpServer } from "@/components/McpServerList";

interface McpResponse {
  servers: McpServer[];
  summary: { total: number; connected: number; needsAuth: number; connectors: number };
  error?: string;
}

export default function McpPage() {
  const [data, setData] = useState<McpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/mcp${force ? "?refresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Could not list MCP servers.");
        return;
      }
      setError(null);
      setData(json);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/mcp");
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(typeof json.error === "string" ? json.error : "Could not list MCP servers.");
      else setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && !data) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <PageHeader kicker="Model Context Protocol" title="MCP" />
        <Panel label="Unavailable" index={1}>
          <p className="text-sm" style={{ color: "var(--danger-500, #ff6b6b)" }}>
            {error}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            This room drives the `claude` CLI. If the service cannot find it, re-run
            <span className="font-data"> deploy/install.sh</span> — it resolves the binary and writes
            the path into the systemd unit.
          </p>
        </Panel>
      </main>
    );
  }

  if (!data) {
    return <div className="label-mono p-8">Checking MCP server health…</div>;
  }

  const { summary } = data;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <PageHeader
        kicker="Model Context Protocol"
        title="MCP"
        action={
          <button onClick={() => load(true)} disabled={refreshing} className="btn-ghost">
            {refreshing ? "Checking…" : "Re-check health"}
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Panel className="md:col-span-4" accent>
          <Figure label="Configured" value={String(summary.total)} scale="md" hint={`${summary.connectors} claude.ai connectors`} />
        </Panel>
        <Panel className="md:col-span-4 md:mt-6">
          <Figure label="Connected" value={String(summary.connected)} scale="sm" tone="accent" />
        </Panel>
        <Panel className="md:col-span-4">
          <Figure
            label="Needs authentication"
            value={String(summary.needsAuth)}
            scale="sm"
            hint={summary.needsAuth > 0 ? "these are configured but unusable" : undefined}
          />
        </Panel>

        <Panel label="Servers" index={1} className="md:col-span-12">
          <McpServerList servers={data.servers} onChanged={() => load(true)} />
        </Panel>
      </div>

      <p className="mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
        Changes here run the `claude mcp` CLI rather than editing `~/.claude.json` directly, so
        machine-wide state — other servers&apos; logins in particular — is never clobbered. Adding a
        new server is deliberately not offered yet: a stdio server is an arbitrary command, and this
        dashboard has no authentication.
      </p>
    </main>
  );
}
