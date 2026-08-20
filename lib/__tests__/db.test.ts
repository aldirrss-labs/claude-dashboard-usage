import "./test-db-setup";
import { describe, it } from "node:test";
import assert from "node:assert";
import { decodeProjectSlug, normalizeCanonicalPath } from "../paths";
import { getDb } from "../db";

describe("decodeProjectSlug", () => {
  it("converts a project slug into a best-effort absolute path fallback", () => {
    const result = decodeProjectSlug("-mnt-data-Project-WEB-artist-catalog");
    assert.strictEqual(result, "/mnt/data/Project/WEB/artist/catalog");
  });
});

describe("normalizeCanonicalPath", () => {
  it("strips a slug-suffix worktree marker", () => {
    const result = normalizeCanonicalPath(
      "/mnt/data/Project/automation/development-agent--claude-worktrees-pipeline-stage-state"
    );
    assert.strictEqual(result, "/mnt/data/Project/automation/development-agent");
  });

  it("strips a native git worktree path segment (mid-path, with trailing subdir)", () => {
    const result = normalizeCanonicalPath(
      "/mnt/data/Project/gsheet-appscript/CLT-005_taufiq/.claude/worktrees/fase-a-schema-geofencing/absensi_taufiq"
    );
    assert.strictEqual(result, "/mnt/data/Project/gsheet-appscript/CLT-005_taufiq");
  });

  it("strips a native git worktree path segment with no trailing subdir", () => {
    const result = normalizeCanonicalPath(
      "/mnt/data/Project/gsheet-appscript/CLT-005_taufiq/.claude/worktrees/fase-b-closing-shift-rekonsiliasi"
    );
    assert.strictEqual(result, "/mnt/data/Project/gsheet-appscript/CLT-005_taufiq");
  });

  it("leaves a normal path untouched", () => {
    const result = normalizeCanonicalPath("/mnt/data/Project/WEB/claude-dashboard-usage");
    assert.strictEqual(result, "/mnt/data/Project/WEB/claude-dashboard-usage");
  });
});

describe("getDb", () => {
  it("initializes schema and seeds default pricing exactly once", () => {
    const db = getDb();
    const db2 = getDb();
    assert.strictEqual(db, db2);
    const row = db.prepare("SELECT * FROM model_pricing WHERE model = ?").get("claude-sonnet-5") as
      | { input_price: number }
      | undefined;
    assert.ok(row);
    assert.strictEqual(row!.input_price, 3);
  });
});
