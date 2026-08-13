# Claude Code Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js webapp that automatically ingests Claude Code's local session logs (`~/.claude/projects/**/*.jsonl`), stores per-message token usage in SQLite, and presents dashboard analytics, project list, project detail (per-session), and pricing settings pages — running as an always-on systemd service.

**Architecture:** Single Next.js (App Router) app. A `setInterval`-driven ingestion job (inside the same process) incrementally tails JSONL files by byte offset every 5 minutes and writes granular per-message rows into SQLite (`better-sqlite3`). All pages/API routes read only from SQLite, never from JSONL directly. Deployed via `next build` (`output: 'standalone'`) run under a systemd user service.

**Tech Stack:** Next.js 15 (App Router, TypeScript), better-sqlite3, Tailwind CSS, Recharts (for charts, per dataviz conventions), Node 24.

**Spec:** [docs/plans/2026-08-14-claude-usage-dashboard-design.md](../../plans/2026-08-14-claude-usage-dashboard-design.md)

## Global Constraints

- Data source is read-only: never write back to `~/.claude/projects/**`.
- Ingestion runs on a 5-minute interval inside the Next.js process — no separate cron process, no `fs.watch`/file-watcher.
- Database file lives at `~/.claude-dashboard/usage.db`, outside the project source tree, so rebuilds never wipe historical data.
- Browser refresh is via polling (15-30s), not SSE.
- Usage is stored granular (one row per assistant message with `usage`), never pre-aggregated only.
- Pricing sync must never overwrite existing `model_pricing` rows with empty/failed data — keep last-good values on failure.
- All UI text, code, comments, and identifiers are in English.

---

## File Structure

```
claude-dashboard-usage/
├── next.config.ts                     # output: 'standalone'
├── package.json
├── tsconfig.json
├── src/
│   ├── lib/
│   │   ├── db.ts                      # SQLite connection singleton + schema migration
│   │   ├── paths.ts                   # slug <-> absolute path decoding, DB file location
│   │   ├── ingest.ts                  # core ingestion: scan, tail, parse, upsert
│   │   ├── ingest-scheduler.ts        # setInterval wrapper, started once on server boot
│   │   ├── queries.ts                 # all read queries used by API routes (aggregations)
│   │   └── pricing-seed.ts            # hardcoded default model_pricing rows
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   # Dashboard
│   │   ├── projects/
│   │   │   ├── page.tsx               # Project List
│   │   │   └── [slug]/page.tsx        # Project Detail
│   │   ├── settings/page.tsx          # Settings (pricing)
│   │   └── api/
│   │       ├── summary/route.ts       # GET dashboard summary + timeseries
│   │       ├── projects/route.ts      # GET project list
│   │       ├── projects/[slug]/route.ts   # GET project detail + sessions
│   │       └── pricing/
│   │           ├── route.ts           # GET/PUT model_pricing rows
│   │           └── sync/route.ts      # POST triggers pricing scrape
│   └── components/
│       ├── SummaryCard.tsx
│       ├── UsageTimeSeriesChart.tsx
│       ├── ModelBreakdownChart.tsx
│       └── ProjectTable.tsx
├── scripts/
│   └── init-db.ts                     # one-off manual DB init (also runs lazily via db.ts)
├── deploy/
│   └── claude-dashboard.service       # systemd unit file
└── docs/
    ├── plans/2026-08-14-claude-usage-dashboard-design.md
    └── superpowers/plans/2026-08-14-claude-usage-dashboard.md
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `.gitignore`

**Interfaces:**
- Produces: a running Next.js dev server at `http://localhost:3000` rendering a placeholder page. Later tasks replace `src/app/page.tsx`.

- [ ] **Step 1: Scaffold Next.js app**

```bash
cd /mnt/data/Project/WEB/claude-dashboard-usage
npx --yes create-next-app@latest . --typescript --tailwind --app --no-src-dir=false --import-alias "@/*" --eslint --use-npm --yes
```

If the CLI prompts anything interactively despite `--yes`, answer: ESLint yes, Tailwind yes, `src/` directory yes, App Router yes, no Turbopack customization needed, import alias `@/*`.

- [ ] **Step 2: Set standalone output mode**

Edit `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 3: Install runtime dependencies**

```bash
npm install better-sqlite3 recharts
npm install -D @types/better-sqlite3 tsx
```

- [ ] **Step 4: Verify dev server boots**

Run: `npm run build`
Expected: build completes with no errors, `.next/standalone` directory created.

- [ ] **Step 5: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js app with standalone output"
```

---

## Task 2: Database Layer — Schema & Connection

**Files:**
- Create: `src/lib/paths.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/pricing-seed.ts`
- Test: `src/lib/__tests__/db.test.ts`

**Interfaces:**
- Produces:
  - `getDbPath(): string` — returns `~/.claude-dashboard/usage.db`, creating the parent dir if missing.
  - `getClaudeProjectsDir(): string` — returns `~/.claude/projects`.
  - `decodeProjectSlug(slug: string): string` — converts `-mnt-data-Project-WEB-artist-catalog` to `/mnt/data/Project/WEB/artist-catalog`.
  - `getDb(): Database.Database` (from `better-sqlite3`) — singleton connection, runs migrations on first call.
  - `DEFAULT_PRICING: Array<{model: string, input_price: number, cache_write_price: number, cache_read_price: number, output_price: number}>` from `pricing-seed.ts`.
- Consumes: nothing (foundational layer).

- [ ] **Step 1: Write failing test for path helpers**

```typescript
// src/lib/__tests__/db.test.ts
import { describe, it, expect } from "node:test";
import assert from "node:assert";
import { decodeProjectSlug } from "../paths";

describe("decodeProjectSlug", () => {
  it("converts a project slug into an absolute path", () => {
    const result = decodeProjectSlug("-mnt-data-Project-WEB-artist-catalog");
    assert.strictEqual(result, "/mnt/data/Project/WEB/artist-catalog");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/__tests__/db.test.ts`
Expected: FAIL — `../paths` module not found.

- [ ] **Step 3: Implement `src/lib/paths.ts`**

