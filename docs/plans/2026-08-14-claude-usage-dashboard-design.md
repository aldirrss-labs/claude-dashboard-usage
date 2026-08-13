# Claude Code Usage Dashboard — Design

Date: 2026-08-14

## Purpose

A locally-hosted webapp that automatically tracks Claude Code token usage across every project on this machine, by reading Claude Code's own session logs (`~/.claude/projects/**/*.jsonl`). No manual logging, no per-project setup — it discovers projects and usage automatically.

## Goals

- Dashboard analytics: total usage, cost estimate, trends over time, cache efficiency.
- Project list + per-project, per-session drill-down.
- Runs as an always-on background service (systemd), not something launched manually per use.
- Minimal resource footprint — no continuous file watching, no idle CPU/network usage.

## Non-goals (v1)

- Multi-machine sync / cloud deployment.
- Real-time (sub-minute) data freshness — 5-minute ingestion delay is acceptable.
- Budget alerts, CSV/JSON export, and cross-project comparison are designed for structurally, but not built in v1 (see "Future / v1.1").

## Architecture

- **Framework:** Next.js (App Router), single app serving both UI and API routes.
- **Storage:** SQLite (`better-sqlite3`), file stored at `~/.claude-dashboard/usage.db` — outside the project source tree so it survives rebuilds/redeploys.
- **Data source:** read-only access to `~/.claude/projects/<project-slug>/*.jsonl`. Never writes back to Claude Code's own files.
- **Deployment:** `next build` with `output: 'standalone'`, run via `node server.js` under a systemd **user** service (no root needed), `Restart=on-failure`.

## Data pipeline (ingestion)

- Runs as a `setInterval` job inside the same Next.js process (no separate OS cron, no file watcher) — one process to manage as a systemd unit.
- Guarded against `next build`: static-generation workers import the root layout in parallel, and each would otherwise call the scheduler, causing concurrent SQLite writes (`SQLITE_BUSY`) and failing the build. The scheduler checks `process.env.NEXT_PHASE === "phase-production-build"` and no-ops during build.
- **Interval: 5 minutes.** Chosen to balance freshness against resource use (decided over both 1-min and real-time/SSE alternatives — see rationale below).
- Each run:
  1. Scan `~/.claude/projects/*/` for `.jsonl` files.
  2. For each file, read only new bytes since the last recorded offset (tracked in `ingest_state`) — avoids re-parsing multi-MB files every run.
  3. Parse new lines; keep only entries with `type: "assistant"` and a `message.usage` field.
  4. Insert one row per message into `usage_events`; upsert `projects` and `sessions` rows as needed.
  5. If a trailing line is incomplete (file being actively written), skip it and re-read from the same offset next run.
- Browser polls a `/api/summary`-style endpoint every 15–30s; that endpoint only reads from SQLite (cheap), it never touches the JSONL files directly. This keeps the UI reasonably fresh without needing SSE or a file watcher.

**Why not real-time (file watcher + SSE)?** A persistent `fs.watch`/chokidar watcher across 80+ project folders keeps file descriptors open continuously and is the kind of always-on background cost the user explicitly wants to avoid. Since ingestion itself only runs every 5 minutes, SSE on the browser side would add complexity without improving actual data freshness. Revisit only if 5-minute delay proves annoying in practice.

## Data model (SQLite)

```sql
CREATE TABLE ingest_state (
  file_path TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  last_byte_offset INTEGER NOT NULL DEFAULT 0,
  last_mtime TEXT,
  updated_at TEXT
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,       -- raw folder slug, e.g. "-mnt-data-Project-WEB-artist-catalog"
  display_path TEXT NOT NULL,      -- absolute path, read from the `cwd` field inside the JSONL lines (slug-to-path decoding is lossy: dashes are both the path separator AND can be literal characters in a folder name, e.g. "artist-catalog")
  display_name TEXT NOT NULL,      -- editable label, defaults to last path segment
  first_seen_at TEXT,
  last_active_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,             -- sessionId / jsonl filename uuid
  project_id INTEGER REFERENCES projects(id),
  started_at TEXT,
  ended_at TEXT,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  timestamp TEXT NOT NULL,
  model TEXT,                      -- "unknown" if absent
  input_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);
CREATE INDEX idx_usage_project_ts ON usage_events(project_id, timestamp);
CREATE INDEX idx_usage_session ON usage_events(session_id);

CREATE TABLE model_pricing (
  model TEXT PRIMARY KEY,
  input_price REAL,                -- USD per 1M input tokens
  cache_write_price REAL,
  cache_read_price REAL,
  output_price REAL,
  updated_at TEXT,
  source TEXT                      -- "manual" | "synced"
);

-- Reserved for v1.1
CREATE TABLE budget_limits (
  id INTEGER PRIMARY KEY,
  scope TEXT,                      -- "global" or a project slug
  period TEXT,                     -- "monthly" | "weekly"
  limit_usd REAL,
  created_at TEXT
);
```

Usage is stored granular (per message), not pre-aggregated, so any breakdown (by model, by session, by day/week/month, cache-efficiency ratios) is a `GROUP BY` query against one table rather than requiring re-parsing of source files.

## Pages

1. **Dashboard (`/`)** — summary cards (total tokens, cost this month, active projects, cache efficiency %), time-series chart (daily/weekly/monthly toggle, stacked by token type or model), top-projects table with sparklines, model-breakdown chart, global date-range filter.
2. **Project List (`/projects`)** — sortable/searchable table of all detected projects: usage, cost, last active, session count, mini-trend. Row selection reserved for future comparison view.
3. **Project Detail (`/projects/[slug]`)** — header stats, Overview tab (project-scoped trend + model breakdown), Sessions tab (list of sessions with per-session tokens/cost, expandable to per-message detail).
4. **Settings (`/settings`)** — editable pricing table with a "Sync Pricing" button; shows `source` and `updated_at` per model so staleness is visible; ingestion interval config (defaults to 5 min).

## Pricing sync

- No official public pricing API exists. `/api/pricing/sync` fetches Anthropic's public pricing page server-side and parses model prices out of it.
- This is inherently fragile (breaks if the page structure changes). On parse failure: show an error toast, keep existing DB values untouched — never overwrite with empty/bad data.
- Hardcoded seed data (current models: Sonnet 5, Opus 5, Haiku 4.5, etc.) ships as the default `model_pricing` rows so the dashboard is usable before any sync ever runs.

## Error handling / edge cases

- Incomplete trailing JSONL line (file mid-write): skip via parse try/catch, retry same offset next run.
- Non-usage lines (`user` messages, tool results, meta events like `queue-operation`): ignored during parsing.
- Missing `model` field: recorded as `"unknown"` rather than failing the insert.
- Project folder deleted/moved from disk: historical data is retained and still shown, project flagged as inactive rather than removed.

## Future / v1.1 (structurally prepared, not built now)

- `/compare` — side-by-side stats and overlaid charts for 2+ selected projects.
- CSV/JSON export — new API route querying existing tables, no schema change needed.
- Budget alerts — `budget_limits` table already defined; needs a check in the ingestion job or a computed API field plus a UI badge.
