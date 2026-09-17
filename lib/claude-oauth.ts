// OAuth surface Claude Code itself uses, ported from claude-swap
// (https://github.com/realiti4/claude-swap, src/claude_swap/oauth.py).
// These are the quota numbers Anthropic's rate limiter keeps server-side —
// they cannot be derived from the local session logs this dashboard ingests,
// which record token counts but no rate-limit state at all.

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const OAUTH_BETA_HEADER = "oauth-2025-04-20";

// Treat a token as stale this long before its stated expiry, so a request
// never races the expiry boundary.
export const OAUTH_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const USER_AGENT = "claude-dashboard-usage/1.0";
const REQUEST_TIMEOUT_MS = 15_000;

/** The refresh-token lineage is dead — only a fresh `/login` fixes this. */
export class ReloginRequiredError extends Error {}
/** Transient failure (network, 5xx, rate limit); worth retrying later. */
export class UsageUnavailableError extends Error {}

export interface OauthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number | null;
  /** Epoch ms when the login itself lapses; refresh cannot revive it. */
  refreshTokenExpiresAt: number | null;
}

export interface UsageWindow {
  utilization: number; // 0-100
  resetsAt: string | null; // ISO 8601
}

export interface ScopedUsage extends UsageWindow {
  label: string; // e.g. "Fable"
}

export interface SpendUsage extends UsageWindow {
  usedCents: number;
  limitCents: number | null;
  currency: string;
}

export interface AccountUsage {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  scoped: ScopedUsage[];
  spend: SpendUsage | null;
  fetchedAt: string;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIsoString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const utilization = asNumber(obj.utilization);
  if (utilization === null) return null;
  return { utilization: clampPercent(utilization), resetsAt: asIsoString(obj.resets_at) };
}

/**
 * Per-model caps (the "Fable" row in claude-swap's dashboard) arrive as a
 * `limits[]` array, each entry scoped to a model by display name.
 */
function parseScoped(raw: unknown): ScopedUsage[] {
  if (!Array.isArray(raw)) return [];
  const out: ScopedUsage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const percent = asNumber(obj.percent);
    if (percent === null) continue;

    const scope = obj.scope as Record<string, unknown> | undefined;
    const model = scope?.model as Record<string, unknown> | undefined;
    const label = typeof model?.display_name === "string" ? model.display_name : null;
    if (!label) continue;

    out.push({ label, utilization: clampPercent(percent), resetsAt: asIsoString(obj.resets_at) });
  }
  return out;
}

/** Pay-as-you-go credit spend; amounts are integer cents. */
function parseSpend(raw: unknown): SpendUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.is_enabled !== true) return null;

  const usedCents = asNumber(obj.used_credits);
  if (usedCents === null) return null;
  const limitCents = asNumber(obj.monthly_limit);
  const utilization = asNumber(obj.utilization);

  return {
    usedCents,
    limitCents,
    currency: typeof obj.currency === "string" ? obj.currency : "USD",
    utilization: clampPercent(
      utilization ?? (limitCents && limitCents > 0 ? (usedCents / limitCents) * 100 : 0)
    ),
    resetsAt: asIsoString(obj.resets_at),
  };
}

export function parseUsageResponse(payload: unknown): AccountUsage {
  const obj = (payload ?? {}) as Record<string, unknown>;
  return {
    fiveHour: parseWindow(obj.five_hour),
    sevenDay: parseWindow(obj.seven_day),
    scoped: parseScoped(obj.limits),
    spend: parseSpend(obj.extra_usage),
    fetchedAt: new Date().toISOString(),
  };
}

export function isAccessTokenStale(expiresAt: number | null, now = Date.now()): boolean {
  if (expiresAt === null) return true;
  return now + OAUTH_EXPIRY_BUFFER_MS >= expiresAt;
}

export function isLoginLapsed(refreshTokenExpiresAt: number | null, now = Date.now()): boolean {
  return refreshTokenExpiresAt !== null && refreshTokenExpiresAt <= now;
}

/**
 * Exchange a refresh token for a fresh access token.
 *
 * The refresh token rotates: when the response carries a new one, the caller
 * MUST persist it, or the next refresh fails with `invalid_grant` and the
 * account needs a full re-login.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new UsageUnavailableError(err instanceof Error ? err.message : "Token refresh failed.");
  }

  const bodyText = await res.text();
  if (!res.ok) {
    // 400 invalid_grant and 401 both mean the lineage is dead; anything else
    // (5xx, 429) is transient and the slot should be retried, not quarantined.
    if (res.status === 401 || (res.status === 400 && bodyText.includes("invalid_grant"))) {
      throw new ReloginRequiredError("Refresh token rejected — log in again with Claude Code.");
    }
    throw new UsageUnavailableError(`Token refresh failed (${res.status}).`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new UsageUnavailableError("Token refresh returned a malformed response.");
  }

  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new UsageUnavailableError("Token refresh returned no access token.");
  }
  const expiresIn = asNumber(data.expires_in);

  return {
    accessToken,
    // Absent `refresh_token` means the server kept the existing one alive.
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
    expiresAt: expiresIn === null ? null : Date.now() + expiresIn * 1000,
  };
}

export async function fetchOAuthUsage(accessToken: string): Promise<AccountUsage> {
  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": OAUTH_BETA_HEADER,
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new UsageUnavailableError(err instanceof Error ? err.message : "Usage request failed.");
  }

  if (res.status === 401) {
    throw new ReloginRequiredError("Access token rejected by the usage endpoint.");
  }
  if (!res.ok) {
    throw new UsageUnavailableError(`Usage request failed (${res.status}).`);
  }

  try {
    return parseUsageResponse(await res.json());
  } catch (err) {
    if (err instanceof UsageUnavailableError) throw err;
    throw new UsageUnavailableError("Usage endpoint returned a malformed response.");
  }
}
