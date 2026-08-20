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