```typescript
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function getDashboardDataDir(): string {
  const dir = path.join(os.homedir(), ".claude-dashboard");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDbPath(): string {
  return path.join(getDashboardDataDir(), "usage.db");
}

export function decodeProjectSlug(slug: string): string {
  return slug.replace(/-/g, "/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/__tests__/db.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `src/lib/pricing-seed.ts`**

```typescript
export interface PricingSeed {
  model: string;
  input_price: number;        // USD per 1M input tokens
  cache_write_price: number;  // USD per 1M cache-creation tokens
  cache_read_price: number;   // USD per 1M cache-read tokens
  output_price: number;       // USD per 1M output tokens
}

export const DEFAULT_PRICING: PricingSeed[] = [
  { model: "claude-opus-5", input_price: 15, cache_write_price: 18.75, cache_read_price: 1.5, output_price: 75 },
  { model: "claude-sonnet-5", input_price: 3, cache_write_price: 3.75, cache_read_price: 0.3, output_price: 15 },
  { model: "claude-haiku-4-5-20251001", input_price: 0.8, cache_write_price: 1, cache_read_price: 0.08, output_price: 4 },
  { model: "unknown", input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 },
];
```

- [ ] **Step 6: Implement `src/lib/db.ts`**

```typescript
import Database from "better-sqlite3";
import { getDbPath } from "./paths";
import { DEFAULT_PRICING } from "./pricing-seed";

let dbInstance: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ingest_state (
  file_path TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  last_byte_offset INTEGER NOT NULL DEFAULT 0,
  last_mtime TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  first_seen_at TEXT,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  started_at TEXT,
  ended_at TEXT,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  timestamp TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_project_ts ON usage_events(project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);

CREATE TABLE IF NOT EXISTS model_pricing (
  model TEXT PRIMARY KEY,
  input_price REAL,
  cache_write_price REAL,
  cache_read_price REAL,
  output_price REAL,
  updated_at TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS budget_limits (
  id INTEGER PRIMARY KEY,
  scope TEXT,
  period TEXT,
  limit_usd REAL,
  created_at TEXT
);
`;

function seedPricing(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
     VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'manual')`
  );
  const seedAll = db.transaction((rows: typeof DEFAULT_PRICING) => {
    for (const row of rows) insert.run(row);
  });
  seedAll(DEFAULT_PRICING);
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  seedPricing(db);
  dbInstance = db;
  return db;
}
```

- [ ] **Step 7: Write test verifying schema init is idempotent and pricing is seeded**

```typescript
// append to src/lib/__tests__/db.test.ts
import { getDb } from "../db";

describe("getDb", () => {
  it("initializes schema and seeds default pricing exactly once", () => {
    const db = getDb();
    const db2 = getDb();
    assert.strictEqual(db, db2);
    const row = db.prepare("SELECT * FROM model_pricing WHERE model = ?").get("claude-sonnet-5") as { input_price: number } | undefined;
    assert.ok(row);
    assert.strictEqual(row!.input_price, 3);
  });
});
```

- [ ] **Step 8: Run full test file to verify it passes**

Run: `node --experimental-strip-types --test src/lib/__tests__/db.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add src/lib/paths.ts src/lib/db.ts src/lib/pricing-seed.ts src/lib/__tests__/db.test.ts
git commit -m "feat: add SQLite schema, connection singleton, and pricing seed"
```

---

## Task 3: Ingestion Engine

**Files:**
- Create: `src/lib/ingest.ts`
- Test: `src/lib/__tests__/ingest.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `getClaudeProjectsDir()`, `decodeProjectSlug()` from Task 2.
- Produces:
  - `parseUsageLine(line: string): ParsedUsageLine | null` — parses one JSONL line, returns `null` for non-assistant/no-usage/malformed lines.
  - `runIngestCycle(): IngestSummary` — scans all project dirs, tails new bytes, writes to DB. Returns `{ filesScanned: number, eventsInserted: number }`. This is what Task 4's scheduler calls.

```typescript
export interface ParsedUsageLine {
  sessionId: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface IngestSummary {
  filesScanned: number;
  eventsInserted: number;
}
```

- [ ] **Step 1: Write failing test for `parseUsageLine`**

```typescript
// src/lib/__tests__/ingest.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseUsageLine } from "../ingest";

describe("parseUsageLine", () => {
  it("extracts usage from a valid assistant message line", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      message: {
        model: "claude-sonnet-5",
        usage: {
          input_tokens: 3,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 200,
          output_tokens: 50,
        },
      },
    });
    const result = parseUsageLine(line);
    assert.deepStrictEqual(result, {
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      model: "claude-sonnet-5",
      input_tokens: 3,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 200,
      output_tokens: 50,
    });
  });

  it("returns null for non-assistant lines", () => {
    const line = JSON.stringify({ type: "queue-operation", operation: "enqueue" });
    assert.strictEqual(parseUsageLine(line), null);
  });

  it("returns null for assistant lines without usage", () => {
    const line = JSON.stringify({ type: "assistant", sessionId: "x", message: {} });
    assert.strictEqual(parseUsageLine(line), null);
  });

  it("returns null for malformed JSON (truncated line)", () => {
    const line = '{"type":"assistant","message":{"usage":{"input_tokens":1';
    assert.strictEqual(parseUsageLine(line), null);
  });

  it("defaults model to \"unknown\" when missing", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      message: { usage: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = parseUsageLine(line);
    assert.strictEqual(result?.model, "unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/__tests__/ingest.test.ts`
Expected: FAIL — `parseUsageLine` not defined.

- [ ] **Step 3: Implement `parseUsageLine`**

```typescript
// src/lib/ingest.ts
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { getClaudeProjectsDir, decodeProjectSlug } from "./paths";

export interface ParsedUsageLine {
  sessionId: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface IngestSummary {
  filesScanned: number;
  eventsInserted: number;
}

export function parseUsageLine(line: string): ParsedUsageLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "assistant") return null;

  const message = obj.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  const sessionId = obj.sessionId;
  const timestamp = obj.timestamp;
  if (typeof sessionId !== "string" || typeof timestamp !== "string") return null;

  return {
    sessionId,
    timestamp,
    model: typeof message?.model === "string" ? (message.model as string) : "unknown",
    input_tokens: Number(usage.input_tokens ?? 0),
    cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/__tests__/ingest.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write failing test for `runIngestCycle` incremental tailing**

```typescript
// append to src/lib/__tests__/ingest.test.ts
import os from "node:os";
import { execFileSync } from "node:child_process";

