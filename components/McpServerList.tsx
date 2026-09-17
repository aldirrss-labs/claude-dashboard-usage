"use client";

import { useState } from "react";
import { motion } from "framer-motion";

export interface McpServer {
  name: string;
  url: string | null;
  transport: string | null;
  status: "connected" | "needs-auth" | "failed" | "pending-approval" | "unknown";
  statusLabel: string;
  scope: "local" | "user" | "project" | "connector" | "unknown";
  isConnector: boolean;
}

const STATUS_HUE: Record<McpServer["status"], string> = {
  connected: "var(--accent-500)",
  "needs-auth": "var(--warning-500, #ffb454)",
  failed: "var(--danger-500, #ff6b6b)",
  "pending-approval": "var(--text-muted)",
  unknown: "var(--text-muted)",
};

const SCOPE_NOTE: Record<McpServer["scope"], string> = {
  user: "every project on this machine",
  local: "this project only",
  project: "shared through .mcp.json",
  connector: "bound to your Claude account, managed on claude.ai",
  unknown: "scope unknown",
};

async function readError(res: Response): Promise<{ error: string; fallbackCommand?: string }> {
  try {
    const json = await res.json();
    return {
      error: typeof json.error === "string" ? json.error : `Request failed (${res.status})`,
      fallbackCommand: typeof json.fallbackCommand === "string" ? json.fallbackCommand : undefined,
    };
  } catch {
    return { error: `Request failed (${res.status})` };
  }
}

export function McpServerList({ servers, onChanged }: { servers: McpServer[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ name: string; text: string; tone: "ok" | "error" } | null>(null);
  const [login, setLogin] = useState<{ name: string; authUrl: string; redirect: string } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  const encoded = (name: string) => encodeURIComponent(name);

  async function startLogin(name: string) {
    setBusy(name);
    setMessage(null);
    setFallback(null);
    try {
      const res = await fetch(`/api/mcp/${encoded(name)}/login`, { method: "POST" });
      if (!res.ok) {
        const { error, fallbackCommand } = await readError(res);
        setMessage({ name, text: error, tone: "error" });
        setFallback(fallbackCommand ?? null);
        return;
      }
      const json = await res.json();
      setLogin({ name, authUrl: json.authUrl, redirect: "" });
    } finally {
      setBusy(null);
    }
  }

  async function finishLogin() {
    if (!login) return;
    setBusy(login.name);
    try {
      const res = await fetch(`/api/mcp/${encoded(login.name)}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUrl: login.redirect }),
      });
      if (!res.ok) {
        const { error, fallbackCommand } = await readError(res);
        setMessage({ name: login.name, text: error, tone: "error" });
        setFallback(fallbackCommand ?? null);
        return;
      }
      setMessage({ name: login.name, text: "Authenticated.", tone: "ok" });
      setLogin(null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function cancelLogin() {
    if (!login) return;
    await fetch(`/api/mcp/${encoded(login.name)}/login`, { method: "DELETE" });
    setLogin(null);
  }

  async function runAction(name: string, fn: () => Promise<Response>, okText: string) {
    setBusy(name);
    setMessage(null);
    setFallback(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const { error } = await readError(res);
        setMessage({ name, text: error, tone: "error" });
        return;
      }
      setMessage({ name, text: okText, tone: "ok" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const groups = (
    [
      { scope: "user", title: "User scope" },
      { scope: "local", title: "Local scope" },
      { scope: "project", title: "Project scope" },
      { scope: "connector", title: "claude.ai connectors" },
    ] satisfies Array<{ scope: McpServer["scope"]; title: string }>
  )
    .map((group) => ({
      ...group,
      rows: servers.filter((s) =>
        group.scope === "connector" ? s.isConnector : !s.isConnector && s.scope === group.scope
      ),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.scope}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="label-mono" style={{ color: "var(--text-secondary)" }}>
              {group.title}
            </h3>
            <span className="label-mono">
              {group.rows.length} · {SCOPE_NOTE[group.scope]}
            </span>
          </div>

          <div style={{ border: "1px solid var(--line-hairline)" }}>
            {group.rows.map((server, index) => (
              <div
                key={server.name}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                style={{ borderTop: index === 0 ? undefined : "1px solid var(--line-hairline)" }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className="inline-block h-2 w-2 shrink-0"
                      style={{ background: STATUS_HUE[server.status] }}
                    />
                    <span className="font-data text-sm" style={{ color: "var(--text-primary)" }}>
                      {server.name}
                    </span>
                    {server.transport && <span className="label-mono">{server.transport}</span>}
                    <span className="label-mono" style={{ color: STATUS_HUE[server.status] }}>
                      {server.statusLabel}
                    </span>
                  </div>
                  {server.url && (
                    <p className="font-data mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {server.url}
                    </p>
                  )}
                  {message?.name === server.name && (
                    <p
                      className="mt-1 text-xs"
                      style={{ color: message.tone === "ok" ? "var(--accent-500)" : "var(--danger-500, #ff6b6b)" }}
                    >
                      {message.text}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
                  {server.status !== "connected" && (
                    <button
                      onClick={() => startLogin(server.name)}
                      disabled={busy === server.name}
                      className="font-medium hover:underline disabled:opacity-40"
                      style={{ color: "var(--accent-500)" }}
                    >
                      {busy === server.name ? "Working…" : "Log in"}
                    </button>
                  )}
                  {server.status === "connected" && (
                    <button
                      onClick={() =>
                        runAction(
                          server.name,
                          () =>
                            fetch(`/api/mcp/${encoded(server.name)}`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "logout" }),
                            }),
                          "Signed out."
                        )
                      }
                      disabled={busy === server.name}
                      className="hover:underline disabled:opacity-40"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Log out
                    </button>
                  )}
                  {!server.isConnector && (
                    <button
                      onClick={() =>
                        runAction(
                          server.name,
                          () => fetch(`/api/mcp/${encoded(server.name)}`, { method: "DELETE" }),
                          "Removed."
                        )
                      }
                      disabled={busy === server.name}
                      className="hover:underline disabled:opacity-40"
                      style={{ color: "var(--danger-500, #ff6b6b)" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {fallback && (
        <div className="panel p-4">
          <p className="label-mono mb-2">Run this in a terminal instead</p>
          <pre
            className="font-data overflow-x-auto p-2 text-xs"
            style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
          >
            {fallback}
          </pre>
        </div>
      )}

      {login && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel panel-accent p-4"
        >
          <p className="label-mono mb-2">Authorising {login.name}</p>
          <ol className="space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <li>
              1. Open this URL and approve access:
              <a
                href={login.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-data ml-2 break-all hover:underline"
                style={{ color: "var(--accent-500)" }}
              >
                {login.authUrl}
              </a>
            </li>
            <li>
              2. You will land on a page that may fail to load — that is expected. Copy the full URL
              from the address bar and paste it below.
            </li>
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              autoFocus
              value={login.redirect}
              onChange={(e) => setLogin({ ...login, redirect: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && finishLogin()}
              placeholder="Paste the redirect URL"
              className="font-data flex-1 border px-2 py-1.5 text-xs outline-none"
              style={{ minWidth: 280, borderColor: "var(--line-hairline)" }}
            />
            <button onClick={finishLogin} disabled={!login.redirect.trim() || busy !== null} className="btn-accent">
              Finish
            </button>
            <button onClick={cancelLogin} className="btn-ghost">
              Cancel
            </button>
          </div>

          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            The CLI is waiting on this. If you abandon it, it is closed automatically after five
            minutes.
          </p>
        </motion.div>
      )}
    </div>
  );
}
