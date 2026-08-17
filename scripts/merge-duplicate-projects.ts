/**
 * One-time migration: merge `projects` rows that represent the same real
 * project but ended up as separate rows because Claude Code assigns a
 * different folder slug per git worktree.
 *
 * Safe to re-run: rows without a `cwd`-derived path (path_source = 'slug')
 * are never merged, and rows already merged simply won't match anymore.
 *
 * Usage: npx tsx scripts/merge-duplicate-projects.ts [--dry-run]
 */
import fs from "node:fs";
import { getDb } from "../lib/db";
import { getDbPath } from "../lib/paths";
import { normalizeCanonicalPath } from "../lib/paths";

interface ProjectRow {
  id: number;
  slug: string;
  display_path: string;
  path_source: string;
  first_seen_at: string | null;
}

function backupDb(): string {
  const dbPath = process.env.CLAUDE_DASHBOARD_DB_PATH ?? getDbPath();
  const backupPath = `${dbPath}.bak-${Date.now()}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();

  if (!dryRun) {
    const backupPath = backupDb();
    console.log(`[migrate] backed up database to ${backupPath}`);
  } else {
    console.log("[migrate] dry run — no backup taken, no changes will be written");
  }

  const projects = db
    .prepare(`SELECT id, slug, display_path, path_source, first_seen_at FROM projects`)
    .all() as ProjectRow[];

  const groups = new Map<string, ProjectRow[]>();
  for (const project of projects) {
    if (project.path_source !== "cwd") continue; // never auto-merge lossy fallback rows
    const canonical = normalizeCanonicalPath(project.display_path);
    const list = groups.get(canonical) ?? [];
    list.push(project);
    groups.set(canonical, list);
  }

  let mergedGroups = 0;
  let rowsRemoved = 0;

  const reassignSessions = db.prepare(`UPDATE sessions SET project_id = ? WHERE project_id = ?`);
  const reassignEvents = db.prepare(`UPDATE usage_events SET project_id = ? WHERE project_id = ?`);
  const deleteProject = db.prepare(`DELETE FROM projects WHERE id = ?`);
  const setCanonical = db.prepare(`UPDATE projects SET canonical_path = ? WHERE id = ?`);

  const runGroup = db.transaction((canonicalPath: string, rows: ProjectRow[]) => {
    const sorted = [...rows].sort((a, b) => (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? ""));
    const primary = sorted[0];
    const duplicates = sorted.slice(1);

    for (const dup of duplicates) {
      console.log(`[migrate]   merging slug="${dup.slug}" (id=${dup.id}) -> slug="${primary.slug}" (id=${primary.id})`);
      reassignSessions.run(primary.id, dup.id);
      reassignEvents.run(primary.id, dup.id);
      deleteProject.run(dup.id);
      rowsRemoved++;
    }
    setCanonical.run(canonicalPath, primary.id);
  });

  for (const [canonicalPath, rows] of groups) {
    if (rows.length <= 1) {
      if (rows.length === 1 && !dryRun) setCanonical.run(canonicalPath, rows[0].id);
      continue;
    }
    mergedGroups++;
    console.log(`[migrate] group "${canonicalPath}" has ${rows.length} rows`);
    if (!dryRun) runGroup(canonicalPath, rows);
  }

  console.log(
    `[migrate] done. ${mergedGroups} group(s) with duplicates, ${rowsRemoved} row(s) ${dryRun ? "would be " : ""}removed.`
  );
}

main();
