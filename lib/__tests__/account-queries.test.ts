import "./test-db-setup";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { getDb } from "../db";
import {
  listAccounts,
  findAccountByIdentity,
  getAccountById,
  upsertAccountFromLive,
  renameAccount,
  deleteAccount,
} from "../account-queries";

beforeEach(() => {
  getDb().exec("DELETE FROM claude_accounts;");
});

function baseInput(overrides: Partial<Parameters<typeof upsertAccountFromLive>[0]> = {}) {
  return {
    label: "Personal",
    email: "me@example.com",
    organizationUuid: "org-1",
    accountUuid: "acct-1",
    credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-1" } }),
    oauthAccountSnapshot: JSON.stringify({ emailAddress: "me@example.com" }),
    ...overrides,
  };
}

describe("upsertAccountFromLive", () => {
  it("inserts a new row for a new identity", () => {
    const row = upsertAccountFromLive(baseInput());
    assert.strictEqual(row.label, "Personal");
    assert.strictEqual(listAccounts().length, 1);
  });

  it("updates the existing row instead of inserting a duplicate for the same identity", () => {
    const first = upsertAccountFromLive(baseInput());
    const second = upsertAccountFromLive(
      baseInput({ credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-2" } }) })
    );

    assert.strictEqual(listAccounts().length, 1);
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(second.credentialsSnapshot, JSON.stringify({ claudeAiOauth: { accessToken: "at-2" } }));
  });
});

describe("findAccountByIdentity", () => {
  it("returns null for an identity that was never added", () => {
    assert.strictEqual(findAccountByIdentity("no-such-org", "no-such-acct"), null);
  });

  it("finds a previously added account by its identity", () => {
    upsertAccountFromLive(baseInput());
    const found = findAccountByIdentity("org-1", "acct-1");
    assert.ok(found);
    assert.strictEqual(found?.label, "Personal");
  });
});

describe("renameAccount", () => {
  it("changes only the label and updated_at, leaving every other column unchanged", () => {
    const original = upsertAccountFromLive(baseInput());
    renameAccount(original.id, "Work Team A");
    const renamed = getAccountById(original.id);

    assert.ok(renamed);
    assert.strictEqual(renamed?.label, "Work Team A");
    assert.strictEqual(renamed?.email, original.email);
    assert.strictEqual(renamed?.organizationUuid, original.organizationUuid);
    assert.strictEqual(renamed?.accountUuid, original.accountUuid);
    assert.strictEqual(renamed?.credentialsSnapshot, original.credentialsSnapshot);
    assert.strictEqual(renamed?.oauthAccountSnapshot, original.oauthAccountSnapshot);
    assert.strictEqual(renamed?.createdAt, original.createdAt);
  });
});

describe("deleteAccount", () => {
  it("removes exactly the targeted row", () => {
    const a = upsertAccountFromLive(baseInput());
    const b = upsertAccountFromLive(baseInput({ organizationUuid: "org-2", accountUuid: "acct-2", label: "Work Team B" }));

    deleteAccount(a.id);

    const remaining = listAccounts();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].id, b.id);
  });
});
