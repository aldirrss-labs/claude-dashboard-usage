import { getDb } from "./db";
import { findAccountByIdentity } from "./account-queries";
import { readLiveClaudeState } from "./claude-live-state";

export interface ActivationRow {
  id: number;
  accountId: number | null;
  organizationUuid: string;
  accountUuid: string;
  label: string | null;
  startedAt: string;
  endedAt: string | null;
  source: string;
}

function currentActivation(): ActivationRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM account_activations WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`)
    .get() as
    | {
        id: number;
        account_id: number | null;
        organization_uuid: string;
        account_uuid: string;
        label: string | null;
        started_at: string;
        ended_at: string | null;
        source: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    organizationUuid: row.organization_uuid,
    accountUuid: row.account_uuid,
    label: row.label,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
  };
}

/**
 * Note which account is live right now, opening a new activation period if it
 * differs from the one currently open.
 *
 * Called from two places, deliberately: `switchToAccount` calls it the instant
 * it swaps (so a dashboard-driven switch has an exact boundary), and the ingest
 * tick calls it every cycle (so a switch made outside the dashboard — with the
 * `claude` CLI, or cswap — is still noticed, just up to one interval late).
 *
 * Returns true when a new period was opened.
 */
export function recordActiveAccount(source: "switch" | "poll"): boolean {
  const live = readLiveClaudeState();
  const organizationUuid = live.oauthAccount?.organizationUuid;
  const accountUuid = live.oauthAccount?.accountUuid;
  if (typeof organizationUuid !== "string" || typeof accountUuid !== "string") return false;

  const open = currentActivation();
  if (open && open.organizationUuid === organizationUuid && open.accountUuid === accountUuid) {
    return false; // unchanged; the open period still stands
  }

  const saved = findAccountByIdentity(organizationUuid, accountUuid);
  const db = getDb();

  const tx = db.transaction(() => {
    if (open) {
      db.prepare(`UPDATE account_activations SET ended_at = datetime('now') WHERE id = ?`).run(open.id);
    }
    db.prepare(
      `INSERT INTO account_activations
         (account_id, organization_uuid, account_uuid, label, started_at, ended_at, source)
       VALUES (?, ?, ?, ?, datetime('now'), NULL, ?)`
    ).run(
      saved?.id ?? null,
      organizationUuid,
      accountUuid,
      // Snapshot the label: the account may be renamed or removed later, and a
      // historical period should still say who it was.
      saved?.label ?? (typeof live.oauthAccount?.emailAddress === "string" ? live.oauthAccount.emailAddress : null),
      source
    );
  });
  tx();

  return true;
}

export function listActivations(): ActivationRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM account_activations ORDER BY started_at ASC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    accountId: (r.account_id as number | null) ?? null,
    organizationUuid: r.organization_uuid as string,
    accountUuid: r.account_uuid as string,
    label: (r.label as string | null) ?? null,
    startedAt: r.started_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
    source: r.source as string,
  }));
}

export interface AccountUsageComparisonRow {
  key: string;
  label: string;
  attributed: boolean;
  tokens: number;
  costUsd: number;
  events: number;
  sessions: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

/** The earliest moment any attribution exists; usage before it cannot be assigned. */
export function attributionStartedAt(): string | null {
  const row = getDb().prepare(`SELECT MIN(started_at) as t FROM account_activations`).get() as {
    t: string | null;
  };
  return row.t;
}
