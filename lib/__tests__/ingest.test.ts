import "./test-db-setup";
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseUsageLine } from "../ingest";

describe("parseUsageLine", () => {
  it("extracts usage and cwd from a valid assistant message line", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      cwd: "/mnt/data/Project/WEB/artist-catalog",
      message: {
        model: "claude-sonnet-5",
        usage: {
          input_tokens: 3,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 200,
          output_tokens: 50,
        },
      },
    });
    const result = parseUsageLine(line);
    assert.deepStrictEqual(result, {
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      cwd: "/mnt/data/Project/WEB/artist-catalog",
      model: "claude-sonnet-5",
      input_tokens: 3,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 200,
      output_tokens: 50,
    });
  });

  it("returns null for non-assistant lines", () => {
    const line = JSON.stringify({ type: "queue-operation", operation: "enqueue" });
    assert.strictEqual(parseUsageLine(line), null);
  });

  it("returns null for assistant lines without usage", () => {
    const line = JSON.stringify({ type: "assistant", sessionId: "x", message: {} });
    assert.strictEqual(parseUsageLine(line), null);
  });

  it("returns null for malformed JSON (truncated line)", () => {
    const line = '{"type":"assistant","message":{"usage":{"input_tokens":1';
    assert.strictEqual(parseUsageLine(line), null);
  });

  it('defaults model to "unknown" when missing', () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      message: { usage: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = parseUsageLine(line);
    assert.strictEqual(result?.model, "unknown");
  });

  it("defaults cwd to null when missing", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "abc-123",
      timestamp: "2026-08-14T10:00:00.000Z",
      message: { usage: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = parseUsageLine(line);
    assert.strictEqual(result?.cwd, null);
  });
});

describe("runIngestCycle", () => {
  it("ingests new lines incrementally without re-reading old bytes", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-projects-"));
    const projectDir = path.join(tmpRoot, "-tmp-fake-project");
    fs.mkdirSync(projectDir);
    const filePath = path.join(projectDir, "session-1.jsonl");

    const line1 = JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-08-14T10:00:00.000Z",
      cwd: "/tmp/fake-project",
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
      },
    });
    fs.writeFileSync(filePath, line1 + "\n");

    const { runIngestCycle } = await import("../ingest");
    const first = runIngestCycle(tmpRoot);
    assert.strictEqual(first.eventsInserted, 1);

    const line2 = JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-08-14T10:05:00.000Z",
      cwd: "/tmp/fake-project",
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 },
      },
    });
    fs.appendFileSync(filePath, line2 + "\n");

    const second = runIngestCycle(tmpRoot);
    assert.strictEqual(second.eventsInserted, 1);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
