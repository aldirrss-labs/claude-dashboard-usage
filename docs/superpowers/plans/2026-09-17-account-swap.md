# Account Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan format note:** per project convention, this plan stays at outline level —
> task list, files touched, interface contracts, and one-sentence test assertions.
> It does NOT contain full function bodies or complete test code; write the actual
> code during implementation, not while planning.

**Goal:** Let the user store OAuth credentials for multiple Claude accounts (currently 4: 3 work
orgs + 1 personal) in the existing dashboard's SQLite DB, and switch which one is active on this
machine with one click in a new `/accounts` page — without breaking MCP server logins or racing
Claude Code's own credential refresh.

**Architecture:** A new `lib/` layer that knows how to safely read/write Claude Code's own files
(`~/.claude/.credentials.json`, `~/.claude.json`), cooperating with Claude Code's own directory-mkdir
locks and never touching machine-shared keys (`mcpOAuth` etc). This layer backs a small CRUD API
(`app/api/accounts/`) and one dashboard page, following the exact patterns already used for
Settings/pricing in this app (SQLite table, API routes, a page + Sidebar nav item).

**Tech Stack:** Same as the rest of the app — Next.js App Router, `better-sqlite3`, plain
`node:fs`/`node:path` for the file-safety layer (no new dependency — the locking mechanism is a
~30-line mkdir-mutex, not worth pulling in `proper-lockfile`).

**Spec:** [docs/plans/2026-09-17-account-swap-design.md](../../plans/2026-09-17-account-swap-design.md)

## Global Constraints

- Never write `mcpOAuth`, `mcpOAuthClientConfig`, `mcpXaaIdp`, `mcpXaaIdpConfig`, `pluginSecrets`
  from a stored snapshot — these are machine-shared and must always come from the live file.
- Every write to `~/.claude/.credentials.json` or `~/.claude.json` goes through
  `atomicWriteJson` (temp file in the same directory → `rename` → `chmod 600`). Never
  `fs.writeFileSync` directly on the real path.