describe("runIngestCycle", () => {
  it("ingests new lines incrementally without re-reading old bytes", async (t) => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-projects-"));
    const projectDir = path.join(tmpRoot, "-tmp-fake-project");
    fs.mkdirSync(projectDir);
    const filePath = path.join(projectDir, "session-1.jsonl");

    const line1 = JSON.stringify({
      type: "assistant", sessionId: "s1", timestamp: "2026-08-14T10:00:00.000Z",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } },
    });
    fs.writeFileSync(filePath, line1 + "\n");

    t.mock.method(await import("../paths"), "getClaudeProjectsDir", () => tmpRoot);

    const { runIngestCycle } = await import("../ingest");
    const first = runIngestCycle();
    assert.strictEqual(first.eventsInserted, 1);

    const line2 = JSON.stringify({
      type: "assistant", sessionId: "s1", timestamp: "2026-08-14T10:05:00.000Z",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } },
    });
    fs.appendFileSync(filePath, line2 + "\n");

    const second = runIngestCycle();
    assert.strictEqual(second.eventsInserted, 1);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/__tests__/ingest.test.ts`
Expected: FAIL — `runIngestCycle` not defined.

- [ ] **Step 7: Implement `runIngestCycle`**

```typescript
// append to src/lib/ingest.ts

function listProjectJsonlFiles(projectsDir: string): Array<{ slug: string; filePath: string }> {
  if (!fs.existsSync(projectsDir)) return [];
  const results: Array<{ slug: string; filePath: string }> = [];
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dirPath = path.join(projectsDir, slug);
    for (const file of fs.readdirSync(dirPath)) {
      if (file.endsWith(".jsonl")) {
        results.push({ slug, filePath: path.join(dirPath, file) });
      }
    }
  }
  return results;
}

function ensureProject(db: ReturnType<typeof getDb>, slug: string): number {
  const existing = db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug) as { id: number } | undefined;
  if (existing) return existing.id;
  const displayPath = decodeProjectSlug(slug);
  const displayName = displayPath.split("/").filter(Boolean).pop() ?? slug;
  const info = db
    .prepare(
      `INSERT INTO projects (slug, display_path, display_name, first_seen_at, last_active_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(slug, displayPath, displayName);
  return Number(info.lastInsertRowid);
}

function ensureSession(db: ReturnType<typeof getDb>, sessionId: string, projectId: number, timestamp: string): void {
  const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (!existing) {
    db.prepare(
      `INSERT INTO sessions (id, project_id, started_at, ended_at, message_count) VALUES (?, ?, ?, ?, 0)`
    ).run(sessionId, projectId, timestamp, timestamp);
  }
}

export function runIngestCycle(): IngestSummary {
  const db = getDb();
  const projectsDir = getClaudeProjectsDir();
  const files = listProjectJsonlFiles(projectsDir);

  let eventsInserted = 0;

  const insertEvent = db.prepare(
    `INSERT INTO usage_events (session_id, project_id, timestamp, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens)
     VALUES (@sessionId, @projectId, @timestamp, @model, @input_tokens, @cache_creation_input_tokens, @cache_read_input_tokens, @output_tokens)`
  );
  const bumpSession = db.prepare(
    `UPDATE sessions SET ended_at = ?, message_count = message_count + 1 WHERE id = ?`
  );
  const bumpProject = db.prepare(`UPDATE projects SET last_active_at = ? WHERE id = ?`);
  const getState = db.prepare(`SELECT last_byte_offset FROM ingest_state WHERE file_path = ?`);
  const upsertState = db.prepare(
    `INSERT INTO ingest_state (file_path, project_slug, last_byte_offset, last_mtime, updated_at)
     VALUES (@filePath, @slug, @offset, @mtime, datetime('now'))
     ON CONFLICT(file_path) DO UPDATE SET last_byte_offset = @offset, last_mtime = @mtime, updated_at = datetime('now')`
  );

  for (const { slug, filePath } of files) {
    const stat = fs.statSync(filePath);
    const state = getState.get(filePath) as { last_byte_offset: number } | undefined;
    const startOffset = state?.last_byte_offset ?? 0;
    if (stat.size <= startOffset) continue;

    const fd = fs.openSync(filePath, "r");
    const length = stat.size - startOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, startOffset);
    fs.closeSync(fd);

    const chunk = buffer.toString("utf-8");
    const lines = chunk.split("\n");
    const lastLine = lines[lines.length - 1];
    const isLastLineComplete = lastLine === "" || lastLine.endsWith("}");
    const completeLines = isLastLineComplete ? lines.filter((l) => l.length > 0) : lines.slice(0, -1);

    let consumedBytes = startOffset;
    const projectId = ensureProject(db, slug);

    const tx = db.transaction(() => {
      for (const line of completeLines) {
        consumedBytes += Buffer.byteLength(line, "utf-8") + 1;
        const parsed = parseUsageLine(line);
        if (!parsed) continue;
        ensureSession(db, parsed.sessionId, projectId, parsed.timestamp);
        insertEvent.run({
          sessionId: parsed.sessionId,
          projectId,
          timestamp: parsed.timestamp,
          model: parsed.model,
          input_tokens: parsed.input_tokens,
          cache_creation_input_tokens: parsed.cache_creation_input_tokens,
          cache_read_input_tokens: parsed.cache_read_input_tokens,
          output_tokens: parsed.output_tokens,
        });
        bumpSession.run(parsed.timestamp, parsed.sessionId);
        bumpProject.run(parsed.timestamp, projectId);
        eventsInserted++;
      }
      upsertState.run({ filePath, slug, offset: consumedBytes, mtime: stat.mtime.toISOString() });
    });
    tx();
  }

  return { filesScanned: files.length, eventsInserted };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/__tests__/ingest.test.ts`
Expected: PASS (6 tests). If the `t.mock.method` approach on a namespace import doesn't take effect due to ESM live-binding limitations, replace it with a `projectsDir` parameter: change `runIngestCycle(projectsDir: string = getClaudeProjectsDir())` and pass `tmpRoot` directly in the test instead of mocking. Apply that signature change if the mock fails.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ingest.ts src/lib/__tests__/ingest.test.ts
git commit -m "feat: add JSONL ingestion engine with incremental byte-offset tailing"
```

---

## Task 4: Ingestion Scheduler (server startup hook)

**Files:**
- Create: `src/lib/ingest-scheduler.ts`
- Modify: `src/app/layout.tsx` (trigger scheduler start once, server-side)

**Interfaces:**
- Consumes: `runIngestCycle()` from Task 3.
- Produces: `startIngestScheduler(intervalMs?: number): void` — idempotent, safe to call multiple times (e.g. across module reloads in dev).

- [ ] **Step 1: Implement scheduler with idempotent guard**

```typescript
// src/lib/ingest-scheduler.ts
import { runIngestCycle } from "./ingest";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __claudeDashboardIngestStarted: boolean | undefined;
}

