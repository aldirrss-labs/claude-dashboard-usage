import { describe, it } from "node:test";
import assert from "node:assert";
import { decodeProjectSlug } from "../paths";
import { getDb } from "../db";

describe("decodeProjectSlug", () => {
  it("converts a project slug into a best-effort absolute path fallback", () => {
    const result = decodeProjectSlug("-mnt-data-Project-WEB-artist-catalog");
    assert.strictEqual(result, "/mnt/data/Project/WEB/artist/catalog");
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
