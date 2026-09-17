"use client";

import { useCallback, useEffect, useState } from "react";
import { Figure, PageHeader, Panel } from "@/components/Panel";
import { McpServerList, type McpServer } from "@/components/McpServerList";
import { McpMarketplace } from "@/components/McpMarketplace";
import { McpAddDialog } from "@/components/McpAddDialog";
import { McpServerDetail } from "@/components/McpServerDetail";
import { usePersistentToggle } from "@/lib/use-persistent-toggle";

interface McpResponse {
  servers: McpServer[];
  summary: { total: number; connected: number; needsAuth: number; connectors: number };
  projects: Array<{ slug: string; name: string; dir: string }>;
}

export default function McpPage() {
  // Persisted, so the room reopens on the tab you were last using.
  const [onMarketplace, setOnMarketplace] = usePersistentToggle("mcp.marketplace");
  const [data, setData] = useState<McpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/mcp${force ? "?refresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) setError(typeof json.error === "string" ? json.error : "Could not list MCP servers.");
      else {
        setError(null);
        setData(json);
      }
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

  const summary = data?.summary;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <PageHeader
        kicker="Model Context Protocol"
        title="MCP"
        action={
          <>
            <button onClick={() => setAdding(true)} className="btn-accent">
              + Add MCP
            </button>
            {!onMarketplace && (
              <button onClick={() => load(true)} disabled={refreshing} className="btn-ghost">
                {refreshing ? "Checking…" : "Re-check health"}
              </button>
            )}
          </>
        }
      />

      {/* Two rooms within the room: what you have, and what exists. */}
      <div className="mb-4 flex" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
        {[
          { key: "local", label: "Local", active: !onMarketplace },
          { key: "marketplace", label: "Marketplace", active: onMarketplace },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setOnMarketplace(tab.key === "marketplace")}
            className="label-mono px-4 py-2.5"
            style={{
              color: tab.active ? "var(--accent-500)" : "var(--text-muted)",
              borderBottom: `2px solid ${tab.active ? "var(--accent-500)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {adding && (
        <div className="mb-4">
          <McpAddDialog
            onClose={() => setAdding(false)}
            onAdded={() => load(true)}
            projects={data?.projects ?? []}
          />
        </div>
      )}

      {detailFor && (
        <div className="mb-4">
          <McpServerDetail name={detailFor} onClose={() => setDetailFor(null)} onChanged={() => load(true)} />
        </div>
      )}

      {onMarketplace ? (
        <Panel label="Registry" index={1}>
          <McpMarketplace onInstalled={() => load(true)} />
        </Panel>
      ) : error ? (
        <Panel label="Unavailable" index={1}>
          <p className="text-sm" style={{ color: "var(--danger-500, #ff6b6b)" }}>
            {error}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            This room drives the <span className="font-data">claude</span> CLI. If the service cannot
            find it, re-run <span className="font-data">deploy/install.sh</span> — it resolves the
            binary and writes the path into the systemd unit.
          </p>
        </Panel>
      ) : !data || !summary ? (
        <p className="label-mono">Checking MCP server health…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <Panel className="md:col-span-4" accent>
            <Figure
              label="Configured"
              value={String(summary.total)}
              scale="md"
              hint={`${summary.connectors} claude.ai connectors`}
            />
          </Panel>
          <Panel className="md:col-span-4 md:mt-6">
            <Figure label="Connected" value={String(summary.connected)} scale="sm" tone="accent" />
          </Panel>
          <Panel className="md:col-span-4">
            <Figure
              label="Needs authentication"
              value={String(summary.needsAuth)}
              scale="sm"
              hint={summary.needsAuth > 0 ? "configured but unusable" : undefined}
            />
          </Panel>

          <Panel label="Servers" index={1} className="md:col-span-12">
            <McpServerList
              servers={data.servers}
              onChanged={() => load(true)}
              onInspect={(name) => setDetailFor(name)}
            />
          </Panel>
        </div>
      )}
    </main>
  );
}