export function startIngestScheduler(intervalMs: number = FIVE_MINUTES_MS): void {
  if (global.__claudeDashboardIngestStarted) return;
  global.__claudeDashboardIngestStarted = true;

  runIngestCycle();
  setInterval(() => {
    try {
      runIngestCycle();
    } catch (err) {
      console.error("[ingest] cycle failed:", err);
    }
  }, intervalMs).unref();
}
```

The `global` flag prevents duplicate intervals under Next.js dev-mode module reloading. `.unref()` ensures this timer never keeps the process alive on its own during shutdown.

- [ ] **Step 2: Wire startup into the root layout**

Modify `src/app/layout.tsx` to call the scheduler once at module load (server-side only, App Router layouts execute on the server):

```typescript
import { startIngestScheduler } from "@/lib/ingest-scheduler";

startIngestScheduler();

// ...rest of existing layout.tsx (RootLayout export) stays unchanged below this line
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev` then check server logs — no errors. Confirm `~/.claude-dashboard/usage.db` was created:

```bash
ls -la ~/.claude-dashboard/usage.db
sqlite3 ~/.claude-dashboard/usage.db "SELECT COUNT(*) FROM usage_events;"
```

Expected: file exists, count is a positive number reflecting real local Claude Code history.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ingest-scheduler.ts src/app/layout.tsx
git commit -m "feat: start ingestion scheduler on server boot"
```

---

## Task 5: Query Layer (aggregations for API routes)

**Files:**
- Create: `src/lib/queries.ts`
- Test: `src/lib/__tests__/queries.test.ts`

**Interfaces:**
- Consumes: `getDb()` from Task 2.
- Produces:
  - `getDashboardSummary(rangeDays: number): DashboardSummary`
  - `getUsageTimeSeries(rangeDays: number, bucket: "day" | "week" | "month"): TimeSeriesPoint[]`
  - `getModelBreakdown(rangeDays: number): ModelBreakdownRow[]`
  - `listProjects(): ProjectListRow[]`
  - `getProjectDetail(slug: string): ProjectDetail | null`

```typescript
export interface DashboardSummary {
  totalTokens: number;
  totalCostUsd: number;
  activeProjectCount: number;
  cacheEfficiencyPct: number; // cache_read / (cache_read + input) * 100
}
export interface TimeSeriesPoint {
  bucketStart: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
export interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}
export interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}
export interface ProjectDetail extends ProjectListRow {
  sessions: Array<{
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    messageCount: number;
    totalTokens: number;
    costUsd: number;
  }>;
}
```

- [ ] **Step 1: Write failing test for `getDashboardSummary` cost calculation**

```typescript
// src/lib/__tests__/queries.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { getDb } from "../db";
import { getDashboardSummary } from "../queries";

function seedFixture() {
  const db = getDb();
  db.exec("DELETE FROM usage_events; DELETE FROM sessions; DELETE FROM projects;");
  db.prepare(`INSERT INTO projects (id, slug, display_path, display_name, first_seen_at, last_active_at) VALUES (1, 'p1', '/p1', 'p1', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO sessions (id, project_id, started_at, ended_at, message_count) VALUES ('s1', 1, datetime('now'), datetime('now'), 1)`).run();
  db.prepare(
    `INSERT INTO usage_events (session_id, project_id, timestamp, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens)
     VALUES ('s1', 1, datetime('now'), 'claude-sonnet-5', 1000000, 0, 1000000, 1000000)`
  ).run();
}

describe("getDashboardSummary", () => {
  it("computes total tokens, cost, and cache efficiency", () => {
    seedFixture();
    const summary = getDashboardSummary(30);
    assert.strictEqual(summary.totalTokens, 3_000_000);
    assert.strictEqual(summary.activeProjectCount, 1);
    // sonnet-5: input $3/1M, output $15/1M, cache_read $0.3/1M
    // cost = 1*3 + 1*15 + 1*0.3 = 18.3
    assert.ok(Math.abs(summary.totalCostUsd - 18.3) < 0.001);
    // cache efficiency = cache_read / (cache_read + input) = 1/(1+1) = 50%
    assert.ok(Math.abs(summary.cacheEfficiencyPct - 50) < 0.001);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/__tests__/queries.test.ts`
Expected: FAIL — `../queries` module not found.

- [ ] **Step 3: Implement `src/lib/queries.ts`**

```typescript
import { getDb } from "./db";

export interface DashboardSummary {
  totalTokens: number;
  totalCostUsd: number;
  activeProjectCount: number;
  cacheEfficiencyPct: number;
}
export interface TimeSeriesPoint {
  bucketStart: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
export interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}
export interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}
export interface ProjectDetail extends ProjectListRow {
  sessions: Array<{
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    messageCount: number;
    totalTokens: number;
    costUsd: number;
  }>;
}

interface PricingMap {
  [model: string]: { input_price: number; cache_write_price: number; cache_read_price: number; output_price: number };
}

function loadPricing(): PricingMap {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM model_pricing").all() as Array<{
    model: string; input_price: number; cache_write_price: number; cache_read_price: number; output_price: number;
  }>;
  const map: PricingMap = {};
  for (const row of rows) map[row.model] = row;
  return map;
}

function costForRow(
  pricing: PricingMap,
  model: string,
  tokens: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }
): number {
  const price = pricing[model] ?? pricing["unknown"] ?? { input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 };
  return (
    (tokens.input_tokens / 1_000_000) * price.input_price +
    (tokens.cache_creation_input_tokens / 1_000_000) * price.cache_write_price +
    (tokens.cache_read_input_tokens / 1_000_000) * price.cache_read_price +
    (tokens.output_tokens / 1_000_000) * price.output_price
  );
}

export function getDashboardSummary(rangeDays: number): DashboardSummary {
  const db = getDb();
  const pricing = loadPricing();
  const rows = db
    .prepare(
      `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
       FROM usage_events WHERE timestamp >= datetime('now', ?)`
    )
    .all(`-${rangeDays} days`) as Array<{
      model: string; input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number;
    }>;

  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalInput = 0;
  let totalCacheRead = 0;

  for (const row of rows) {
    totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    totalCostUsd += costForRow(pricing, row.model, row);
    totalInput += row.input_tokens;
    totalCacheRead += row.cache_read_input_tokens;
  }

  const activeProjectCount = (
    db.prepare(`SELECT COUNT(DISTINCT project_id) as c FROM usage_events WHERE timestamp >= datetime('now', ?)`).get(`-${rangeDays} days`) as { c: number }
  ).c;

  const cacheEfficiencyPct = totalInput + totalCacheRead > 0 ? (totalCacheRead / (totalInput + totalCacheRead)) * 100 : 0;

  return { totalTokens, totalCostUsd, activeProjectCount, cacheEfficiencyPct };
}

export function getUsageTimeSeries(rangeDays: number, bucket: "day" | "week" | "month"): TimeSeriesPoint[] {
  const db = getDb();
  const format = bucket === "day" ? "%Y-%m-%d" : bucket === "week" ? "%Y-W%W" : "%Y-%m";
  const rows = db
    .prepare(
      `SELECT strftime('${format}', timestamp) as bucketStart,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(cache_read_input_tokens) as cache_read_input_tokens
       FROM usage_events
       WHERE timestamp >= datetime('now', ?)
       GROUP BY bucketStart
       ORDER BY bucketStart ASC`
    )
    .all(`-${rangeDays} days`) as TimeSeriesPoint[];
  return rows;
}

export function getModelBreakdown(rangeDays: number): ModelBreakdownRow[] {
  const db = getDb();
  const pricing = loadPricing();
  const rows = db
    .prepare(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(cache_read_input_tokens) as cache_read_input_tokens,
              SUM(output_tokens) as output_tokens
       FROM usage_events
       WHERE timestamp >= datetime('now', ?)
       GROUP BY model`
    )
    .all(`-${rangeDays} days`) as Array<{
      model: string; input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number;
    }>;

  return rows.map((row) => ({
    model: row.model,
    totalTokens: row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens,
    costUsd: costForRow(pricing, row.model, row),
  }));
}

