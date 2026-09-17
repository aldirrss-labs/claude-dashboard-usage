import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Mirrors claude-code's own path resolution (verified against claude-swap's
// paths.py, itself pinned against the claude-code source): CLAUDE_CONFIG_DIR
// overrides ~/.claude for BOTH the credentials directory and the global
// config file — the legacy ~/.claude/.config.json fallback isn't
// implemented here, since no machine we target still uses it.
export function getClaudeConfigHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function getClaudeCredentialsPath(): string {
  return path.join(getClaudeConfigHome(), ".credentials.json");
}

export function getClaudeGlobalConfigPath(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || os.homedir();
  return path.join(base, ".claude.json");
}

export function atomicWriteJson(targetPath: string, data: unknown): void {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  const fd = fs.openSync(tmpPath, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
  fs.chmodSync(targetPath, 0o600);
}

interface LockOptions {
  stalenessMs: number;
  timeoutMs?: number;
  touchIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 9000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cooperates with Claude Code's own `proper-lockfile`-based credential
// locks: a directory as the mutex (mkdir is atomic), staleness measured by
// the directory's mtime, and a periodic "touch" while held so a slow
// legitimate holder is never mistaken for dead by a waiting acquirer.
export async function withLock<T>(lockDir: string, options: LockOptions, fn: () => Promise<T>): Promise<T> {
  const { stalenessMs, timeoutMs = DEFAULT_TIMEOUT_MS, touchIntervalMs = Math.min(3000, stalenessMs / 2) } = options;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Could not acquire lock ${lockDir} — held by another process. Retry in a few seconds.`);
    }

    let heldMtime: number;
    try {
      heldMtime = fs.statSync(lockDir).mtimeMs;
    } catch {
      continue; // holder released between our mkdir attempt and stat; retry immediately
    }
    if (Date.now() - heldMtime > stalenessMs) {
      try {
        fs.rmdirSync(lockDir);
      } catch {
        // lost the race to remove it to another waiter; loop and try again
      }
      continue;
    }
    await sleep(100 + Math.random() * 100);
  }

  const toucher = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(lockDir, now, now);
    } catch {
      // lock directory vanished (taken over as stale) — nothing left to keep alive
    }
  }, touchIntervalMs);

  try {
    return await fn();
  } finally {
    clearInterval(toucher);
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // already gone (e.g. taken over as stale by another waiter) — fine
    }
  }
}

// Claude Code's OAuth refresh path (2.1.218+) takes two locks in order:
// the primary `.oauth_refresh.lock` inside the config home, then the
// legacy `<config-home>.lock` sibling kept for compatibility. Both are
// staleness-60s. Mirroring the pair and the order means we can never
// deadlock against a running Claude Code process taking the same locks.
export async function withClaudeCredentialsLock<T>(fn: () => Promise<T>): Promise<T> {
  const configHome = getClaudeConfigHome();
  const primaryLockDir = path.join(configHome, ".oauth_refresh.lock");
  const legacyLockDir = path.join(path.dirname(configHome), `${path.basename(configHome)}.lock`);

  return withLock(primaryLockDir, { stalenessMs: 60_000 }, () =>
    withLock(legacyLockDir, { stalenessMs: 60_000 }, fn)
  );
}

// Claude Code's global-config write lock (`~/.claude.json.lock`), staleness 10s.
export async function withClaudeConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const configPath = getClaudeGlobalConfigPath();
  const lockDir = `${configPath}.lock`;
  return withLock(lockDir, { stalenessMs: 10_000 }, fn);
}
