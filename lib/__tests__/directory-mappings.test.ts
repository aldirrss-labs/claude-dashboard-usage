import "./test-db-setup";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db";
import { upsertAccountFromLive } from "../account-queries";
import {
  isAncestorOrSame,
  normalizeDir,
  resolveMappingForDir,
  setMapping,
  deleteMapping,
  listMappings,
} from "../directory-mappings";

function makeAccount(label: string, uuid: string): number {
  return upsertAccountFromLive({
    label,
    email: `${label}@example.com`,
    organizationUuid: `org-${uuid}`,
    accountUuid: `acct-${uuid}`,
    credentialsSnapshot: "{}",
    oauthAccountSnapshot: "{}",
  }).id;
}

let tmpRoot: string;

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM directory_mappings").run();
  db.prepare("DELETE FROM claude_accounts").run();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dirmap-"));
});

describe("normalizeDir", () => {
  it("expands ~ to the home directory", () => {
    assert.strictEqual(normalizeDir("~"), fs.realpathSync(os.homedir()));
    assert.strictEqual(
      normalizeDir("~/Project"),
      path.join(fs.realpathSync(os.homedir()), "Project")
    );
  });

  it("drops a trailing slash and resolves . and ..", () => {
    const a = normalizeDir(`${tmpRoot}/`);
    const b = normalizeDir(`${tmpRoot}/./`);
    const c = normalizeDir(`${tmpRoot}/sub/..`);
    assert.strictEqual(a, b);
    assert.strictEqual(a, c);
    assert.ok(!a.endsWith(path.sep));
  });

  it("follows symlinks so both spellings produce one key", () => {
    const real = path.join(tmpRoot, "real-project");
    const link = path.join(tmpRoot, "linked-project");
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    assert.strictEqual(normalizeDir(link), normalizeDir(real));
  });

  it("keeps a directory that does not exist yet", () => {
    const missing = path.join(tmpRoot, "not-created-yet");
    assert.strictEqual(normalizeDir(missing), missing);
  });
});

describe("isAncestorOrSame", () => {
  it("matches a directory against itself and its children", () => {
    assert.ok(isAncestorOrSame("/home/a/proj", "/home/a/proj"));
    assert.ok(isAncestorOrSame("/home/a/proj", "/home/a/proj/src/deep"));
  });

  it("does not match a sibling that merely shares a string prefix", () => {
    // The bug a naive startsWith() would introduce.
    assert.ok(!isAncestorOrSame("/home/a/proj", "/home/a/project-two"));
    assert.ok(!isAncestorOrSame("/home/a/proj", "/home/a/projX"));
  });
});

describe("resolveMappingForDir", () => {
  it("returns null when nothing matches", () => {
    assert.strictEqual(resolveMappingForDir(tmpRoot), null);
  });

  it("resolves a subdirectory through its mapped ancestor", () => {
    const id = makeAccount("work", "w");
    const parent = path.join(tmpRoot, "Project");
    fs.mkdirSync(path.join(parent, "a", "b"), { recursive: true });
    setMapping(parent, id);

    const resolved = resolveMappingForDir(path.join(parent, "a", "b"));
    assert.ok(resolved);
    assert.strictEqual(resolved!.account.id, id);
  });

  it("prefers the deepest mapping when several match", () => {
    const general = makeAccount("general", "g");
    const specific = makeAccount("specific", "s");
    const parent = path.join(tmpRoot, "Project");
    const child = path.join(parent, "client-x");
    fs.mkdirSync(child, { recursive: true });

    setMapping(parent, general);
    setMapping(child, specific);

    assert.strictEqual(resolveMappingForDir(child)!.account.id, specific);
    assert.strictEqual(resolveMappingForDir(path.join(child, "deep"))!.account.id, specific);
    // A sibling still falls back to the general rule.
    assert.strictEqual(resolveMappingForDir(path.join(parent, "other"))!.account.id, general);
  });

  it("does not leak a mapping to a sibling with a shared prefix", () => {
    const id = makeAccount("work", "w");
    const mapped = path.join(tmpRoot, "proj");
    fs.mkdirSync(mapped, { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "proj-two"), { recursive: true });
    setMapping(mapped, id);

    assert.strictEqual(resolveMappingForDir(path.join(tmpRoot, "proj-two")), null);
  });

  it("skips a mapping whose account was deleted, falling back to a shallower one", () => {
    const general = makeAccount("general", "g");
    const doomed = makeAccount("doomed", "d");
    const parent = path.join(tmpRoot, "Project");
    const child = path.join(parent, "client-x");
    fs.mkdirSync(child, { recursive: true });

    setMapping(parent, general);
    setMapping(child, doomed);
    getDb().prepare("DELETE FROM claude_accounts WHERE id = ?").run(doomed);

    const resolved = resolveMappingForDir(child);
    assert.ok(resolved);
    assert.strictEqual(resolved!.account.id, general);
  });

  it("re-pointing a directory replaces rather than duplicates the mapping", () => {
    const first = makeAccount("first", "1");
    const second = makeAccount("second", "2");
    const dir = path.join(tmpRoot, "Project");
    fs.mkdirSync(dir, { recursive: true });

    setMapping(dir, first);
    setMapping(dir, second);

    assert.strictEqual(listMappings().length, 1);
    assert.strictEqual(resolveMappingForDir(dir)!.account.id, second);
  });

  it("removes a mapping regardless of how the path was typed", () => {
    const id = makeAccount("work", "w");
    const dir = path.join(tmpRoot, "Project");
    fs.mkdirSync(dir, { recursive: true });
    setMapping(dir, id);

    deleteMapping(`${dir}/`);
    assert.strictEqual(listMappings().length, 0);
  });

  it("rejects a mapping to an account that does not exist", () => {
    assert.throws(() => setMapping(tmpRoot, 9999), /No saved account/);
  });
});