export function listProjects(): ProjectListRow[] {
  const db = getDb();
  const pricing = loadPricing();
  const projects = db.prepare(`SELECT * FROM projects ORDER BY last_active_at DESC`).all() as Array<{
    slug: string; display_name: string; display_path: string; last_active_at: string | null; id: number;
  }>;

  return projects.map((project) => {
    const usageRows = db
      .prepare(
        `SELECT model, SUM(input_tokens) as input_tokens, SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
                SUM(cache_read_input_tokens) as cache_read_input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE project_id = ? GROUP BY model`
      )
      .all(project.id) as Array<{ model: string; input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }>;

    let totalTokens = 0;
    let costUsd = 0;
    for (const row of usageRows) {
      totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      costUsd += costForRow(pricing, row.model, row);
    }

    const sessionCount = (db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE project_id = ?`).get(project.id) as { c: number }).c;

    return {
      slug: project.slug,
      displayName: project.display_name,
      displayPath: project.display_path,
      totalTokens,
      costUsd,
      lastActiveAt: project.last_active_at,
      sessionCount,
    };
  });
}

export function getProjectDetail(slug: string): ProjectDetail | null {
  const db = getDb();
  const pricing = loadPricing();
  const project = db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) as
    | { id: number; slug: string; display_name: string; display_path: string; last_active_at: string | null }
    | undefined;
  if (!project) return null;

  const listRow = listProjects().find((p) => p.slug === slug)!;

  const sessionRows = db.prepare(`SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC`).all(project.id) as Array<{
    id: string; started_at: string | null; ended_at: string | null; message_count: number;
  }>;

  const sessions = sessionRows.map((session) => {
    const usageRows = db
      .prepare(
        `SELECT model, SUM(input_tokens) as input_tokens, SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
                SUM(cache_read_input_tokens) as cache_read_input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE session_id = ? GROUP BY model`
      )
      .all(session.id) as Array<{ model: string; input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }>;

    let totalTokens = 0;
    let costUsd = 0;
    for (const row of usageRows) {
      totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      costUsd += costForRow(pricing, row.model, row);
    }

    return {
      id: session.id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      messageCount: session.message_count,
      totalTokens,
      costUsd,
    };
  });

  return { ...listRow, sessions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test src/lib/__tests__/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Add tests for `listProjects` and `getProjectDetail`**

```typescript
// append to src/lib/__tests__/queries.test.ts
import { listProjects, getProjectDetail } from "../queries";

describe("listProjects and getProjectDetail", () => {
  it("returns project aggregates and session-level detail", () => {
    seedFixture();
    const projects = listProjects();
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].slug, "p1");
    assert.strictEqual(projects[0].sessionCount, 1);

    const detail = getProjectDetail("p1");
    assert.ok(detail);
    assert.strictEqual(detail!.sessions.length, 1);
    assert.strictEqual(detail!.sessions[0].id, "s1");

    assert.strictEqual(getProjectDetail("nonexistent"), null);
  });
});
```

- [ ] **Step 6: Run full test file to verify it passes**

Run: `node --experimental-strip-types --test src/lib/__tests__/queries.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries.ts src/lib/__tests__/queries.test.ts
git commit -m "feat: add query layer for dashboard, project list, and project detail aggregations"
```

---

## Task 6: API Routes

**Files:**
- Create: `src/app/api/summary/route.ts`
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[slug]/route.ts`
- Create: `src/app/api/pricing/route.ts`

**Interfaces:**
- Consumes: `getDashboardSummary`, `getUsageTimeSeries`, `getModelBreakdown`, `listProjects`, `getProjectDetail` from Task 5; `getDb` from Task 2.
- Produces: JSON HTTP endpoints consumed by pages in Tasks 7-9.

- [ ] **Step 1: Implement `/api/summary`**

```typescript
// src/app/api/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDashboardSummary, getUsageTimeSeries, getModelBreakdown } from "@/lib/queries";

export async function GET(request: NextRequest) {
  const rangeDays = Number(request.nextUrl.searchParams.get("rangeDays") ?? "30");
  const bucket = (request.nextUrl.searchParams.get("bucket") ?? "day") as "day" | "week" | "month";

  return NextResponse.json({
    summary: getDashboardSummary(rangeDays),
    timeSeries: getUsageTimeSeries(rangeDays, bucket),
    modelBreakdown: getModelBreakdown(rangeDays),
  });
}
```

- [ ] **Step 2: Implement `/api/projects`**

```typescript
// src/app/api/projects/route.ts
import { NextResponse } from "next/server";
import { listProjects } from "@/lib/queries";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}
```

- [ ] **Step 3: Implement `/api/projects/[slug]`**

```typescript
// src/app/api/projects/[slug]/route.ts
import { NextResponse } from "next/server";
import { getProjectDetail } from "@/lib/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = getProjectDetail(slug);
  if (!detail) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project: detail });
}
```

- [ ] **Step 4: Implement `/api/pricing` (GET + PUT)**

```typescript
// src/app/api/pricing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM model_pricing ORDER BY model").all();
  return NextResponse.json({ pricing: rows });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { model, input_price, cache_write_price, cache_read_price, output_price } = body;
  if (typeof model !== "string") {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
     VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'manual')
     ON CONFLICT(model) DO UPDATE SET
       input_price = @input_price, cache_write_price = @cache_write_price,
       cache_read_price = @cache_read_price, output_price = @output_price,
       updated_at = datetime('now'), source = 'manual'`
  ).run({ model, input_price, cache_write_price, cache_read_price, output_price });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Verify manually with dev server**

Run: `npm run dev`, then in another terminal:

```bash
curl -s http://localhost:3000/api/summary | head -c 500
curl -s http://localhost:3000/api/projects | head -c 500
curl -s http://localhost:3000/api/pricing | head -c 500
```

Expected: valid JSON responses reflecting real ingested data (not empty, assuming Task 4's ingestion already ran once).

- [ ] **Step 6: Commit**

```bash
git add src/app/api
git commit -m "feat: add summary, projects, and pricing API routes"
```

---

## Task 7: Dashboard Page

**Files:**
- Create: `src/components/SummaryCard.tsx`
- Create: `src/components/UsageTimeSeriesChart.tsx`
- Create: `src/components/ModelBreakdownChart.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `/api/summary` response shape from Task 6 (`DashboardSummary`, `TimeSeriesPoint[]`, `ModelBreakdownRow[]` from Task 5).
- Produces: the dashboard UI at `/`.

- [ ] **Step 1: Implement `SummaryCard`**

```typescript
// src/components/SummaryCard.tsx
interface SummaryCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function SummaryCard({ label, value, hint }: SummaryCardProps) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-sm text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Implement `UsageTimeSeriesChart`**

```typescript
// src/components/UsageTimeSeriesChart.tsx
"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface TimeSeriesPoint {
  bucketStart: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export function UsageTimeSeriesChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="bucketStart" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Area type="monotone" dataKey="input_tokens" stackId="1" name="Input" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} />
        <Area type="monotone" dataKey="output_tokens" stackId="1" name="Output" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.5} />
        <Area type="monotone" dataKey="cache_read_input_tokens" stackId="1" name="Cache read" stroke="#22c55e" fill="#22c55e" fillOpacity={0.5} />
        <Area type="monotone" dataKey="cache_creation_input_tokens" stackId="1" name="Cache write" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Implement `ModelBreakdownChart`**

```typescript
// src/components/ModelBreakdownChart.tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}

export function ModelBreakdownChart({ data }: { data: ModelBreakdownRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="model" tick={{ fontSize: 12 }} width={160} />
        <Tooltip />
        <Bar dataKey="totalTokens" name="Tokens" fill="#6366f1" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Implement Dashboard page with polling**

```typescript
// src/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { SummaryCard } from "@/components/SummaryCard";
import { UsageTimeSeriesChart } from "@/components/UsageTimeSeriesChart";
import { ModelBreakdownChart } from "@/components/ModelBreakdownChart";

interface SummaryResponse {
  summary: { totalTokens: number; totalCostUsd: number; activeProjectCount: number; cacheEfficiencyPct: number };
  timeSeries: Array<{ bucketStart: string; input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }>;
  modelBreakdown: Array<{ model: string; totalTokens: number; costUsd: number }>;
}

const POLL_INTERVAL_MS = 20_000;

export default function DashboardPage() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      const res = await fetch(`/api/summary?rangeDays=${rangeDays}&bucket=day`);
      const json = (await res.json()) as SummaryResponse;
      if (!cancelled) setData(json);
    }
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rangeDays]);

  if (!data) {
    return <div className="p-8 text-neutral-500">Loading dashboard…</div>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Claude Code Usage Dashboard</h1>
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Total tokens" value={data.summary.totalTokens.toLocaleString()} />
        <SummaryCard label="Estimated cost" value={`$${data.summary.totalCostUsd.toFixed(2)}`} />
        <SummaryCard label="Active projects" value={String(data.summary.activeProjectCount)} />
        <SummaryCard label="Cache efficiency" value={`${data.summary.cacheEfficiencyPct.toFixed(1)}%`} />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Usage over time</h2>
        <UsageTimeSeriesChart data={data.timeSeries} />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Usage by model</h2>
        <ModelBreakdownChart data={data.modelBreakdown} />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify manually**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: summary cards, area chart, and bar chart render with real data from local Claude Code history.

- [ ] **Step 6: Commit**

```bash
git add src/components/SummaryCard.tsx src/components/UsageTimeSeriesChart.tsx src/components/ModelBreakdownChart.tsx src/app/page.tsx
git commit -m "feat: build dashboard page with summary cards and charts"
```

---

## Task 8: Project List Page

**Files:**
- Create: `src/components/ProjectTable.tsx`
- Create: `src/app/projects/page.tsx`

**Interfaces:**
- Consumes: `/api/projects` response (`ProjectListRow[]` from Task 5) via Task 6's route.
- Produces: the project list UI at `/projects`.

- [ ] **Step 1: Implement `ProjectTable`**

```typescript
// src/components/ProjectTable.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}

type SortKey = "totalTokens" | "costUsd" | "lastActiveAt";

export function ProjectTable({ projects }: { projects: ProjectListRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return projects
      .filter((p) => p.displayName.toLowerCase().includes(term) || p.displayPath.toLowerCase().includes(term))
      .sort((a, b) => {
        if (sortKey === "lastActiveAt") return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
        return b[sortKey] - a[sortKey];
      });
  }, [projects, search, sortKey]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="totalTokens">Sort by tokens</option>
          <option value="costUsd">Sort by cost</option>
          <option value="lastActiveAt">Sort by last active</option>
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-2">Project</th>
            <th className="py-2">Tokens</th>
            <th className="py-2">Cost</th>
            <th className="py-2">Sessions</th>
            <th className="py-2">Last active</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.slug} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2">
                <Link href={`/projects/${p.slug}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {p.displayName}
                </Link>
                <div className="text-xs text-neutral-400">{p.displayPath}</div>
              </td>
              <td className="py-2">{p.totalTokens.toLocaleString()}</td>
              <td className="py-2">${p.costUsd.toFixed(2)}</td>
              <td className="py-2">{p.sessionCount}</td>
              <td className="py-2 text-neutral-500">{p.lastActiveAt ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Implement project list page**

```typescript
// src/app/projects/page.tsx
"use client";

import { useEffect, useState } from "react";
import { ProjectTable } from "@/components/ProjectTable";

interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListRow[] | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((json) => setProjects(json.projects));
  }, []);

  if (!projects) return <div className="p-8 text-neutral-500">Loading projects…</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <h1 className="text-xl font-semibold">Projects</h1>
      <ProjectTable projects={projects} />
    </main>
  );
}
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open `http://localhost:3000/projects`.
Expected: table listing every discovered project, sortable and searchable.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProjectTable.tsx src/app/projects/page.tsx
git commit -m "feat: build project list page"
```

---

## Task 9: Project Detail Page

**Files:**
- Create: `src/app/projects/[slug]/page.tsx`

**Interfaces:**
- Consumes: `/api/projects/[slug]` response (`ProjectDetail` from Task 5) via Task 6's route.
- Produces: the project detail UI at `/projects/[slug]`.

- [ ] **Step 1: Implement project detail page**

```typescript
// src/app/projects/[slug]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ProjectDetail {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
  sessions: Array<{
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    messageCount: number;
    totalTokens: number;
    costUsd: number;
  }>;
}

