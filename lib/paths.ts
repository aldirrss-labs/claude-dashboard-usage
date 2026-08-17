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

const WORKTREE_SUFFIX_RE = /--claude-worktrees-.*$/;

export function normalizeCanonicalPath(displayPath: string): string {
  return displayPath.replace(WORKTREE_SUFFIX_RE, "");
}