- Every switch acquires Claude Code's own locks first, in its order: `.oauth_refresh.lock` →
  `.claude.lock` → `.claude.json.lock`. Staleness: 60s for the two credential locks, 10s for the
  config lock (exact values from the design spec — verified against claude-swap's source).
- `~/.claude.json` writes touch **only** the `oauthAccount` key. Every other key in that file must
  be byte-identical before/after (this is a testable assertion, not just a code review note).
- Credentials stored in `usage.db` stay plaintext (decision already made in the design spec — no
  encryption, no passphrase).
- Path resolution respects `CLAUDE_CONFIG_DIR` (falls back to `~/.claude`) — this is what makes the
  integration tests possible without touching the real `~/.claude` on the dev machine, and it's also
  what real Claude Code and claude-swap both honor.
- All code, identifiers, comments, test names: English (matches existing codebase).
- No new npm dependency.

---

## File Structure

```
lib/
├── claude-account-fs.ts        # NEW: path resolution (CLAUDE_CONFIG_DIR-aware),
│                                #      atomicWriteJson, withClaudeCredentialsLock,
│                                #      withClaudeConfigLock
├── account-swap-fields.ts      # NEW: pure functions — split/compose credential fields
├── account-queries.ts          # NEW: claude_accounts CRUD (mirrors lib/queries.ts pattern)
├── account-swap.ts             # NEW: orchestration — readLiveClaudeState,
│                                #      addAccountFromCurrentSession, switchToAccount
├── db.ts                       # MODIFY: add claude_accounts table to SCHEMA
└── __tests__/
    ├── claude-account-fs.test.ts     # NEW
    ├── account-swap-fields.test.ts   # NEW
    ├── account-queries.test.ts       # NEW
    └── account-swap.test.ts          # NEW (integration, temp CLAUDE_CONFIG_DIR)

app/
├── api/accounts/
│   ├── route.ts                # NEW: GET (list), POST (add current session)
│   └── [id]/
│       ├── route.ts            # NEW: PATCH (rename), DELETE (remove)
│       └── switch/route.ts     # NEW: POST (activate)
└── accounts/
    └── page.tsx                 # NEW: accounts page

components/
├── AccountsTable.tsx            # NEW
└── Sidebar.tsx                  # MODIFY: add 4th nav item + icon
```

---

## Task 1: Pure credential-field logic

**Files:**
- Create: `lib/account-swap-fields.ts`
- Test: `lib/__tests__/account-swap-fields.test.ts`

**Interfaces (produced, consumed by Task 4):**
```ts
export const SHARED_CREDENTIAL_KEYS: readonly string[]; // mcpOAuth, mcpOAuthClientConfig, mcpXaaIdp, mcpXaaIdpConfig, pluginSecrets

export function splitCredentialFields(credentials: Record<string, unknown>): {
  accountScoped: Record<string, unknown>; // claudeAiOauth, trustedDeviceToken?, organizationUuid
  shared: Record<string, unknown>;        // only keys in SHARED_CREDENTIAL_KEYS present in input
};

export function composeCredentials(
  targetAccountScoped: Record<string, unknown>,
  liveShared: Record<string, unknown>
): Record<string, unknown>;
```

**Deliverable:** the merge/split logic that keeps MCP logins intact across a switch, fully unit
tested with zero filesystem I/O.

**Tests must prove:**
- `splitCredentialFields` puts `claudeAiOauth`/`organizationUuid`/`trustedDeviceToken` into
  `accountScoped` and every `SHARED_CREDENTIAL_KEYS` member present in the input into `shared`.
- A credential object with no shared keys produces an empty `shared` object, not an error.
- `composeCredentials` output contains the target's `accountScoped` fields verbatim and the live
  session's `shared` fields verbatim, with no leftover fields from a third source.
- `composeCredentials` never carries over a `shared` key that was absent in `liveShared` (i.e. a
  shared key the current machine no longer holds isn't resurrected from an old snapshot).

**Acceptance:** `node --import tsx --test lib/__tests__/account-swap-fields.test.ts` passes, no
other file touched.

---

## Task 2: Claude file-safety layer (paths, atomic write, locks)

**Files:**
- Create: `lib/claude-account-fs.ts`
- Test: `lib/__tests__/claude-account-fs.test.ts`

**Interfaces (produced, consumed by Task 4):**
```ts
export function getClaudeConfigHome(): string;       // CLAUDE_CONFIG_DIR ?? ~/.claude
export function getClaudeCredentialsPath(): string;  // <config-home>/.credentials.json
export function getClaudeGlobalConfigPath(): string; // (CLAUDE_CONFIG_DIR ?? home) + /.claude.json

export function atomicWriteJson(path: string, data: unknown): void;

export function withClaudeCredentialsLock<T>(fn: () => Promise<T>): Promise<T>;
export function withClaudeConfigLock<T>(fn: () => Promise<T>): Promise<T>;
```

**Deliverable:** a small, dependency-free module any future Claude-Code-file-touching feature in
this app can reuse — not just this one.

**Design notes:**
- Lock = `fs.mkdirSync(lockDir)` as the mutex (`EEXIST` means held). Stale check: if
  `fs.statSync(lockDir).mtime` is older than the threshold (60s credentials, 10s config), remove
  and retake. While held, touch the dir's mtime periodically (interval well under the threshold)
  so a slow operation isn't mistaken for a dead holder.
- `withClaudeCredentialsLock` acquires, in order, the lock dirs for `.oauth_refresh.lock` then
  `.claude.lock` (both under/adjacent to `getClaudeConfigHome()` per the design spec), releasing
  both in `finally` regardless of what `fn` does.
- `atomicWriteJson`: `fs.mkdtempSync`-style temp file in the **same directory** as the target (so
  `fs.renameSync` is same-filesystem-atomic), then `fs.chmodSync(target, 0o600)`.

**Tests must prove:**
- `getClaudeConfigHome` returns `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
- `atomicWriteJson` leaves the target file absent (not partially written) if interrupted
  mid-write — simulate by writing then asserting the temp file is gone and target has full content
  (no half-written JSON is ever observable at the target path).
- A lock held by a live process (fresh mtime) blocks a second `withClaudeCredentialsLock` caller
  in the same test until the first releases (use two async calls racing against a shared temp
  lock dir).
- A lock directory older than the staleness threshold is taken over instead of blocking forever.
- Every test runs against a `fs.mkdtempSync` temp dir via `CLAUDE_CONFIG_DIR`, never the real
  `~/.claude`.

**Acceptance:** `node --import tsx --test lib/__tests__/claude-account-fs.test.ts` passes.

---

## Task 3: `claude_accounts` schema + CRUD queries

**Files:**
- Modify: `lib/db.ts` (add table to the `SCHEMA` template string, alongside the existing tables —
  no migration needed since this is a brand-new table, `CREATE TABLE IF NOT EXISTS` is enough)
- Create: `lib/account-queries.ts`
- Test: `lib/__tests__/account-queries.test.ts` (same `test-db-setup.ts` pattern as
  `lib/__tests__/queries.test.ts` — imports it first to point `CLAUDE_DASHBOARD_DB_PATH` at a temp
  file)

**Schema (exact — copy from the design spec verbatim):**
```sql
CREATE TABLE IF NOT EXISTS claude_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  organization_uuid TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  credentials_snapshot TEXT NOT NULL,
  oauth_account_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_accounts_identity
  ON claude_accounts(organization_uuid, account_uuid);
```

**Interfaces (produced, consumed by Task 4 and the API routes in Task 5):**
```ts
export interface ClaudeAccountRow {
  id: number; label: string; email: string | null;
  organizationUuid: string; accountUuid: string;
  credentialsSnapshot: string; oauthAccountSnapshot: string;
  createdAt: string; updatedAt: string;
}

export function listAccounts(): ClaudeAccountRow[];
export function findAccountByIdentity(organizationUuid: string, accountUuid: string): ClaudeAccountRow | null;
export function getAccountById(id: number): ClaudeAccountRow | null;
export function upsertAccountFromLive(input: {
  label: string; email: string | null; organizationUuid: string; accountUuid: string;
  credentialsSnapshot: string; oauthAccountSnapshot: string;
}): ClaudeAccountRow; // INSERT ... ON CONFLICT(organization_uuid, account_uuid) DO UPDATE
export function renameAccount(id: number, label: string): void;
export function deleteAccount(id: number): void;
```

**Tests must prove:**
- `upsertAccountFromLive` called twice with the same identity updates the existing row (row count
  stays 1, `updated_at` changes) rather than inserting a duplicate.
- `findAccountByIdentity` returns `null` for an identity that was never added.
- `renameAccount` changes only `label` and `updated_at`; every other column is unchanged.
- `deleteAccount` removes exactly the targeted row.

**Acceptance:** `node --import tsx --test lib/__tests__/account-queries.test.ts` passes.

---

## Task 4: Orchestration — `lib/account-swap.ts`

**Files:**
- Create: `lib/account-swap.ts`
- Test: `lib/__tests__/account-swap.test.ts`

**Consumes:** everything from Tasks 1-3 (`splitCredentialFields`, `composeCredentials`,
`getClaudeCredentialsPath`, `getClaudeGlobalConfigPath`, `atomicWriteJson`,
`withClaudeCredentialsLock`, `withClaudeConfigLock`, `findAccountByIdentity`,
`upsertAccountFromLive`, `getAccountById`).

**Interfaces (produced, consumed by the API routes in Task 5):**
```ts
export class UnsavedActiveSessionError extends Error {}

export function readLiveClaudeState(): {
  credentials: Record<string, unknown> | null;
  oauthAccount: Record<string, unknown> | null;
};

export async function addAccountFromCurrentSession(label: string): Promise<ClaudeAccountRow>;
export async function switchToAccount(accountId: number): Promise<void>;
```

**Deliverable:** the full swap algorithm from the design spec — capture-before-switch, compose,
atomic write of both files, rollback on partial failure — implemented against a real (test) file
tree, not mocked.

**Tests must prove** (all via a `CLAUDE_CONFIG_DIR` pointed at a `fs.mkdtempSync` fixture tree with
a hand-written `.credentials.json` + `.claude.json`, never the real `~/.claude`):
- `addAccountFromCurrentSession` with no live `oauthAccount` throws (no row inserted).
- `addAccountFromCurrentSession` on a valid live session inserts a row whose
  `credentialsSnapshot` contains only account-scoped fields (no `mcpOAuth`).
- `switchToAccount` on a target whose live session was never saved as any row throws
  `UnsavedActiveSessionError`, and leaves both files byte-identical to before the call.
- `switchToAccount` to a saved target: the resulting `.credentials.json` has the target's
  `claudeAiOauth` **and** the pre-switch file's `mcpOAuth` (i.e. shared keys survived).
- `switchToAccount` result: `.claude.json`'s `oauthAccount` equals the target's stored snapshot,
  and every other top-level key in `.claude.json` is byte-identical to before the call.
- `switchToAccount` also updates the **outgoing** account's stored row (capture-before-switch) —
  assert the row that matched the pre-switch live identity now holds the pre-switch live values.
- A forced failure injected between the credentials write and the config write (e.g. make the
  config path temporarily unwritable) leaves `.credentials.json` restored to its pre-switch
  content, not stuck half-switched.

**Acceptance:** `node --import tsx --test lib/__tests__/account-swap.test.ts` passes.

---

## Task 5: API routes

**Files:**
- Create: `app/api/accounts/route.ts` — `GET` (list, with `active` computed by comparing each
  row's identity to `readLiveClaudeState()`), `POST` (body `{ label: string }` →
  `addAccountFromCurrentSession`)
- Create: `app/api/accounts/[id]/route.ts` — `PATCH` (body `{ label: string }` →
  `renameAccount`), `DELETE` (→ `deleteAccount`)
- Create: `app/api/accounts/[id]/switch/route.ts` — `POST` → `switchToAccount`; catches
  `UnsavedActiveSessionError` and responds `409` with its message, any other thrown error →
  `500`.

**Consumes:** Task 3 + Task 4 exports only. No new business logic here — routes are thin
adapters, matching the existing `app/api/pricing/sync/route.ts` / `app/api/budget/route.ts` style
in this codebase.

**Deliverable:** working endpoints, manually verified (this codebase's existing API routes have no
dedicated route-level tests — logic tests live in `lib/__tests__/`, which Tasks 1-4 already cover).

**Acceptance (manual, via `curl` against `npm run dev`):**
- `POST /api/accounts` with a real logged-in session → `200` with the new row.
- `GET /api/accounts` → that row shows `active: true`.
- `POST /api/accounts/<id>/switch` on the already-active account → succeeds as a no-op-safe call
  (composing an account's own live state with itself must not corrupt anything — cover this
  explicitly since it's the first real switch a user will try).
- `POST /api/accounts/999999/switch` (nonexistent id) → `404`.

---

## Task 6: `/accounts` page + Sidebar nav

**Files:**
- Create: `app/accounts/page.tsx`
- Create: `components/AccountsTable.tsx`
- Modify: `components/Sidebar.tsx` — add `{ href: "/accounts", label: "Accounts", icon: SwapIcon }`
  to `NAV_ITEMS`, plus a new small inline `SwapIcon` SVG function (same shape/style as the
  existing `GaugeIcon`/`StackIcon`/`SlidersIcon` — 24x24 viewBox, `currentColor` stroke).

**Consumes:** `GET/POST /api/accounts`, `POST /api/accounts/[id]/switch`, `PATCH`/`DELETE
/api/accounts/[id]` from Task 5.

**Deliverable:** table of Label / Email / Organization / Status / Last saved / actions
(Switch, inline-rename, Remove), a "+ Save current session" inline form pre-filled with the live
`oauthAccount.emailAddress` when available, and a refresh-token-expiry warning badge — reusing
`ProjectTable.tsx`'s table styling and `SummaryCard.tsx`'s card conventions rather than inventing
new visual patterns.

**Acceptance (manual, in the browser against `npm run dev`, per this project's existing
"start the dev server and use the feature" convention):**
- Page loads, shows the account(s) already added via Task 5's manual curl testing.
- Clicking "Switch" on a non-active row flips its Status to "Active now" and the previously-active
  row's Status back to "Saved", without a page reload glitch (client refetches after the switch
  call resolves).
- Renaming and removing both reflect immediately without a full page refresh.
- **Caution during this manual pass:** don't switch away from whichever account is your
  currently-in-use working session unless you've already saved it first — confirm the "unsaved
  active session" 409 path surfaces as a clear error in the UI, not a silent failure.

---

## Self-review notes

- **Spec coverage:** every section of the design spec (data model, swap algorithm, API, UI,
  safety, testing) maps to a task above (3, 4, 5, 6, cross-cutting in 4's tests, 6 respectively).
- **Type consistency:** `ClaudeAccountRow` (Task 3) is the one shape passed to Task 4's functions
  and returned by Task 5's `GET` — no renamed duplicate shape introduced later.
- **No placeholder tasks** — each task above has concrete file paths, concrete function
  signatures, and concrete one-sentence test assertions; the actual code is written during
  implementation, not here.
