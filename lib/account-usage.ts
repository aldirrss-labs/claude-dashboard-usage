import {
  type AccountUsage,
  ReloginRequiredError,
  UsageUnavailableError,
  fetchOAuthUsage,
  isAccessTokenStale,
  isLoginLapsed,
  refreshAccessToken,
} from "./claude-oauth";
import {
  type ClaudeAccountRow,
  listAccounts,
  saveAccountUsage,
  saveAccountUsageError,
  updateCredentialsSnapshot,
} from "./account-queries";
import { readLiveClaudeState } from "./account-swap";

/** Usage older than this is refetched; newer is served from the DB snapshot. */
export const USAGE_TTL_MS = 60_000;

export interface AccountUsageState {
  usage: AccountUsage | null;
  fetchedAt: string | null;
  error: string | null;
  reloginRequired: boolean;
  stale: boolean;
}

interface OauthBlock {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
  refreshTokenExpiresAt?: unknown;
}

function readOauthBlock(credentialsJson: string): OauthBlock | null {
  try {
    const parsed = JSON.parse(credentialsJson);
    const block = parsed?.claudeAiOauth;
    return block && typeof block === "object" ? (block as OauthBlock) : null;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Resolve a usable access token for one account.
 *
 * The active account is deliberately read-only here: its credentials live in
 * `~/.claude/.credentials.json`, which Claude Code owns and refreshes. Rotating
 * that token from a dashboard would invalidate the copy Claude Code holds and
 * could log the user out mid-session, so if the live token is stale we report
 * it rather than refresh. Inactive accounts are ours to refresh — their tokens
 * only exist in this database, and the rotation is persisted immediately.
 */
async function resolveAccessToken(
  account: ClaudeAccountRow,
  isActive: boolean
): Promise<string> {
  if (isActive) {
    const live = readLiveClaudeState();
    const liveBlock = live.credentials?.claudeAiOauth as OauthBlock | undefined;
    const liveToken = liveBlock?.accessToken;
    if (typeof liveToken === "string" && liveToken) {
      if (isAccessTokenStale(numberOrNull(liveBlock?.expiresAt))) {
        throw new UsageUnavailableError(
          "Live access token is expiring — Claude Code will refresh it on next use."
        );
      }
      return liveToken;
    }
    throw new UsageUnavailableError("No live access token found for the active account.");
  }

  const block = readOauthBlock(account.credentialsSnapshot);
  if (!block) throw new UsageUnavailableError("Stored credentials are unreadable.");

  if (isLoginLapsed(numberOrNull(block.refreshTokenExpiresAt))) {
    throw new ReloginRequiredError("Login has lapsed — log in again with Claude Code, then re-save this account.");
  }

  const accessToken = typeof block.accessToken === "string" ? block.accessToken : null;
  if (accessToken && !isAccessTokenStale(numberOrNull(block.expiresAt))) {
    return accessToken;
  }

  const refreshToken = typeof block.refreshToken === "string" ? block.refreshToken : null;
  if (!refreshToken) {
    throw new ReloginRequiredError("No refresh token stored — log in again with Claude Code.");
  }

  const refreshed = await refreshAccessToken(refreshToken);

  // Persist before returning: the refresh token we just spent is single-use.
  const full = JSON.parse(account.credentialsSnapshot);
  full.claudeAiOauth = {
    ...full.claudeAiOauth,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    ...(refreshed.expiresAt !== null ? { expiresAt: refreshed.expiresAt } : {}),
  };
  updateCredentialsSnapshot(account.id, JSON.stringify(full));

  return refreshed.accessToken;
}

function readCachedUsage(account: ClaudeAccountRow): AccountUsage | null {
  if (!account.usageSnapshot) return null;
  try {
    return JSON.parse(account.usageSnapshot) as AccountUsage;
  } catch {
    return null;
  }
}

function isFresh(fetchedAt: string | null, now: number): boolean {
  if (!fetchedAt) return false;
  const parsed = Date.parse(`${fetchedAt.replace(" ", "T")}Z`);
  return !Number.isNaN(parsed) && now - parsed < USAGE_TTL_MS;
}

// One in-flight request per account, so a burst of page loads (or the watch
// poller overlapping a manual refresh) makes a single upstream call.
const inFlight = new Map<number, Promise<AccountUsageState>>();

async function refreshOne(account: ClaudeAccountRow, isActive: boolean): Promise<AccountUsageState> {
  try {
    const accessToken = await resolveAccessToken(account, isActive);
    const usage = await fetchOAuthUsage(accessToken);
    saveAccountUsage(account.id, JSON.stringify(usage));
    return { usage, fetchedAt: usage.fetchedAt, error: null, reloginRequired: false, stale: false };
  } catch (err) {
    const relogin = err instanceof ReloginRequiredError;
    const message = err instanceof Error ? err.message : "Usage fetch failed.";
    saveAccountUsageError(account.id, message, relogin);
    // Keep showing the last good numbers rather than blanking the row.
    return {
      usage: readCachedUsage(account),
      fetchedAt: account.usageFetchedAt,
      error: message,
      reloginRequired: relogin,
      stale: true,
    };
  }
}

export async function getAccountUsage(
  account: ClaudeAccountRow,
  isActive: boolean,
  options: { force?: boolean } = {}
): Promise<AccountUsageState> {
  const cached = readCachedUsage(account);

  if (!options.force && isFresh(account.usageFetchedAt, Date.now()) && cached) {
    return {
      usage: cached,
      fetchedAt: account.usageFetchedAt,
      error: account.usageError,
      reloginRequired: account.reloginRequired,
      stale: false,
    };
  }

  const existing = inFlight.get(account.id);
  if (existing) return existing;

  const pending = refreshOne(account, isActive).finally(() => inFlight.delete(account.id));
  inFlight.set(account.id, pending);
  return pending;
}

/**
 * Fetch usage for every saved account in parallel. Disabled accounts are
 * skipped — not polling them is most of the point of disabling one.
 */
export async function getAllAccountUsage(
  options: { force?: boolean } = {}
): Promise<Map<number, AccountUsageState>> {
  const live = readLiveClaudeState();
  const liveOrg = live.oauthAccount?.organizationUuid;
  const liveAccount = live.oauthAccount?.accountUuid;

  const accounts = listAccounts();
  const results = await Promise.all(
    accounts.map(async (account) => {
      const isActive = account.organizationUuid === liveOrg && account.accountUuid === liveAccount;
      if (account.disabled) {
        return [
          account.id,
          {
            usage: readCachedUsage(account),
            fetchedAt: account.usageFetchedAt,
            error: null,
            reloginRequired: account.reloginRequired,
            stale: true,
          } satisfies AccountUsageState,
        ] as const;
      }
      return [account.id, await getAccountUsage(account, isActive, options)] as const;
    })
  );

  return new Map(results);
}
