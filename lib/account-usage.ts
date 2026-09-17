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
  getPollState,
  listAccounts,
  saveAccountUsage,
  saveAccountUsageError,
  savePollState,
  updateCredentialsSnapshot,
} from "./account-queries";
import { readLiveClaudeState } from "./account-swap";
import { planNextPoll } from "./poll-policy";

/**
 * Floor for a *forced* refresh. The adaptive policy decides when a background
 * poll is due; this only stops the Refresh button from being a hammer.
 */
export const FORCE_REFRESH_FLOOR_MS = 10_000;

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

/** SQLite datetime('now') is UTC with no zone marker; ISO strings carry one. */
function parseStamp(stamp: string | null): number | null {
  if (!stamp) return null;
  const parsed = Date.parse(stamp.includes("T") ? stamp : `${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Highest utilization across every window — the one that actually binds. */
export function bindingPercent(usage: AccountUsage | null): number | null {
  if (!usage) return null;
  const values: number[] = [];
  if (usage.fiveHour) values.push(usage.fiveHour.utilization);
  if (usage.sevenDay) values.push(usage.sevenDay.utilization);
  for (const scoped of usage.scoped) values.push(scoped.utilization);
  return values.length ? Math.max(...values) : null;
}

function soonestResetMs(usage: AccountUsage | null): number | null {
  if (!usage) return null;
  const times: number[] = [];
  for (const iso of [usage.fiveHour?.resetsAt, usage.sevenDay?.resetsAt, ...usage.scoped.map((s) => s.resetsAt)]) {
    const parsed = parseStamp(iso ?? null);
    if (parsed !== null) times.push(parsed);
  }
  return times.length ? Math.min(...times) : null;
}

/** True when the adaptive policy says this account is not due yet. */
function pollNotDue(accountId: number, now: number): boolean {
  const state = getPollState(accountId);
  const due = parseStamp(state?.nextPollAt ?? null);
  return due !== null && now < due;
}

// One in-flight request per account, so a burst of page loads (or the watch
// poller overlapping a manual refresh) makes a single upstream call.
const inFlight = new Map<number, Promise<AccountUsageState>>();

function recordPollPlan(
  account: ClaudeAccountRow,
  isActive: boolean,
  usage: AccountUsage | null,
  hit429: boolean
): void {
  const previous = getPollState(account.id);
  const now = Date.now();
  const last429AtMs = hit429 ? now : parseStamp(previous?.last429At ?? null);

  const plan = planNextPoll({
    isActive,
    bindingPercent: bindingPercent(usage),
    previousBindingPercent: previous?.lastBindingPercent ?? null,
    previousIntervalS: previous?.intervalSeconds ?? null,
    last429AtMs,
    nextResetAtMs: soonestResetMs(usage),
    nowMs: now,
  });

  savePollState(account.id, {
    nextPollAt: new Date(plan.nextPollAtMs).toISOString(),
    intervalSeconds: plan.intervalS,
    lastBindingPercent: bindingPercent(usage) ?? previous?.lastBindingPercent ?? null,
    last429At: last429AtMs === null ? null : new Date(last429AtMs).toISOString(),
  });
}

async function refreshOne(account: ClaudeAccountRow, isActive: boolean): Promise<AccountUsageState> {
  try {
    const accessToken = await resolveAccessToken(account, isActive);
    const usage = await fetchOAuthUsage(accessToken);
    saveAccountUsage(account.id, JSON.stringify(usage));
    recordPollPlan(account, isActive, usage, false);
    return { usage, fetchedAt: usage.fetchedAt, error: null, reloginRequired: false, stale: false };
  } catch (err) {
    const relogin = err instanceof ReloginRequiredError;
    const message = err instanceof Error ? err.message : "Usage fetch failed.";
    saveAccountUsageError(account.id, message, relogin);
    // A 429 is the one failure that must widen the interval rather than leave
    // it where it was, or every tick keeps hammering a throttled endpoint.
    recordPollPlan(account, isActive, readCachedUsage(account), message.includes("(429)"));
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
  const now = Date.now();

  // A forced refresh still respects a short floor, and always respects a 429
  // backoff the policy is serving out — the Refresh button must not be a way
  // to walk past congestion control.
  const fetchedAtMs = parseStamp(account.usageFetchedAt);
  const withinForceFloor = fetchedAtMs !== null && now - fetchedAtMs < FORCE_REFRESH_FLOOR_MS;
  const serveCached = options.force ? withinForceFloor : pollNotDue(account.id, now);

  if (serveCached && cached) {
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
