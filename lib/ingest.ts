import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { getClaudeProjectsDir, decodeProjectSlug, normalizeCanonicalPath } from "./paths";

export interface ParsedUsageLine {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
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
    cwd: typeof obj.cwd === "string" ? obj.cwd : null,
    model: typeof message?.model === "string" ? (message.model as string) : "unknown",
    input_tokens: Number(usage.input_tokens ?? 0),
    cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? 0),
  };
}

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

function ensureProject(db: ReturnType<typeof getDb>, slug: string, cwd: string | null): number {
  const existingBySlug = db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug) as
    | { id: number }
    | undefined;
  if (existingBySlug) return existingBySlug.id;

  const pathSource = cwd ? "cwd" : "slug";
  const displayPath = cwd ?? decodeProjectSlug(slug);
  const displayName = displayPath.split("/").filter(Boolean).pop() ?? slug;

  if (pathSource === "cwd") {
    const canonicalPath = normalizeCanonicalPath(displayPath);
    const existingByCanonical = db
      .prepare("SELECT id FROM projects WHERE canonical_path = ? AND path_source = 'cwd'")
      .get(canonicalPath) as { id: number } | undefined;
    if (existingByCanonical) return existingByCanonical.id;

    const info = db
      .prepare(
        `INSERT INTO projects (slug, display_path, display_name, canonical_path, path_source, first_seen_at, last_active_at)
         VALUES (?, ?, ?, ?, 'cwd', datetime('now'), datetime('now'))`
      )
      .run(slug, displayPath, displayName, canonicalPath);
    return Number(info.lastInsertRowid);
  }

  const info = db
    .prepare(
      `INSERT INTO projects (slug, display_path, display_name, canonical_path, path_source, first_seen_at, last_active_at)
       VALUES (?, ?, ?, NULL, 'slug', datetime('now'), datetime('now'))`
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

export function runIngestCycle(projectsDir: string = getClaudeProjectsDir()): IngestSummary {
  const db = getDb();
  const files = listProjectJsonlFiles(projectsDir);

  let eventsInserted = 0;

  const insertEvent = db.prepare(
    `INSERT INTO usage_events (session_id, project_id, timestamp, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens)
     VALUES (@sessionId, @projectId, @timestamp, @model, @input_tokens, @cache_creation_input_tokens, @cache_read_input_tokens, @output_tokens)`
  );
  const bumpSession = db.prepare(`UPDATE sessions SET ended_at = ?, message_count = message_count + 1 WHERE id = ?`);
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
    let projectId: number | null = null;

    const tx = db.transaction(() => {
      for (const line of completeLines) {
        consumedBytes += Buffer.byteLength(line, "utf-8") + 1;
        const parsed = parseUsageLine(line);
        if (!parsed) continue;
        if (projectId === null) {
          projectId = ensureProject(db, slug, parsed.cwd);
        }
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
