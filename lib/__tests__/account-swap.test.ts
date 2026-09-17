import "./test-db-setup";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db";
import { upsertAccountFromLive, getAccountById, listAccounts } from "../account-queries";
import {
  readLiveClaudeState,
  addAccountFromCurrentSession,
  switchToAccount,
  UnsavedActiveSessionError,
  AccountNotFoundError,
} from "../account-swap";

const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
const ORIGINAL_HOME = process.env.HOME;

let fixtureDir: string;

beforeEach(() => {
  getDb().exec("DELETE FROM claude_accounts;");
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-account-swap-test-"));
  process.env.CLAUDE_CONFIG_DIR = fixtureDir;
});

afterEach(() => {
  if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function writeFixture(
  credentials: Record<string, unknown> | null,
  oauthAccount: Record<string, unknown> | null,
  extraConfigKeys: Record<string, unknown> = {}
) {
  if (credentials !== null) {
    fs.writeFileSync(path.join(fixtureDir, ".credentials.json"), JSON.stringify(credentials));
  }
  const config: Record<string, unknown> = { ...extraConfigKeys };
  if (oauthAccount !== null) config.oauthAccount = oauthAccount;
  fs.writeFileSync(path.join(fixtureDir, ".claude.json"), JSON.stringify(config));
}

const LIVE_A_CREDENTIALS = {
  claudeAiOauth: { accessToken: "at-a-live", refreshToken: "rt-a" },
  organizationUuid: "org-a",
  mcpOAuth: { figma: { accessToken: "figma-token-live" } },
};
const LIVE_A_OAUTH_ACCOUNT = { accountUuid: "acct-a", organizationUuid: "org-a", emailAddress: "a@example.com" };

describe("readLiveClaudeState", () => {
  it("reads credentials and oauthAccount from the CLAUDE_CONFIG_DIR-resolved paths", () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT);
    const state = readLiveClaudeState();
    assert.deepStrictEqual(state.credentials, LIVE_A_CREDENTIALS);
    assert.deepStrictEqual(state.oauthAccount, LIVE_A_OAUTH_ACCOUNT);
  });
});

describe("addAccountFromCurrentSession", () => {
  it("throws and inserts no row when there is no live oauthAccount", async () => {
    writeFixture(LIVE_A_CREDENTIALS, null);
    await assert.rejects(addAccountFromCurrentSession("Personal"));
    assert.strictEqual(listAccounts().length, 0);
  });

  it("saves a row whose credentials snapshot excludes shared MCP keys", async () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT);
    const row = await addAccountFromCurrentSession("Personal");
    const snapshot = JSON.parse(row.credentialsSnapshot);
    assert.ok(!("mcpOAuth" in snapshot));
    assert.deepStrictEqual(snapshot.claudeAiOauth, LIVE_A_CREDENTIALS.claudeAiOauth);
  });
});

