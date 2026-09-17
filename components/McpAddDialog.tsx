"use client";

import { useState } from "react";
import { motion } from "framer-motion";

/**
 * Add a server by hand.
 *
 * URL transports only, and that is the security boundary rather than an
 * unfinished form: a stdio server is a command this machine will run, and
 * accepting one through an unauthenticated page would be remote code
 * execution. The dialog says so instead of quietly omitting the option.
 */
export interface ProjectOption {
  slug: string;
  name: string;
  dir: string;
}

export function McpAddDialog({
  onClose,
  onAdded,
  projects,
}: {
  onClose: () => void;
  onAdded: () => void;
  projects: ProjectOption[];
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"http" | "sse">("http");
  const [scope, setScope] = useState<"local" | "user" | "project">("user");
  const [projectDir, setProjectDir] = useState(projects[0]?.dir ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsProject = scope === "local" || scope === "project";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, transport, scope, projectDir: needsProject ? projectDir : undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Could not add the server.");
        return;
      }
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const field = { borderColor: "var(--line-hairline)" };

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="panel panel-accent">
      <header
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--line-hairline)" }}
      >
        <h3 className="label-mono" style={{ color: "var(--text-secondary)" }}>
          Add an MCP server
        </h3>
        <button onClick={onClose} className="label-mono hover:underline">
          Close ✕
        </button>
      </header>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sentry"
              className="font-data w-48 border px-2 py-1.5 text-sm outline-none"
              style={field}
            />
          </label>

          <label className="flex-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name && url && submit()}
              placeholder="https://mcp.sentry.dev/mcp"
              className="font-data w-full border px-2 py-1.5 text-sm outline-none"
              style={field}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">Transport</span>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as "http" | "sse")}
              className="border px-2 py-1.5 text-sm outline-none"
              style={field}
            >
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </label>

          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="mb-1 block">Scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "local" | "user" | "project")}
              className="border px-2 py-1.5 text-sm outline-none"
              style={field}
            >
              <option value="user">user — every project</option>
              <option value="local">local — one project, private</option>
              <option value="project">project — one project, via .mcp.json</option>
            </select>
          </label>

          {needsProject && (
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="mb-1 block">Project</span>
              <select
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
                className="max-w-xs border px-2 py-1.5 text-sm outline-none"
                style={field}
              >
                {projects.map((p) => (
                  <option key={p.slug} value={p.dir}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={submit}
            disabled={busy || !name.trim() || !url.trim() || (needsProject && !projectDir)}
            className="btn-accent"
          >
            {busy ? "Adding…" : "Add server"}
          </motion.button>
        </div>

        {needsProject && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            These scopes belong to a single project directory, so the server is written against the
            project you pick here rather than wherever this service happens to be running.
          </p>
        )}

        {error && (
          <p className="text-xs" style={{ color: "var(--danger-500, #ff6b6b)" }}>
            {error}
          </p>
        )}

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Only http and sse servers can be added here. A stdio server is a command run on this
          machine, so adding one through a web page with no login would be remote code execution —
          use <span className="font-data">claude mcp add name -- your-command</span> for those.
        </p>
      </div>
    </motion.div>
  );
}
