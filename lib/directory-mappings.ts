import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "./db";
import { type ClaudeAccountRow, getAccountById } from "./account-queries";

export interface DirectoryMapping {
  canonicalDir: string;
  accountId: number;
  createdAt: string;
}

export interface ResolvedMapping {
  mapping: DirectoryMapping;
  account: ClaudeAccountRow;
  /** How many path segments deep the match was; higher wins. */
  depth: number;
}

/**
 * Reduce a directory to the single key form used for storage and lookup, so
 * the same folder always produces the same key however it was typed:
 * `~` expanded, relative resolved, symlinks followed, trailing slash dropped.
 *
 * Symlink resolution matters here specifically because a project reached
 * through a symlinked parent would otherwise store a different key than the
 * cwd Claude Code reports, and the mapping would silently never match.
 */
export function normalizeDir(input: string): string {
  let dir = input.trim();
  if (!dir) return "";

  if (dir === "~") dir = os.homedir();
  else if (dir.startsWith("~/")) dir = path.join(os.homedir(), dir.slice(2));

  dir = path.resolve(dir);

  try {
    dir = fs.realpathSync(dir);
  } catch {
    // Not on disk (yet). Keep the resolved-but-unlinked form rather than
    // refusing the mapping — the directory may be created later.
  }

  // path.resolve already strips a trailing slash except at the filesystem root.
  return dir;
}

function depthOf(dir: string): number {
  return dir === path.sep ? 0 : dir.split(path.sep).filter(Boolean).length;
}

/**
 * True when `ancestor` is the same directory as `child` or contains it.
 * Compared segment-wise rather than by string prefix, so `/home/a/proj` does
 * not match `/home/a/project-two`.
 */
export function isAncestorOrSame(ancestor: string, child: string): boolean {
  if (ancestor === child) return true;
  const withSep = ancestor.endsWith(path.sep) ? ancestor : ancestor + path.sep;
  return child.startsWith(withSep);
}

export function listMappings(): DirectoryMapping[] {
  const rows = getDb()
    .prepare(`SELECT canonical_dir, account_id, created_at FROM directory_mappings ORDER BY canonical_dir`)
    .all() as Array<{ canonical_dir: string; account_id: number; created_at: string }>;
  return rows.map((r) => ({
    canonicalDir: r.canonical_dir,
    accountId: r.account_id,
    createdAt: r.created_at,
  }));
}

export function setMapping(dir: string, accountId: number): DirectoryMapping {
  const canonicalDir = normalizeDir(dir);
  if (!canonicalDir) throw new Error("Directory is required.");
  if (!getAccountById(accountId)) throw new Error(`No saved account with id ${accountId}`);

  getDb()
    .prepare(
      `INSERT INTO directory_mappings (canonical_dir, account_id, created_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(canonical_dir) DO UPDATE SET account_id = excluded.account_id`
    )
    .run(canonicalDir, accountId);

  return { canonicalDir, accountId, createdAt: new Date().toISOString() };
}

export function deleteMapping(dir: string): void {
  getDb().prepare(`DELETE FROM directory_mappings WHERE canonical_dir = ?`).run(normalizeDir(dir));
}

/**
 * Find the account mapped to a directory.
 *
 * Mappings are inherited by subdirectories, and the deepest match wins, so a
 * general rule on `~/Project` can be overridden by a specific one on
 * `~/Project/client-x`. Returns null when nothing matches — callers must treat
 * that as "leave the active account alone", never as a reason to switch.
 */
export function resolveMappingForDir(dir: string): ResolvedMapping | null {
  const target = normalizeDir(dir);
  if (!target) return null;

  let best: ResolvedMapping | null = null;
  for (const mapping of listMappings()) {
    if (!isAncestorOrSame(mapping.canonicalDir, target)) continue;
    const depth = depthOf(mapping.canonicalDir);
    if (best && depth <= best.depth) continue;

    const account = getAccountById(mapping.accountId);
    // A mapping whose account was removed is dead weight; skip rather than
    // letting it shadow a shallower mapping that still resolves.
    if (!account) continue;

    best = { mapping, account, depth };
  }

  return best;
}
