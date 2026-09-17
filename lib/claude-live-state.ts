import fs from "node:fs";
import { getClaudeCredentialsPath, getClaudeGlobalConfigPath } from "./claude-account-fs";

export interface LiveClaudeState {
  credentials: Record<string, unknown> | null;
  oauthAccount: Record<string, unknown> | null;
}

function readJsonIfExists(path: string): Record<string, unknown> | null {
  if (!fs.existsSync(path)) return null;
  const text = fs.readFileSync(path, "utf-8");
  if (!text.trim()) return null;
  return JSON.parse(text);
}

/**
 * Read whichever Claude account is logged in right now.
 *
 * Lives in its own module rather than in account-swap because both the swap
 * and the activation log need it, and the swap also calls into the activation
 * log — importing it from account-swap would close that loop into a cycle.
 */
export function readLiveClaudeState(): LiveClaudeState {
  const credentials = readJsonIfExists(getClaudeCredentialsPath());
  const globalConfig = readJsonIfExists(getClaudeGlobalConfigPath());
  const oauthAccount =
    globalConfig && typeof globalConfig.oauthAccount === "object" && globalConfig.oauthAccount !== null
      ? (globalConfig.oauthAccount as Record<string, unknown>)
      : null;
  return { credentials, oauthAccount };
}
