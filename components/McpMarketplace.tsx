"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface CatalogRemote {
  type: string;
  url: string;
}

interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  version: string | null;
  remotes?: CatalogRemote[];
  packages?: string[];
  repository?: string;
  website?: string;
  updatedAt: string | null;
}

interface CatalogResponse {
  entries: CatalogEntry[];
  total: number;
  offset: number;
  limit: number;
  meta: { source: string; fetchedAt: string; count: number; installableCount: number };
  installedNames: string[];
  error?: string;
}

const PAGE_SIZE = 30;

export function McpMarketplace({ onInstalled }: { onInstalled: () => void }) {
  const [query, setQuery] = useState("");
  const [installableOnly, setInstallableOnly] = useState(true);
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ name: string; text: string; tone: "ok" | "error" } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (q: string, off: number, installable: boolean) => {
      const params = new URLSearchParams({
        q,
        offset: String(off),
        limit: String(PAGE_SIZE),
        installable: installable ? "1" : "0",
      });
      const res = await fetch(`/api/mcp/catalog?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Catalogue search failed.");
        return;
      }
      setError(null);
      setData(json);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/mcp/catalog?limit=${PAGE_SIZE}&installable=1`);
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(typeof json.error === "string" ? json.error : "Catalogue unavailable.");
      else setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced so typing does not fire a request per keystroke against 32k rows.
  function onQueryChange(value: string) {
    setQuery(value);
    setOffset(0);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(value, 0, installableOnly), 200);
  }

  function toggleInstallable(next: boolean) {
    setInstallableOnly(next);
    setOffset(0);
    search(query, 0, next);
  }

  function goto(next: number) {
    setOffset(next);
    search(query, next, installableOnly);
  }

  async function install(entry: CatalogEntry) {
    const remote = entry.remotes?.[0];
    if (!remote) return;

    setBusy(entry.name);
    setNote(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Registry names are namespaced ("io.github.owner/thing"); the local
          // name has to be something the CLI and config will accept.
          name: entry.name.split("/").pop()?.replace(/[^A-Za-z0-9 ._-]/g, "-") ?? entry.name,
          url: remote.url,
          transport: remote.type,
          scope: "user",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNote({ name: entry.name, text: json.error ?? "Install failed.", tone: "error" });
        return;
      }
      setNote({ name: entry.name, text: "Installed into user scope.", tone: "ok" });
      onInstalled();
      search(query, offset, installableOnly);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div>
        <p className="text-sm" style={{ color: "var(--danger-500, #ff6b6b)" }}>
          {error}
        </p>
      </div>
    );
  }
  if (!data) return <p className="label-mono">Loading catalogue…</p>;

  const installed = new Set(data.installedNames);
  const page = Math.floor(data.offset / data.limit) + 1;
  const pages = Math.max(Math.ceil(data.total / data.limit), 1);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search 32,443 servers…"
          className="font-data flex-1 border px-3 py-2 text-sm outline-none"
          style={{ minWidth: 240, borderColor: "var(--line-hairline)" }}
        />
        <label className="label-mono flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={installableOnly}
            onChange={(e) => toggleInstallable(e.target.checked)}
          />
          Installable only
        </label>
      </div>

      <p className="label-mono mb-3">
        {data.total.toLocaleString()} match · page {page} of {pages.toLocaleString()} ·{" "}
        {data.meta.installableCount.toLocaleString()} of {data.meta.count.toLocaleString()} have a URL
        endpoint · snapshot {data.meta.fetchedAt.slice(0, 10)}
      </p>

      <div style={{ border: "1px solid var(--line-hairline)" }}>
        {data.entries.map((entry, index) => {
          const remote = entry.remotes?.[0];
          const localName = entry.name.split("/").pop() ?? entry.name;
          const already = installed.has(localName) || installed.has(entry.name);

          return (
            <div
              key={entry.name}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              style={{ borderTop: index === 0 ? undefined : "1px solid var(--line-hairline)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-data text-sm" style={{ color: "var(--text-primary)" }}>
                    {entry.title}
                  </span>
                  {entry.version && <span className="label-mono">v{entry.version}</span>}
                  {remote && <span className="label-mono">{remote.type}</span>}
                  {!remote && (
                    <span className="label-mono" style={{ color: "var(--warning-500, #ffb454)" }}>
                      runs a local command
                    </span>
                  )}
                </div>
                <p className="font-data mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {entry.name}
                </p>
                {entry.description && (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {entry.description}
                  </p>
                )}
                {remote && (
                  <p className="font-data mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {remote.url}
                  </p>
                )}
                {note?.name === entry.name && (
                  <p
                    className="mt-1 text-xs"
                    style={{ color: note.tone === "ok" ? "var(--accent-500)" : "var(--danger-500, #ff6b6b)" }}
                  >
                    {note.text}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3 text-xs">
                {entry.repository && (
                  <a
                    href={entry.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Source ↗
                  </a>
                )}
                {already ? (
                  <span className="label-mono" style={{ color: "var(--accent-500)" }}>
                    Installed
                  </span>
                ) : remote ? (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => install(entry)}
                    disabled={busy === entry.name}
                    className="btn-accent"
                  >
                    {busy === entry.name ? "Installing…" : "Install"}
                  </motion.button>
                ) : (
                  <span className="label-mono" title="stdio servers execute a command; add those with the CLI">
                    CLI only
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {data.entries.length === 0 && <p className="label-mono p-4">Nothing matches that search.</p>}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => goto(Math.max(offset - PAGE_SIZE, 0))} disabled={offset === 0} className="btn-ghost">
            Previous
          </button>
          <button
            onClick={() => goto(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= data.total}
            className="btn-ghost"
          >
            Next
          </button>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Installs go into <span className="font-data">user</span> scope, and only servers reachable
        over a URL can be installed from here. A stdio server is an arbitrary command run on your
        machine — adding one through a web page with no login would be remote code execution, so
        those are left to the CLI. Refresh the snapshot with{" "}
        <span className="font-data">npm run sync:mcp</span>.
      </p>
    </div>
  );
}
