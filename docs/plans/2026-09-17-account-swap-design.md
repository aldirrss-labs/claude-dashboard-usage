# Account Swap — Design

Date: 2026-09-17

## Context

The user holds 4 Claude accounts (3 from work teams, 1 personal), and has so far switched between
them by hand (logging out and back in through the CLI). They tried the external tool
[claude-swap](https://github.com/realiti4/claude-swap) but were unwilling to trust their session
credentials to a third-party tool they did not write themselves — hence this request for their own
version, integrated into the existing usage dashboard.

**Mechanism research** (from `claude-swap`'s source, not just its README) turned up several facts
that shape this design:

1. Claude Code's live credentials on Linux sit in one plaintext file,
   `~/.claude/.credentials.json`, whose main content is `claudeAiOauth` (accessToken, refreshToken,
   expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier) plus
   `organizationUuid`.
2. That same file also holds keys that are **machine-wide, not per-account**: `mcpOAuth`,
   `mcpOAuthClientConfig`, `mcpXaaIdp`, `mcpXaaIdpConfig`, `pluginSecrets` — the login tokens for MCP
   servers (Figma, GitHub, Neon, Vercel, and so on). Overwriting this file wholesale with an old
   account's credentials rolls the MCP server logins back to an old snapshot too. These keys must
   always be taken from the **current live file**, never from the snapshot being activated.
3. `~/.claude.json` has an `oauthAccount` field (email, org, uuid, billing, etc.) that does have to
   be swapped at the same time, so the identity the CLI displays matches the active token — but the
   rest of that file (100KB+: `projects`, `mcpServers`, cache, settings) must not be touched.
4. Claude Code uses cooperative directory-based locks (`mkdir` as the mutex) when refreshing a
   token: `~/.claude/.oauth_refresh.lock` (stale after 60s) then `~/.claude.lock` (legacy, also
   60s), and `~/.claude.json.lock` (stale after 10s) when writing config. Our swap takes the same
   locks in the same order, so it cannot race a running Claude Code process — including a CLI
   session active in another terminal.

## Scope

**Goals:**
- Store credentials for several Claude accounts in SQLite (the existing `usage.db`).
- A new dashboard page listing every saved account and switching the active one in a single click.
- A safe swap: does not break MCP server logins, does not race other Claude Code processes, writes
  atomically, and does not lose the token of the account being left behind.

**Non-goals** (deliberately unbuilt `claude-swap` features — they can be added later if they turn
out to be needed):
- macOS Keychain (target: Linux only).
- Auto-switch based on remaining quota / rate limit.
- "Session mode" — running several accounts in parallel in different terminals at once.
- Auto-mapping a project directory to a particular account.
- TUI, menu bar, file export/import, adding an account from a raw API key or setup token.
- Verifying credential ownership through a profile API call (`claude-swap` uses this for tamper
  detection — overkill for one machine with one user).
- Support for a custom `CLAUDE_CONFIG_DIR` (assumption: the default `~/.claude` profile).

## Data model

A new table in `usage.db` (schema added to `SCHEMA` in `lib/db.ts`, following the pattern of
existing tables such as `email_settings`):

```sql
CREATE TABLE IF NOT EXISTS claude_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  organization_uuid TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  credentials_snapshot TEXT NOT NULL,   -- JSON: {claudeAiOauth, trustedDeviceToken?, organizationUuid}
  oauth_account_snapshot TEXT NOT NULL, -- JSON: the whole live oauthAccount object as saved
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_accounts_identity
  ON claude_accounts(organization_uuid, account_uuid);
```

`credentials_snapshot` holds **only** account-specific fields. The shared keys (`mcpOAuth` and
friends) never enter a snapshot — they are always read from the live file at activation time (see
the swap algorithm).

Re-saving an account whose `organization_uuid` + `account_uuid` already exists updates it in place
(`ON CONFLICT DO UPDATE`) rather than duplicating it.

## Core module: `lib/account-swap.ts`

A set of pure functions plus I/O, kept out of the route handlers so it can be tested without
Next.js:

```ts
// Read the current live credentials and oauthAccount
function readLiveClaudeState(): { credentials: object; oauthAccount: object | null }

// Separate account-specific fields from shared ones in the credentials.json object
function splitCredentialFields(credentials: object): {
  accountScoped: object;   // claudeAiOauth, trustedDeviceToken, organizationUuid
  shared: object;          // mcpOAuth, mcpOAuthClientConfig, mcpXaaIdp, mcpXaaIdpConfig, pluginSecrets
}

// Combine the target's accountScoped half with the current live shared half
function composeCredentials(targetAccountScoped: object, liveShared: object): object

// Claude-Code-style cooperative locks (mkdir as mutex, staleness check, auto-release via try/finally)
async function withClaudeCredentialsLock<T>(fn: () => Promise<T>): Promise<T>
async function withClaudeConfigLock<T>(fn: () => Promise<T>): Promise<T>

// Atomic write: temp file in the same directory -> rename -> chmod 600
function atomicWriteJson(path: string, data: object): void

// Orchestrate one full switch (algorithm below)
async function switchToAccount(accountId: number): Promise<void>
```

### The `switchToAccount` algorithm

1. `withClaudeCredentialsLock` + `withClaudeConfigLock` (nested, in the same order Claude Code uses:
   `.oauth_refresh.lock` → `.claude.lock` → `.claude.json.lock`).
2. `readLiveClaudeState()` — read the current `.credentials.json` and `.claude.json`'s
   `oauthAccount`.
3. Find the `claude_accounts` row whose `organization_uuid` + `account_uuid` match the live state.
   - **Match** → update that row's `credentials_snapshot` / `oauth_account_snapshot` with the live
     version (capture-before-switch, so a token Claude Code has refreshed since it was last saved is
     not lost).
   - **No match** → throw `UnsavedActiveSessionError` — the switch endpoint refuses with: "The
     current active session isn't saved as an account yet. Save it first with 'Save current
     session', or you will lose access to it."
4. `composeCredentials(target.accountScoped, live.shared)` → atomic write to
   `~/.claude/.credentials.json`.
5. Read the current `~/.claude.json`, replace **only** the `.oauthAccount` field with
   `target.oauth_account_snapshot`, and write it back atomically (every other key in that file is
   left untouched).
6. If step 4 or 5 fails: best-effort restore of the original state from step 2, then rethrow the
   original error.
7. Locks released (finally block, in reverse order of acquisition).

### `addAccountFromCurrentSession(label: string)`

1. `readLiveClaudeState()`.
2. If the live `oauthAccount` is missing or null → refuse ("not logged in to Claude Code, run
   `/login` first").
3. `splitCredentialFields()` → store `accountScoped` + `oauthAccount` as a new row, or update an
   existing one (`ON CONFLICT` by identity).

## API routes (`app/api/accounts/`)

| Route | Method | Purpose |
|---|---|---|
| `/api/accounts` | GET | List saved accounts. Each row carries `active: boolean`, computed per request by comparing the row's `organization_uuid` + `account_uuid` against the live `oauthAccount` rather than a stored flag (which would drift). |
| `/api/accounts` | POST | Body `{ label }` → `addAccountFromCurrentSession(label)`. |
| `/api/accounts/[id]/switch` | POST | → `switchToAccount(id)`. 409 on `UnsavedActiveSessionError`. |
| `/api/accounts/[id]` | PATCH | Body `{ label }` → rename. |
| `/api/accounts/[id]` | DELETE | Delete the row (never touches the live files). |

## UI

- A new `app/accounts/page.tsx` page, as the fourth nav item in `Sidebar.tsx` (a new icon, e.g. two
  crossing arrows for "swap").
- Account table: Label | Email | Organization | Status | Last saved | Actions.
  - Status: "Active now" (green) when `active === true`; an amber "⚠ refresh token expired" badge
    when the token inside `credentials_snapshot` / `oauth_account_snapshot` is past
    `refreshTokenExpiresAt` — this does **not** block a switch, it is only a warning (exactly as in
    `claude-swap`: if it really is expired, Claude Code will ask for `/login` again for that
    account).
  - Actions: "Switch" (disabled when already active), "Rename" (inline label edit), "Remove".
- A "+ Save current session" button above the table opening a small inline form (not a separate
  modal, consistent with the existing Settings form pattern) for the label, prefilled from the live
  `oauthAccount.emailAddress` where readable.
- Reuse the existing styling patterns (`SummaryCard`, the table style from `ProjectTable.tsx`) —
  no new design system.

## Security notes

- This feature is safe to build because the dashboard is already local-only
  (`HOSTNAME=127.0.0.1`, a systemd user service) and single-user. **Never** expose it to the network
  once this exists — anyone who can reach the dashboard can read the OAuth tokens of every saved
  account.
- Credentials are stored in plaintext in `usage.db` (consistent with the original
  `.credentials.json` and with `email_settings`, which is already plaintext today) — no extra
  encryption or passphrase, per the user's decision.
- A switch writes files that another Claude Code session may be reading, including a CLI session
  running in another terminal. The locks reduce the race during the write itself, but an active
  session can still be startled by its identity changing mid-task — avoid switching while a long
  coding session is running on the account being left.

## Testing

- Unit tests for `splitCredentialFields` / `composeCredentials` — pure functions, JSON fixtures,
  no real files touched.
- Unit tests for the lock helpers (`withClaudeCredentialsLock` and friends): acquire, detect a
  >60s / >10s stale lock and take it over, release — all run in a temp directory, never `~/.claude`.
- Integration tests for `switchToAccount` / `addAccountFromCurrentSession` with the Claude paths
  overridden by an env var (e.g. a test-only `CLAUDE_CONFIG_DIR_OVERRIDE`, or an injected path
  parameter) pointing at fixtures in a temp directory — verifying that: (a) shared keys are not
  overwritten, (b) only `oauthAccount` changes in `.claude.json` and every other key is byte-identical
  before and after, (c) capture-before-switch really does save the newest live state before
  overwriting, and (d) switching when the live session matches no row raises
  `UnsavedActiveSessionError`.

## Implementation order

1. `lib/account-swap.ts` — the pure functions (`splitCredentialFields`, `composeCredentials`) plus
   unit tests, no I/O yet.
2. Lock helpers + atomic write, tested in a temp directory.
3. The `claude_accounts` schema in `lib/db.ts` + query helpers (following the `lib/queries.ts`
   pattern).
4. `switchToAccount` + `addAccountFromCurrentSession`, with integration tests against overridden
   paths.
5. API routes.
6. The `/accounts` page + nav item — tested by hand in the browser against real accounts (with care:
   use an account that is not running the active working session during manual testing).
