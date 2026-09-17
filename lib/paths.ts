import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

// The database holds saved Claude OAuth tokens, so it is treated the same way
// Claude Code treats its own ~/.claude/.credentials.json: owner-only. These are
// applied on every startup, not just at creation, so databases made before the
// accounts feature existed (when this file held only token counts, and was
// created 0644) get tightened on the next run.
const DATA_DIR_MODE = 0o700;
const SECRET_FILE_MODE = 0o600;

function chmodIfExists(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch (err) {
    // Missing is fine (not created yet). Anything else is worth knowing about,
    // but must not stop the app from starting.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[paths] could not tighten permissions on ${target}:`, err);
    }
  }
}

export function getDashboardDataDir(): string {
  const dir = path.join(os.homedir(), ".claude-dashboard");
  fs.mkdirSync(dir, { recursive: true, mode: DATA_DIR_MODE });
  chmodIfExists(dir, DATA_DIR_MODE);
  return dir;
}

export function getDbPath(): string {
  return path.join(getDashboardDataDir(), "usage.db");
}

/**
 * Tighten the database and its WAL sidecars. SQLite creates `-wal` and `-shm`
 * itself, with the process umask — and the WAL holds the same committed rows as
 * the database, so leaving it 0644 would leak exactly what locking down the
 * main file was meant to prevent.
 */
export function secureDbFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    chmodIfExists(`${dbPath}${suffix}`, SECRET_FILE_MODE);
  }
}

export { SECRET_FILE_MODE };

export function decodeProjectSlug(slug: string): string {
  return slug.replace(/-/g, "/");
}

// Two distinct worktree layouts show up in the wild:
//  1. Slug-suffix worktrees: "...--claude-worktrees-<name>" appended to the
//     Claude-Code-assigned folder slug.
//  2. Native git worktrees created inside the repo itself: the real cwd
//     contains a literal "/.claude/worktrees/<name>/..." segment partway
//     through the path (e.g. ".../CLT-005_taufiq/.claude/worktrees/foo/bar").
// Both get stripped back to the parent project's path so they dedupe
// against it instead of creating a separate project row.
const WORKTREE_SUFFIX_RE = /--claude-worktrees-.*$/;
const WORKTREE_PATH_SEGMENT_RE = /\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/;

export function normalizeCanonicalPath(displayPath: string): string {
  return displayPath.replace(WORKTREE_SUFFIX_RE, "").replace(WORKTREE_PATH_SEGMENT_RE, "");
}
