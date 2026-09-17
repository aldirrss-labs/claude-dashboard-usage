import fs from "node:fs";
import path from "node:path";
import { getClaudeConfigHome } from "./claude-account-fs";

export interface ClaudeSessionInfo {
  pid: number;
  sessionId: string | null;
  cwd: string | null;
  startedAt: number | null;
  /** Config directory this session is running against. */
  configDir: string;
}

interface RawSessionFile {
  pid?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  startedAt?: unknown;
  procStart?: unknown;
}

/**
 * Read a process's start time from /proc, in clock ticks since boot.
 *
 * Claude Code records this alongside the pid, and comparing it is what makes
 * liveness detection correct rather than merely probable: a pid on its own is
 * recycled, so a stale session file could otherwise "match" an unrelated
 * process that happens to hold the same number now.
 */
function readProcStart(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    // comm (field 2) may contain spaces and parentheses, so fields are counted
    // from after the final ')'.
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const fields = afterComm.split(" ");
    // starttime is field 22 overall; fields[] here starts at field 3.
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number, recordedProcStart: string | null): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    // Signal 0 tests existence and permission without touching the process.
    process.kill(pid, 0);
  } catch (err) {
    // EPERM means it exists but belongs to someone else — still alive.
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }

  if (recordedProcStart === null) return true;
  const actual = readProcStart(pid);
  // Unreadable /proc (another user, or not Linux): trust the pid check.
  if (actual === null) return true;
  return actual === recordedProcStart;
}

/**
 * List Claude Code processes currently running against a config directory.
 * Defaults to the machine's main `~/.claude`; pass a session profile directory
 * to see that profile's sessions instead.
 */
export function scanLiveSessions(configDir: string = getClaudeConfigHome()): ClaudeSessionInfo[] {
  const sessionsDir = path.join(configDir, "sessions");

  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }

  const live: ClaudeSessionInfo[] = [];
  for (const entry of entries) {
    // `<pid>.json`, alongside `<pid>.<hash>.key` files that are not sessions.
    if (!/^\d+\.json$/.test(entry)) continue;

    let raw: RawSessionFile;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, entry), "utf-8"));
    } catch {
      continue;
    }

    const pid = typeof raw.pid === "number" ? raw.pid : Number(entry.replace(".json", ""));
    const procStart = typeof raw.procStart === "string" ? raw.procStart : null;
    if (!isProcessAlive(pid, procStart)) continue;

    live.push({
      pid,
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
      cwd: typeof raw.cwd === "string" ? raw.cwd : null,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : null,
      configDir,
    });
  }

  return live;
}

export function hasLiveSession(configDir?: string): boolean {
  return scanLiveSessions(configDir).length > 0;
}
