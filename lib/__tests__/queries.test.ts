import "./test-db-setup";
import { describe, it } from "node:test";
import assert from "node:assert";
import { getDb } from "../db";
import { getDashboardSummary, listProjects, getProjectDetail, getDailyReport } from "../queries";

function seedFixture() {
  const db = getDb();
  db.exec("DELETE FROM usage_events; DELETE FROM sessions; DELETE FROM projects;");
  db.prepare(
    `INSERT INTO projects (id, slug, display_path, display_name, first_seen_at, last_active_at) VALUES (1, 'p1', '/p1', 'p1', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id, project_id, started_at, ended_at, message_count) VALUES ('s1', 1, datetime('now'), datetime('now'), 1)`
  ).run();
  db.prepare(
    `INSERT INTO usage_events (session_id, project_id, timestamp, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens)
     VALUES ('s1', 1, datetime('now'), 'claude-sonnet-5', 1000000, 0, 1000000, 1000000)`
  ).run();
}

describe("getDashboardSummary", () => {
  it("computes total tokens, cost, and cache efficiency", () => {
    seedFixture();
    const summary = getDashboardSummary(30);
    assert.strictEqual(summary.totalTokens, 3_000_000);
    assert.strictEqual(summary.activeProjectCount, 1);
    // sonnet-5: input $3/1M, output $15/1M, cache_read $0.3/1M
    // cost = 1*3 + 1*15 + 1*0.3 = 18.3
    assert.ok(Math.abs(summary.totalCostUsd - 18.3) < 0.001);
    // cache efficiency = cache_read / (cache_read + input) = 1/(1+1) = 50%
    assert.ok(Math.abs(summary.cacheEfficiencyPct - 50) < 0.001);
  });
});

describe("listProjects and getProjectDetail", () => {
  it("returns project aggregates and session-level detail", () => {
    seedFixture();
    const projects = listProjects();
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].slug, "p1");
    assert.strictEqual(projects[0].sessionCount, 1);

    const detail = getProjectDetail("p1");
    assert.ok(detail);
    assert.strictEqual(detail!.sessions.length, 1);
    assert.strictEqual(detail!.sessions[0].id, "s1");

    assert.strictEqual(getProjectDetail("nonexistent"), null);
  });
});

describe("getDailyReport", () => {
  it("matches usage_events whose timestamp uses the real ingest format (ISO 8601 with T/Z)", () => {
    const db = getDb();
    db.exec("DELETE FROM usage_events; DELETE FROM sessions; DELETE FROM projects;");
    db.prepare(
      `INSERT INTO projects (id, slug, display_path, display_name, first_seen_at, last_active_at) VALUES (1, 'p1', '/p1', 'p1', datetime('now'), datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, project_id, started_at, ended_at, message_count) VALUES ('s1', 1, datetime('now'), datetime('now'), 1)`
    ).run();
    // Real ingest.ts writes timestamps straight from JSONL, e.g. "2026-08-17T10:00:00.000Z" —
    // not SQLite's datetime('now') space-separated format. getDailyReport's date-range
    // bounds must match this exact shape or the query silently matches zero rows.
    db.prepare(
      `INSERT INTO usage_events (session_id, project_id, timestamp, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens)
       VALUES ('s1', 1, '2026-08-17T10:00:00.000Z', 'claude-sonnet-5', 1000000, 0, 1000000, 1000000)`
    ).run();

    const report = getDailyReport("2026-08-17");
    assert.strictEqual(report.totalTokens, 3_000_000);
    assert.ok(Math.abs(report.totalCostUsd - 18.3) < 0.001);
    assert.strictEqual(report.byProject.length, 1);
    assert.strictEqual(report.byProject[0].displayName, "p1");
    assert.strictEqual(report.byModel.length, 1);
    assert.strictEqual(report.byModel[0].model, "claude-sonnet-5");
  });
});
