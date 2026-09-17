import { getDb } from "./db";

export interface ClaudeAccountRow {
  id: number;
  label: string;
  email: string | null;
  organizationUuid: string;
  accountUuid: string;
  credentialsSnapshot: string;
  oauthAccountSnapshot: string;
  createdAt: string;
  updatedAt: string;
  disabled: boolean;
  lastUsedAt: string | null;
  usageSnapshot: string | null;
  usageFetchedAt: string | null;
  usageError: string | null;
  reloginRequired: boolean;
}

interface ClaudeAccountDbRow {
  id: number;
  label: string;
  email: string | null;
  organization_uuid: string;
  account_uuid: string;
  credentials_snapshot: string;
  oauth_account_snapshot: string;
  created_at: string;
  updated_at: string;
  disabled: number;
  last_used_at: string | null;
  usage_snapshot: string | null;
  usage_fetched_at: string | null;
  usage_error: string | null;
  relogin_required: number;
}

function toRow(row: ClaudeAccountDbRow): ClaudeAccountRow {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    organizationUuid: row.organization_uuid,
    accountUuid: row.account_uuid,
    credentialsSnapshot: row.credentials_snapshot,
    oauthAccountSnapshot: row.oauth_account_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabled: row.disabled === 1,
    lastUsedAt: row.last_used_at,
    usageSnapshot: row.usage_snapshot,
    usageFetchedAt: row.usage_fetched_at,
    usageError: row.usage_error,
    reloginRequired: row.relogin_required === 1,
  };
}

export function listAccounts(): ClaudeAccountRow[] {
  const rows = getDb().prepare(`SELECT * FROM claude_accounts ORDER BY label ASC`).all() as ClaudeAccountDbRow[];
  return rows.map(toRow);
}

export function getAccountById(id: number): ClaudeAccountRow | null {
  const row = getDb().prepare(`SELECT * FROM claude_accounts WHERE id = ?`).get(id) as
    | ClaudeAccountDbRow
    | undefined;
  return row ? toRow(row) : null;
}

export function findAccountByIdentity(organizationUuid: string, accountUuid: string): ClaudeAccountRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM claude_accounts WHERE organization_uuid = ? AND account_uuid = ?`)
    .get(organizationUuid, accountUuid) as ClaudeAccountDbRow | undefined;
  return row ? toRow(row) : null;
}

export function upsertAccountFromLive(input: {
  label: string;
  email: string | null;
  organizationUuid: string;
  accountUuid: string;
  credentialsSnapshot: string;
  oauthAccountSnapshot: string;
}): ClaudeAccountRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO claude_accounts
       (label, email, organization_uuid, account_uuid, credentials_snapshot, oauth_account_snapshot, created_at, updated_at)
     VALUES (@label, @email, @organizationUuid, @accountUuid, @credentialsSnapshot, @oauthAccountSnapshot, datetime('now'), datetime('now'))
     ON CONFLICT(organization_uuid, account_uuid) DO UPDATE SET
       label = excluded.label,
       email = excluded.email,
       credentials_snapshot = excluded.credentials_snapshot,
       oauth_account_snapshot = excluded.oauth_account_snapshot,
       updated_at = datetime('now')`
  ).run(input);
  return findAccountByIdentity(input.organizationUuid, input.accountUuid)!;
}

export function renameAccount(id: number, label: string): void {
  getDb().prepare(`UPDATE claude_accounts SET label = ?, updated_at = datetime('now') WHERE id = ?`).run(label, id);
}

export function deleteAccount(id: number): void {
  getDb().prepare(`DELETE FROM claude_accounts WHERE id = ?`).run(id);
}

export function setAccountDisabled(id: number, disabled: boolean): void {
  getDb()
    .prepare(`UPDATE claude_accounts SET disabled = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(disabled ? 1 : 0, id);
}

export function markAccountUsed(id: number): void {
  getDb().prepare(`UPDATE claude_accounts SET last_used_at = datetime('now') WHERE id = ?`).run(id);
}

/**
 * Persist a rotated refresh token. Called after every successful refresh —
 * the old token is single-use, so skipping this bricks the next refresh.
 */
export function updateCredentialsSnapshot(id: number, credentialsSnapshot: string): void {
  getDb()
    .prepare(`UPDATE claude_accounts SET credentials_snapshot = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(credentialsSnapshot, id);
}

export function saveAccountUsage(id: number, usageJson: string): void {
  getDb()
    .prepare(
      `UPDATE claude_accounts
         SET usage_snapshot = ?, usage_fetched_at = datetime('now'), usage_error = NULL, relogin_required = 0
       WHERE id = ?`
    )
    .run(usageJson, id);
}

/**
 * Record why a usage fetch failed. The last good `usage_snapshot` is kept so
 * the UI can keep showing it (greyed out) instead of blanking the row.
 */
export function saveAccountUsageError(id: number, message: string, reloginRequired: boolean): void {
  getDb()
    .prepare(`UPDATE claude_accounts SET usage_error = ?, relogin_required = ? WHERE id = ?`)
    .run(message, reloginRequired ? 1 : 0, id);
}
