"use client";

import { useEffect, useState } from "react";

interface DetailResponse {
  server: {
    name: string;
    url: string | null;
    transport: string | null;
    status: string;
    statusLabel: string;
    scope: string;
    isConnector: boolean;
  } | null;
  fields: Record<string, string>;
  raw: string;
  catalog: {
    name: string;
    title: string;
    description: string;
    version: string | null;
    remotes?: Array<{ type: string; url: string }>;
    packages?: string[];
    repository?: string;
    website?: string;
    updatedAt: string | null;
  } | null;
  removeCommand: string;
  error?: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 py-1.5" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
      <span className="label-mono w-36 shrink-0">{label}</span>
      <span className="font-data min-w-0 flex-1 text-xs break-all" style={{ color: "var(--text-primary)" }}>
        {children}
      </span>
    </div>
  );
}

/**
 * Everything known about one server, from both sides: what this machine has
 * configured, and what the registry says the thing actually is. The local
 * config alone cannot tell you what a server does or who publishes it.
 */
export function McpServerDetail({
  name,
  onClose,
  onChanged,
}: {
  name: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/mcp/${encodeURIComponent(name)}`);
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(typeof json.error === "string" ? json.error : "Could not load details.");
      else setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  async function act(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Command failed.");
        return;
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-accent">
      <header
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--line-hairline)" }}
      >
        <h3 className="font-data text-sm" style={{ color: "var(--text-primary)" }}>
          {name}
        </h3>
        <button onClick={onClose} className="label-mono hover:underline">
          Close ✕
        </button>
      </header>

      <div className="p-4">
        {error && (
          <p className="mb-3 text-xs" style={{ color: "var(--danger-500, #ff6b6b)" }}>
            {error}
          </p>
        )}

        {!data && !error && <p className="label-mono">Loading…</p>}

        {data && (
          <>
            <p className="label-mono mb-2">On this machine</p>
            <div className="mb-4">
              {data.server && <Row label="Status">{data.server.statusLabel}</Row>}
              {Object.entries(data.fields).map(([key, value]) => (
                <Row key={key} label={key}>
                  {value}
                </Row>
              ))}
              {data.server?.transport && <Row label="Transport">{data.server.transport}</Row>}
            </div>

            {data.catalog ? (
              <>
                <p className="label-mono mb-2">From the registry</p>
                <div className="mb-4">
                  <Row label="Registry name">{data.catalog.name}</Row>
                  {data.catalog.version && <Row label="Version">{data.catalog.version}</Row>}
                  {data.catalog.description && <Row label="Description">{data.catalog.description}</Row>}
                  {data.catalog.updatedAt && (
                    <Row label="Updated">{data.catalog.updatedAt.slice(0, 10)}</Row>
                  )}
                  {data.catalog.repository && (
                    <Row label="Source">
                      <a
                        href={data.catalog.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        style={{ color: "var(--accent-500)" }}
                      >
                        {data.catalog.repository}
                      </a>
                    </Row>
                  )}
                  {(data.catalog.remotes?.length ?? 0) > 1 && (
                    <Row label="Other endpoints">
                      {data.catalog
                        .remotes!.slice(1)
                        .map((r) => `${r.type} ${r.url}`)
                        .join(" · ")}
                    </Row>
                  )}
                  {(data.catalog.packages?.length ?? 0) > 0 && (
                    <Row label="Also published as">{data.catalog.packages!.join(" · ")}</Row>
                  )}
                </div>
              </>
            ) : (
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                No registry entry matches this server, by name or by endpoint — it was probably added
                by hand, or is not published to the public registry.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {data.server?.status !== "connected" && (
                <span className="label-mono">Use “Log in” on the list to authenticate</span>
              )}
              {data.server?.status === "connected" && (
                <button
                  onClick={() =>
                    act(() =>
                      fetch(`/api/mcp/${encodeURIComponent(name)}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "logout" }),
                      })
                    )
                  }
                  disabled={busy}
                  className="btn-ghost"
                >
                  Clear authentication
                </button>
              )}
              {data.server && !data.server.isConnector && (
                <button
                  onClick={() => act(() => fetch(`/api/mcp/${encodeURIComponent(name)}`, { method: "DELETE" }))}
                  disabled={busy}
                  className="btn-ghost"
                  style={{ color: "var(--danger-500, #ff6b6b)", borderColor: "var(--danger-500, #ff6b6b)" }}
                >
                  Remove
                </button>
              )}
              <button onClick={() => setShowRaw(!showRaw)} className="btn-ghost">
                {showRaw ? "Hide" : "Raw output"}
              </button>
            </div>

            {showRaw && (
              <pre
                className="font-data mt-3 overflow-x-auto p-3 text-xs"
                style={{ background: "var(--surface-0)", color: "var(--text-secondary)" }}
              >
                {data.raw.trim()}
              </pre>
            )}

            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Tool listings are not shown yet — that needs an MCP handshake against the server using
              its stored OAuth token, which is a separate piece of work from configuration.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
