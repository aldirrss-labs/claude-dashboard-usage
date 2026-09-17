import fs from "node:fs";
import {
  getClaudeCredentialsPath,
  getClaudeGlobalConfigPath,
  atomicWriteJson,
  withClaudeCredentialsLock,
  withClaudeConfigLock,
} from "./claude-account-fs";
import { splitCredentialFields, composeCredentials } from "./account-swap-fields";
import { recordActiveAccount } from "./account-activity";
import { readLiveClaudeState } from "./claude-live-state";
import {
  type ClaudeAccountRow,
  findAccountByIdentity,
  getAccountById,
  markAccountUsed,
  upsertAccountFromLive,
} from "./account-queries";

export class UnsavedActiveSessionError extends Error {}
export class AccountNotFoundError extends Error {}

// Re-exported so the many existing importers keep working; the implementation
// moved to its own module to break an import cycle with account-activity.
export { readLiveClaudeState };

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
        markAccountUsed(target.id);
        // Close the outgoing period and open one for the incoming account, at
        // the exact moment of the swap rather than at the next poll.
        recordActiveAccount("switch");
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