describe("switchToAccount", () => {
  it("throws UnsavedActiveSessionError and leaves both files untouched when the live session isn't saved", async () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT); // live session, never saved
    const target = upsertAccountFromLive({
      label: "Work B",
      email: "b@example.com",
      organizationUuid: "org-b",
      accountUuid: "acct-b",
      credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-b" }, organizationUuid: "org-b" }),
      oauthAccountSnapshot: JSON.stringify({ accountUuid: "acct-b", organizationUuid: "org-b", emailAddress: "b@example.com" }),
    });

    const credentialsPath = path.join(fixtureDir, ".credentials.json");
    const configPath = path.join(fixtureDir, ".claude.json");
    const beforeCredentials = fs.readFileSync(credentialsPath, "utf-8");
    const beforeConfig = fs.readFileSync(configPath, "utf-8");

    await assert.rejects(switchToAccount(target.id), UnsavedActiveSessionError);

    assert.strictEqual(fs.readFileSync(credentialsPath, "utf-8"), beforeCredentials);
    assert.strictEqual(fs.readFileSync(configPath, "utf-8"), beforeConfig);
  });

  it("throws AccountNotFoundError for a nonexistent account id", async () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT);
    await assert.rejects(switchToAccount(999_999), AccountNotFoundError);
  });

  it("composes the target's claudeAiOauth with the live session's shared MCP keys", async () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT, { someOtherKey: "untouched", projects: { p: 1 } });
    await addAccountFromCurrentSession("Personal (A)");

    const targetCredentials = { claudeAiOauth: { accessToken: "at-b-stored" }, organizationUuid: "org-b" };
    const targetOauthAccount = { accountUuid: "acct-b", organizationUuid: "org-b", emailAddress: "b@example.com" };
    const target = upsertAccountFromLive({
      label: "Work B",
      email: "b@example.com",
      organizationUuid: "org-b",
      accountUuid: "acct-b",
      credentialsSnapshot: JSON.stringify(targetCredentials),
      oauthAccountSnapshot: JSON.stringify(targetOauthAccount),
    });

    await switchToAccount(target.id);

    const newCredentials = JSON.parse(fs.readFileSync(path.join(fixtureDir, ".credentials.json"), "utf-8"));
    assert.deepStrictEqual(newCredentials.claudeAiOauth, targetCredentials.claudeAiOauth);
    assert.deepStrictEqual(newCredentials.mcpOAuth, LIVE_A_CREDENTIALS.mcpOAuth);

    const newConfig = JSON.parse(fs.readFileSync(path.join(fixtureDir, ".claude.json"), "utf-8"));
    assert.deepStrictEqual(newConfig.oauthAccount, targetOauthAccount);
    assert.strictEqual(newConfig.someOtherKey, "untouched");
    assert.deepStrictEqual(newConfig.projects, { p: 1 });
  });

  it("captures the outgoing account's refreshed live token before switching away (capture-before-switch)", async () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT);
    // A was saved earlier with a STALE token; Claude Code has since refreshed it live.
    const staleA = upsertAccountFromLive({
      label: "Personal (A)",
      email: "a@example.com",
      organizationUuid: "org-a",
      accountUuid: "acct-a",
      credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-a-STALE" }, organizationUuid: "org-a" }),
      oauthAccountSnapshot: JSON.stringify(LIVE_A_OAUTH_ACCOUNT),
    });
    const target = upsertAccountFromLive({
      label: "Work B",
      email: "b@example.com",
      organizationUuid: "org-b",
      accountUuid: "acct-b",
      credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-b" }, organizationUuid: "org-b" }),
      oauthAccountSnapshot: JSON.stringify({ accountUuid: "acct-b", organizationUuid: "org-b", emailAddress: "b@example.com" }),
    });

    await switchToAccount(target.id);

    const refreshedA = getAccountById(staleA.id)!;
    const refreshedASnapshot = JSON.parse(refreshedA.credentialsSnapshot);
    assert.strictEqual(refreshedASnapshot.claudeAiOauth.accessToken, "at-a-live");
  });

  it("switching to the already-active account is a safe no-op (does not roll back a refreshed live token)", async () => {
    writeFixture(LIVE_A_CREDENTIALS, LIVE_A_OAUTH_ACCOUNT);
    const staleA = upsertAccountFromLive({
      label: "Personal (A)",
      email: "a@example.com",
      organizationUuid: "org-a",
      accountUuid: "acct-a",
      credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-a-STALE" }, organizationUuid: "org-a" }),
      oauthAccountSnapshot: JSON.stringify(LIVE_A_OAUTH_ACCOUNT),
    });

    await switchToAccount(staleA.id);

    const newCredentials = JSON.parse(fs.readFileSync(path.join(fixtureDir, ".credentials.json"), "utf-8"));
    assert.strictEqual(newCredentials.claudeAiOauth.accessToken, "at-a-live");
  });

  it("rolls back the credentials write when the config write fails partway through", async () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-account-swap-home-test-"));
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), JSON.stringify(LIVE_A_CREDENTIALS));
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: LIVE_A_OAUTH_ACCOUNT, someOtherKey: "untouched" }));

    await addAccountFromCurrentSession("Personal (A)");
    const target = upsertAccountFromLive({
      label: "Work B",
      email: "b@example.com",
      organizationUuid: "org-b",
      accountUuid: "acct-b",
      credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-b" }, organizationUuid: "org-b" }),
      oauthAccountSnapshot: JSON.stringify({ accountUuid: "acct-b", organizationUuid: "org-b", emailAddress: "b@example.com" }),
    });

    const credentialsPath = path.join(home, ".claude", ".credentials.json");
    const configPath = path.join(home, ".claude.json");
    const originalCredentials = fs.readFileSync(credentialsPath, "utf-8");
    const originalConfig = fs.readFileSync(configPath, "utf-8");

    // Home dir loses write permission: creating the config's temp file fails,
    // while .claude/ (a separate directory, its own mode) still accepts the
    // credentials write — reproducing a failure strictly between the two writes.
    fs.chmodSync(home, 0o500);
    try {
      await assert.rejects(switchToAccount(target.id));
    } finally {
      fs.chmodSync(home, 0o700);
    }

    assert.strictEqual(fs.readFileSync(credentialsPath, "utf-8"), originalCredentials);
    assert.strictEqual(fs.readFileSync(configPath, "utf-8"), originalConfig);

    fs.rmSync(home, { recursive: true, force: true });
  });
});
