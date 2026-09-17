import fs from "node:fs";
import {
  getClaudeCredentialsPath,
  getClaudeGlobalConfigPath,
  atomicWriteJson,
  withClaudeCredentialsLock,
  withClaudeConfigLock,
} from "./claude-account-fs";
import { splitCredentialFields, composeCredentials } from "./account-swap-fields";
import {
  type ClaudeAccountRow,
  findAccountByIdentity,
  getAccountById,
  upsertAccountFromLive,
} from "./account-queries";

export class UnsavedActiveSessionError extends Error {}
export class AccountNotFoundError extends Error {}

interface LiveClaudeState {
  credentials: Record<string, unknown> | null;
  oauthAccount: Record<string, unknown> | null;
}

function readJsonIfExists(path: string): Record<string, unknown> | null {
  if (!fs.existsSync(path)) return null;
  const text = fs.readFileSync(path, "utf-8");
  if (!text.trim()) return null;
  return JSON.parse(text);
}

export function readLiveClaudeState(): LiveClaudeState {
  const credentials = readJsonIfExists(getClaudeCredentialsPath());
  const globalConfig = readJsonIfExists(getClaudeGlobalConfigPath());
  const oauthAccount =
    globalConfig && typeof globalConfig.oauthAccount === "object" && globalConfig.oauthAccount !== null
      ? (globalConfig.oauthAccount as Record<string, unknown>)
      : null;
  return { credentials, oauthAccount };
}

function extractIdentity(oauthAccount: Record<string, unknown> | null): { organizationUuid: string; accountUuid: string } | null {
  const organizationUuid = oauthAccount?.organizationUuid;
  const accountUuid = oauthAccount?.accountUuid;
  if (typeof organizationUuid !== "string" || typeof accountUuid !== "string") return null;
  return { organizationUuid, accountUuid };
}

export async function addAccountFromCurrentSession(label: string): Promise<ClaudeAccountRow> {
  const { credentials, oauthAccount } = readLiveClaudeState();
  const identity = extractIdentity(oauthAccount);
  if (!identity) {
    throw new Error("Not logged in to Claude Code — run `/login` first, then try again.");
  }
  if (!credentials) {
    throw new Error("No active Claude Code credentials found on this machine.");
  }

  const { accountScoped } = splitCredentialFields(credentials);
  const email = typeof oauthAccount?.emailAddress === "string" ? oauthAccount.emailAddress : null;

  return upsertAccountFromLive({
    label,
    email,
    organizationUuid: identity.organizationUuid,
    accountUuid: identity.accountUuid,
    credentialsSnapshot: JSON.stringify(accountScoped),
    oauthAccountSnapshot: JSON.stringify(oauthAccount),
  });
}

export async function switchToAccount(accountId: number): Promise<void> {
  const target = getAccountById(accountId);
  if (!target) {
    throw new AccountNotFoundError(`No saved account with id ${accountId}`);
  }

  await withClaudeCredentialsLock(() =>
    withClaudeConfigLock(async () => {
      const live = readLiveClaudeState();
      if (!live.credentials) {
        throw new Error("No active Claude Code credentials found on this machine.");
      }

      const liveIdentity = extractIdentity(live.oauthAccount);
      const currentRow = liveIdentity ? findAccountByIdentity(liveIdentity.organizationUuid, liveIdentity.accountUuid) : null;
      if (!currentRow) {
        throw new UnsavedActiveSessionError(
          "The current active session isn't saved as an account yet. Save it first — switching now would lose access to it."
        );
      }

      // Capture-before-switch: refresh the outgoing (currently live) account's
      // stored snapshot with whatever Claude Code has refreshed since it was
      // last saved. Doing this unconditionally — even when switching to the
      // account that's already active — is what makes a switch-to-self a true
      // no-op instead of rolling the live token back to a stale stored value.
      const { accountScoped: liveAccountScoped, shared: liveShared } = splitCredentialFields(live.credentials);
      upsertAccountFromLive({
        label: currentRow.label,
        email: currentRow.email,
        organizationUuid: currentRow.organizationUuid,
        accountUuid: currentRow.accountUuid,
        credentialsSnapshot: JSON.stringify(liveAccountScoped),
        oauthAccountSnapshot: JSON.stringify(live.oauthAccount),
      });

      const freshTarget = getAccountById(target.id)!;
      const targetAccountScoped = JSON.parse(freshTarget.credentialsSnapshot);
      const targetOauthAccount = JSON.parse(freshTarget.oauthAccountSnapshot);
      const composedCredentials = composeCredentials(targetAccountScoped, liveShared);

      const credentialsPath = getClaudeCredentialsPath();
      const configPath = getClaudeGlobalConfigPath();
      const originalCredentialsRaw = fs.readFileSync(credentialsPath, "utf-8");
      const originalConfigRaw = fs.readFileSync(configPath, "utf-8");

      try {
        atomicWriteJson(credentialsPath, composedCredentials);

        const currentConfig = JSON.parse(originalConfigRaw);
        currentConfig.oauthAccount = targetOauthAccount;
        atomicWriteJson(configPath, currentConfig);
      } catch (err) {
        try {
          fs.writeFileSync(credentialsPath, originalCredentialsRaw, { mode: 0o600 });
          fs.writeFileSync(configPath, originalConfigRaw, { mode: 0o600 });
        } catch {
          // Rollback itself failed — surface the original error; nothing more
          // we can do here without risking making things worse.
        }
        throw err;
      }
    })
  );
}
