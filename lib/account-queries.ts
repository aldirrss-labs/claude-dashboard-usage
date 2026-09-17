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
