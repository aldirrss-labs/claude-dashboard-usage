import fs from "node:fs";
import path from "node:path";
import { getDashboardDataDir, SECRET_FILE_MODE } from "./paths";
import { atomicWriteJson } from "./claude-account-fs";
import { type ClaudeAccountRow, getAccountById } from "./account-queries";
import { scanLiveSessions, type ClaudeSessionInfo } from "./claude-sessions";

/**
 * Parallel sessions, ported from claude-swap's session.py.
 *
 * Claude Code reads its credentials from `CLAUDE_CONFIG_DIR` (defaulting to
 * `~/.claude`). Giving each account its own directory lets several accounts run
 * at once, each with its own token, instead of taking turns through the single
 * shared login.
 *
 * The dashboard cannot open a terminal for you, so it prepares the profile and
 * hands back the exact command to run.
 */
const PROFILES_DIRNAME = "sessions";
const PROFILE_DIR_MODE = 0o700;

export function sessionProfilesRoot(): string {
  return path.join(getDashboardDataDir(), PROFILES_DIRNAME);
}

export function sessionProfileDir(accountId: number): string {
  return path.join(sessionProfilesRoot(), String(accountId));
}

export interface SessionProfile {
  accountId: number;
  configDir: string;
  exists: boolean;
  /** Claude Code processes currently running against this profile. */
  liveSessions: ClaudeSessionInfo[];
  command: string;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function describeProfile(accountId: number): SessionProfile {
  const configDir = sessionProfileDir(accountId);
  const exists = fs.existsSync(path.join(configDir, ".credentials.json"));
  return {
    accountId,
    configDir,
    exists,
    liveSessions: exists ? scanLiveSessions(configDir) : [],
    command: `CLAUDE_CONFIG_DIR=${shellQuote(configDir)} claude`,
  };
}

/**
 * Create or refresh an account's isolated profile.
 *
 * Seeded from the stored snapshot exactly once per call. Note the direction of
 * travel: once Claude Code runs against this profile it rotates the token in
 * place, and nothing syncs it back to the database. The profile — not the
 * store — then holds the newest generation of that account's token family, so
 * re-seeding a profile that has been used would roll it back to an older
 * refresh token and break it. Hence `refreshExisting` defaults to false.
 */
export function ensureSessionProfile(
  accountId: number,
  options: { refreshExisting?: boolean } = {}
): SessionProfile {
  const account = getAccountById(accountId);
  if (!account) throw new Error(`No saved account with id ${accountId}`);

  const configDir = sessionProfileDir(accountId);
  const credentialsPath = path.join(configDir, ".credentials.json");
  const alreadySeeded = fs.existsSync(credentialsPath);

  if (alreadySeeded && !options.refreshExisting) {
    return describeProfile(accountId);
  }

  const live = scanLiveSessions(configDir);
  if (live.length > 0) {
    throw new Error(
      `Claude Code is running against this profile (pid ${live.map((s) => s.pid).join(", ")}). Close it before reseeding.`
    );
  }

  fs.mkdirSync(configDir, { recursive: true, mode: PROFILE_DIR_MODE });
  fs.chmodSync(configDir, PROFILE_DIR_MODE);

  writeProfileFiles(configDir, account);
  return describeProfile(accountId);
}

function writeProfileFiles(configDir: string, account: ClaudeAccountRow): void {
  // Only the account-scoped half is seeded. MCP server logins and plugin
  // secrets are machine-wide and deliberately left out of per-account profiles.
  atomicWriteJson(path.join(configDir, ".credentials.json"), JSON.parse(account.credentialsSnapshot));
  fs.chmodSync(path.join(configDir, ".credentials.json"), SECRET_FILE_MODE);

  // CLAUDE_CONFIG_DIR redirects the global config too, so the profile needs its
  // own .claude.json carrying the identity — otherwise Claude Code treats the
  // profile as a fresh install with no logged-in account.
  const globalConfigPath = path.join(configDir, ".claude.json");
  let config: Record<string, unknown> = {};
  if (fs.existsSync(globalConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
    } catch {
      config = {};
    }
  }
  config.oauthAccount = JSON.parse(account.oauthAccountSnapshot);
  atomicWriteJson(globalConfigPath, config);
  fs.chmodSync(globalConfigPath, SECRET_FILE_MODE);
}

export function deleteSessionProfile(accountId: number): void {
  const configDir = sessionProfileDir(accountId);
  const live = scanLiveSessions(configDir);
  if (live.length > 0) {
    throw new Error(
      `Claude Code is running against this profile (pid ${live.map((s) => s.pid).join(", ")}). Close it first.`
    );
  }
  fs.rmSync(configDir, { recursive: true, force: true });
}

export function listSessionProfiles(accounts: ClaudeAccountRow[]): SessionProfile[] {
  return accounts.map((a) => describeProfile(a.id));
}
