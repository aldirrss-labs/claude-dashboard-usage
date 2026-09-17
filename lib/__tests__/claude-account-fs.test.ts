import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getClaudeConfigHome,
  getClaudeCredentialsPath,
  getClaudeGlobalConfigPath,
  atomicWriteJson,
  withLock,
} from "../claude-account-fs";

const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
  if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
});

describe("getClaudeConfigHome", () => {
  it("returns CLAUDE_CONFIG_DIR when set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/some-custom-profile";
    assert.strictEqual(getClaudeConfigHome(), "/tmp/some-custom-profile");
  });

  it("falls back to ~/.claude when unset", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.strictEqual(getClaudeConfigHome(), path.join(os.homedir(), ".claude"));
  });
});

describe("path resolution under CLAUDE_CONFIG_DIR", () => {
  it("puts both credentials and global config inside CLAUDE_CONFIG_DIR when set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/some-custom-profile";
    assert.strictEqual(getClaudeCredentialsPath(), "/tmp/some-custom-profile/.credentials.json");
    assert.strictEqual(getClaudeGlobalConfigPath(), "/tmp/some-custom-profile/.claude.json");
  });
});

describe("atomicWriteJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-account-fs-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes the exact content and leaves no temp file behind", () => {
    const target = path.join(dir, "target.json");
    atomicWriteJson(target, { hello: "world", n: 42 });

    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf-8")), { hello: "world", n: 42 });
    const leftovers = fs.readdirSync(dir).filter((f) => f !== "target.json");
    assert.deepStrictEqual(leftovers, []);
  });

  it("sets file permissions to 0600", () => {
    const target = path.join(dir, "target.json");
    atomicWriteJson(target, { a: 1 });
    const mode = fs.statSync(target).mode & 0o777;
    assert.strictEqual(mode, 0o600);
  });

  it("cleanly overwrites existing content with no partial mix", () => {
    const target = path.join(dir, "target.json");
    atomicWriteJson(target, { version: 1, big: "x".repeat(10_000) });
    atomicWriteJson(target, { version: 2 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf-8")), { version: 2 });
  });
});

describe("withLock", () => {
  let dir: string;
  let lockDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-lock-test-"));
    lockDir = path.join(dir, ".test.lock");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("blocks a second acquire until the first holder releases", async () => {
    const events: string[] = [];

    const first = withLock(lockDir, { stalenessMs: 5000 }, async () => {
      events.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 150));
      events.push("first-end");
    });

    // Give the first call time to actually acquire before starting the second.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = withLock(lockDir, { stalenessMs: 5000 }, async () => {
      events.push("second-start");
    });

    await Promise.all([first, second]);
    assert.deepStrictEqual(events, ["first-start", "first-end", "second-start"]);
  });

  it("takes over a lock directory older than the staleness threshold instead of waiting", async () => {
    fs.mkdirSync(lockDir);
    const staleTime = new Date(Date.now() - 10_000);
    fs.utimesSync(lockDir, staleTime, staleTime);

    const start = Date.now();
    let ran = false;
    await withLock(lockDir, { stalenessMs: 100, timeoutMs: 2000 }, async () => {
      ran = true;
    });
    const elapsed = Date.now() - start;

    assert.strictEqual(ran, true);
    assert.ok(elapsed < 1000, `expected a prompt takeover, took ${elapsed}ms`);
  });

  it("releases the lock directory after fn resolves", async () => {
    await withLock(lockDir, { stalenessMs: 5000 }, async () => {});
    assert.strictEqual(fs.existsSync(lockDir), false);
  });

  it("releases the lock directory and propagates the error when fn throws", async () => {
    await assert.rejects(
      withLock(lockDir, { stalenessMs: 5000 }, async () => {
        throw new Error("boom");
      }),
      /boom/
    );
    assert.strictEqual(fs.existsSync(lockDir), false);
  });
});