export default function ProjectDetailPage() {
  const params = useParams<{ slug: string }>();
  const [project, setProject] = useState<ProjectDetail | null | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/projects/${params.slug}`)
      .then((res) => (res.ok ? res.json() : Promise.resolve({ project: null })))
      .then((json) => setProject(json.project));
  }, [params.slug]);

  if (project === undefined) return <div className="p-8 text-neutral-500">Loading…</div>;
  if (project === null) return <div className="p-8 text-red-500">Project not found.</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">{project.displayName}</h1>
        <p className="text-sm text-neutral-500">{project.displayPath}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Total tokens</div>
          <div className="text-xl font-semibold">{project.totalTokens.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Estimated cost</div>
          <div className="text-xl font-semibold">${project.costUsd.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Sessions</div>
          <div className="text-xl font-semibold">{project.sessionCount}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Last active</div>
          <div className="text-xl font-semibold">{project.lastActiveAt ?? "—"}</div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Sessions</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2">Session</th>
              <th className="py-2">Started</th>
              <th className="py-2">Ended</th>
              <th className="py-2">Messages</th>
              <th className="py-2">Tokens</th>
              <th className="py-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {project.sessions.map((s) => (
              <tr key={s.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2 font-mono text-xs">{s.id.slice(0, 8)}</td>
                <td className="py-2 text-neutral-500">{s.startedAt ?? "—"}</td>
                <td className="py-2 text-neutral-500">{s.endedAt ?? "—"}</td>
                <td className="py-2">{s.messageCount}</td>
                <td className="py-2">{s.totalTokens.toLocaleString()}</td>
                <td className="py-2">${s.costUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, navigate from `/projects` into any project.
Expected: header stats + session table render correctly; unknown slug shows "Project not found."

- [ ] **Step 3: Commit**

```bash
git add src/app/projects/[slug]/page.tsx
git commit -m "feat: build project detail page with session list"
```

---

## Task 10: Settings Page (Pricing + Sync)

**Files:**
- Create: `src/app/api/pricing/sync/route.ts`
- Create: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getDb()` from Task 2; `/api/pricing` GET/PUT from Task 6.
- Produces: `POST /api/pricing/sync` endpoint and the Settings UI at `/settings`.

- [ ] **Step 1: Implement pricing sync endpoint with safe fallback**

```typescript
// src/app/api/pricing/sync/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface ScrapedPrice {
  model: string;
  input_price: number;
  cache_write_price: number;
  cache_read_price: number;
  output_price: number;
}

const MODEL_NAME_MAP: Record<string, string> = {
  "Claude Opus 5": "claude-opus-5",
  "Claude Sonnet 5": "claude-sonnet-5",
  "Claude Haiku 4.5": "claude-haiku-4-5-20251001",
};

function parsePricingHtml(html: string): ScrapedPrice[] {
  const results: ScrapedPrice[] = [];
  for (const [label, modelId] of Object.entries(MODEL_NAME_MAP)) {
    const labelIndex = html.indexOf(label);
    if (labelIndex === -1) continue;
    const window = html.slice(labelIndex, labelIndex + 2000);
    const prices = [...window.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
    if (prices.length < 2) continue;
    const [input, output] = prices;
    results.push({
      model: modelId,
      input_price: input,
      output_price: output,
      cache_write_price: Number((input * 1.25).toFixed(3)),
      cache_read_price: Number((input * 0.1).toFixed(3)),
    });
  }
  return results;
}

export async function POST() {
  try {
    const res = await fetch("https://www.anthropic.com/pricing", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    const html = await res.text();
    const scraped = parsePricingHtml(html);

    if (scraped.length === 0) {
      return NextResponse.json({ ok: false, error: "No known models found on pricing page; existing prices unchanged." }, { status: 502 });
    }

    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
       VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'synced')
       ON CONFLICT(model) DO UPDATE SET
         input_price = @input_price, cache_write_price = @cache_write_price,
         cache_read_price = @cache_read_price, output_price = @output_price,
         updated_at = datetime('now'), source = 'synced'`
    );
    const tx = db.transaction((rows: ScrapedPrice[]) => {
      for (const row of rows) upsert.run(row);
    });
    tx(scraped);

    return NextResponse.json({ ok: true, updated: scraped.map((s) => s.model) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error; existing prices unchanged." },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Implement Settings page**

```typescript
// src/app/settings/page.tsx
"use client";

import { useEffect, useState } from "react";

interface PricingRow {
  model: string;
  input_price: number;
  cache_write_price: number;
  cache_read_price: number;
  output_price: number;
  updated_at: string;
  source: string;
}

export default function SettingsPage() {
  const [pricing, setPricing] = useState<PricingRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  function loadPricing() {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then((json) => setPricing(json.pricing));
  }

  useEffect(loadPricing, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/pricing/sync", { method: "POST" });
      const json = await res.json();
      setSyncMessage(json.ok ? `Synced: ${json.updated.join(", ")}` : `Sync failed: ${json.error}`);
      loadPricing();
    } finally {
      setSyncing(false);
    }
  }

  async function handleFieldChange(model: string, field: keyof PricingRow, value: number) {
    setPricing((prev) => prev.map((p) => (p.model === model ? { ...p, [field]: value } : p)));
  }

  async function handleSave(row: PricingRow) {
    await fetch("/api/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    loadPricing();
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync Pricing"}
        </button>
      </div>

      {syncMessage && <p className="text-sm text-neutral-500">{syncMessage}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-2">Model</th>
            <th className="py-2">Input $/1M</th>
            <th className="py-2">Cache write $/1M</th>
            <th className="py-2">Cache read $/1M</th>
            <th className="py-2">Output $/1M</th>
            <th className="py-2">Source</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {pricing.map((row) => (
            <tr key={row.model} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 font-medium">{row.model}</td>
              {(["input_price", "cache_write_price", "cache_read_price", "output_price"] as const).map((field) => (
                <td key={field} className="py-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                    value={row[field]}
                    onChange={(e) => handleFieldChange(row.model, field, Number(e.target.value))}
                  />
                </td>
              ))}
              <td className="py-2 text-xs text-neutral-400">
                {row.source} · {row.updated_at}
              </td>
              <td className="py-2">
                <button onClick={() => handleSave(row)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open `http://localhost:3000/settings`.
Expected: pricing table shows seeded defaults; editing a field and clicking Save persists it (reload page to confirm); clicking "Sync Pricing" either updates values with `source: synced` or shows a failure message while leaving existing values intact.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pricing/sync/route.ts src/app/settings/page.tsx
git commit -m "feat: build settings page with editable pricing and sync button"
```

---

## Task 11: Navigation Shell

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a persistent top navigation bar linking Dashboard / Projects / Settings, visible on every page.

- [ ] **Step 1: Add navigation to root layout**

Modify `src/app/layout.tsx` to wrap `children` with a nav bar (keep the existing `startIngestScheduler()` call from Task 4 at the top of the file):

```typescript
import Link from "next/link";
// ...existing imports and startIngestScheduler() call from Task 4 stay here...

// Inside the RootLayout component's returned JSX, wrap {children} as follows:
// <body>
//   <nav className="border-b border-neutral-200 dark:border-neutral-800">
//     <div className="mx-auto flex max-w-6xl items-center gap-6 px-8 py-3 text-sm">
//       <Link href="/" className="font-semibold">Claude Usage</Link>
//       <Link href="/projects" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">Projects</Link>
//       <Link href="/settings" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">Settings</Link>
//     </div>
//   </nav>
//   {children}
// </body>
```

Apply this by editing the actual JSX returned from `RootLayout`, keeping the existing `<html>`/`<body>` className setup generated by `create-next-app` intact.

- [ ] **Step 2: Verify manually**

Run: `npm run dev`. Confirm the nav bar appears on `/`, `/projects`, and `/settings`, and links navigate correctly.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: add persistent navigation bar"
```

---

## Task 12: Systemd Service & Deployment Docs

**Files:**
- Create: `deploy/claude-dashboard.service`
- Create: `deploy/README.md`

**Interfaces:**
- Consumes: `.next/standalone/server.js` produced by `npm run build` (Task 1's `output: "standalone"` config).
- Produces: a working systemd user service definition.

- [ ] **Step 1: Write the systemd unit file**

```ini
# deploy/claude-dashboard.service
[Unit]
Description=Claude Code Usage Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/mnt/data/Project/WEB/claude-dashboard-usage/.next/standalone
ExecStart=/usr/bin/env node server.js
Environment=PORT=4317
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Write deployment instructions**

```markdown
<!-- deploy/README.md -->
# Deploying as a systemd user service

1. Build the app:
   ```bash
   cd /mnt/data/Project/WEB/claude-dashboard-usage
   npm run build
   ```
   This produces `.next/standalone/server.js`. Static assets need to be copied manually since standalone mode doesn't include them by default:
   ```bash
   cp -r .next/static .next/standalone/.next/static
   cp -r public .next/standalone/public 2>/dev/null || true
   ```

2. Install the unit as a **user** service (no root/sudo required):
   ```bash
   mkdir -p ~/.config/systemd/user
   cp deploy/claude-dashboard.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now claude-dashboard.service
   ```

3. Enable lingering so the service keeps running after logout:
   ```bash
   loginctl enable-linger $USER
   ```

4. Check status and logs:
   ```bash
   systemctl --user status claude-dashboard.service
   journalctl --user -u claude-dashboard.service -f
   ```

5. The dashboard is now reachable at `http://localhost:4317` at all times, independent of any terminal session.

6. To redeploy after code changes: repeat step 1, then `systemctl --user restart claude-dashboard.service`. The SQLite database at `~/.claude-dashboard/usage.db` is untouched by rebuilds.
```

- [ ] **Step 3: Verify manually**

Run through the steps in `deploy/README.md` on the actual machine. Confirm `curl http://localhost:4317` returns the dashboard HTML after enabling the service, and that it survives closing the terminal.

- [ ] **Step 4: Commit**

```bash
git add deploy/
git commit -m "docs: add systemd service unit and deployment instructions"
```

---

## Self-Review Notes

- **Spec coverage:** ingestion pipeline (Tasks 3-4), dashboard analytics with all 4 requested metrics — cost, model breakdown, time trends, cache efficiency (Task 7), project list (Task 8), per-session project detail (Task 9), pricing settings with sync + fallback (Task 10), systemd deployment (Task 12) — all covered. v1.1 items (budget alerts, export, comparison) intentionally excluded per spec's non-goals, with `budget_limits` table already in place from Task 2 for future work.
- **Placeholder scan:** no TBD/TODO markers; all steps contain complete, runnable code.
- **Type consistency:** `DashboardSummary`, `TimeSeriesPoint`, `ModelBreakdownRow`, `ProjectListRow`, `ProjectDetail` defined once in Task 5 and reused verbatim (as fetch response shapes) in Tasks 7-9's component prop types.
