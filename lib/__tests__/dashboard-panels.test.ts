import "./test-db-setup";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { getDb } from "../db";
import {
  getActivityHeatmap,
  getProjectModelBreakdown,
  getSessionStats,
  getTokenComposition,
} from "../queries";

interface EventInput {
  session: string;
  project: number;
  model: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** SQLite datetime modifier, e.g. '-2 days'. */
  at?: string;
}

function addProject(id: number, name: string): void {
  getDb()
    .prepare(
      `INSERT INTO projects (id, slug, display_path, display_name, first_seen_at, last_active_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(id, name, `/${name}`, name);
}

function addEvent(e: EventInput): void {
  // usage_events.session_id has a foreign key to sessions, so the parent row
  // has to exist; several events may share one session.
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sessions (id, project_id, started_at, ended_at, message_count)
       VALUES (?, ?, datetime('now'), datetime('now'), 1)`
    )
    .run(e.session, e.project);

  getDb()
    .prepare(
      `INSERT INTO usage_events
         (session_id, project_id, timestamp, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens)
       VALUES (?, ?, datetime('now', ?), ?, ?, ?, ?, ?)`
    )
    .run(
      e.session,
      e.project,
      e.at ?? "-1 hour",
      e.model,
      e.input ?? 0,
      e.cacheWrite ?? 0,
      e.cacheRead ?? 0,
      e.output ?? 0
    );
}

beforeEach(() => {
  getDb().exec("DELETE FROM usage_events; DELETE FROM sessions; DELETE FROM projects;");
});

describe("getTokenComposition", () => {
  it("splits the four token kinds by volume and by cost", () => {
    addProject(1, "p1");
    // sonnet-5: in $2, out $10, cache read $0.2, cache write $2.50 per MTok.
    addEvent({ session: "s1", project: 1, model: "claude-sonnet-5", input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 });

    const rows = getTokenComposition(30);
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    assert.strictEqual(byKind.get("Input")!.tokens, 1_000_000);
    assert.ok(Math.abs(byKind.get("Input")!.costUsd - 2) < 1e-9);
    assert.ok(Math.abs(byKind.get("Output")!.costUsd - 10) < 1e-9);
    assert.ok(Math.abs(byKind.get("Cache read")!.costUsd - 0.2) < 1e-9);
    assert.ok(Math.abs(byKind.get("Cache write")!.costUsd - 2.5) < 1e-9);
  });

  it("prices each model separately rather than pooling tokens first", () => {
    addProject(1, "p1");
    // Same 1M of output on two models priced differently: opus-5 $25, sonnet-5 $10.
    addEvent({ session: "s1", project: 1, model: "claude-opus-5", output: 1_000_000 });
    addEvent({ session: "s2", project: 1, model: "claude-sonnet-5", output: 1_000_000 });

    const output = getTokenComposition(30).find((r) => r.kind === "Output")!;
    assert.strictEqual(output.tokens, 2_000_000);
    // Pooling 2M tokens and pricing once at either rate would give 20 or 50.
    assert.ok(Math.abs(output.costUsd - 35) < 1e-9, `expected 35, got ${output.costUsd}`);
  });

  it("returns all four kinds even with no data, so the panel keeps its shape", () => {
    const rows = getTokenComposition(30);
    assert.deepStrictEqual(
      rows.map((r) => r.kind),
      ["Input", "Output", "Cache read", "Cache write"]
    );
    assert.ok(rows.every((r) => r.tokens === 0 && r.costUsd === 0));
  });
});

describe("getProjectModelBreakdown", () => {
  it("groups models under each project and ranks both by cost", () => {
    addProject(1, "cheap");
    addProject(2, "expensive");
    addEvent({ session: "s1", project: 1, model: "claude-sonnet-5", output: 1_000_000 }); // $10
    addEvent({ session: "s2", project: 2, model: "claude-sonnet-5", output: 1_000_000 }); // $10
    addEvent({ session: "s3", project: 2, model: "claude-opus-5", output: 2_000_000 }); // $50

    const rows = getProjectModelBreakdown(30);

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].displayName, "expensive", "projects sort by cost");
    assert.ok(Math.abs(rows[0].totalCostUsd - 60) < 1e-9);
    assert.deepStrictEqual(
      rows[0].models.map((m) => m.model),
      ["claude-opus-5", "claude-sonnet-5"],
      "models sort by cost within the project"
    );
  });

  it("drops zero-token rows such as <synthetic>", () => {
    addProject(1, "p1");
    addEvent({ session: "s1", project: 1, model: "claude-opus-5", output: 1_000_000 });
    addEvent({ session: "s1", project: 1, model: "<synthetic>" });

    const [project] = getProjectModelBreakdown(30);
    assert.deepStrictEqual(project.models.map((m) => m.model), ["claude-opus-5"]);
  });

  it("honours the limit", () => {
    for (let i = 1; i <= 5; i++) {
      addProject(i, `p${i}`);
      addEvent({ session: `s${i}`, project: i, model: "claude-opus-5", output: i * 100_000 });
    }
    assert.strictEqual(getProjectModelBreakdown(30, 3).length, 3);
  });

  it("excludes events outside the range", () => {
    addProject(1, "p1");
    addEvent({ session: "s1", project: 1, model: "claude-opus-5", output: 1_000_000, at: "-40 days" });
    assert.strictEqual(getProjectModelBreakdown(30).length, 0);
  });
});

describe("getSessionStats", () => {
  it("counts sessions and averages cost across them", () => {
    addProject(1, "p1");
    addEvent({ session: "s1", project: 1, model: "claude-sonnet-5", output: 1_000_000 }); // $10
    addEvent({ session: "s2", project: 1, model: "claude-sonnet-5", output: 3_000_000 }); // $30

    const stats = getSessionStats(30);
    assert.strictEqual(stats.sessionCount, 2);
    assert.strictEqual(stats.eventCount, 2);
    assert.ok(Math.abs(stats.avgCostPerSession - 20) < 1e-9);
    assert.strictEqual(stats.avgTokensPerSession, 2_000_000);
  });

  it("folds a session's several models into one session, priced per model", () => {
    addProject(1, "p1");
    addEvent({ session: "s1", project: 1, model: "claude-opus-5", output: 1_000_000 }); // $25
    addEvent({ session: "s1", project: 1, model: "claude-sonnet-5", output: 1_000_000 }); // $10

    const stats = getSessionStats(30);
    assert.strictEqual(stats.sessionCount, 1, "one session, not one per model");
    assert.ok(Math.abs(stats.topSession!.costUsd - 35) < 1e-9);
  });

  it("names the most expensive session and the busiest day", () => {
    addProject(1, "quiet");
    addProject(2, "loud");
    addEvent({ session: "s1", project: 1, model: "claude-sonnet-5", output: 1_000_000 });
    addEvent({ session: "s2", project: 2, model: "claude-opus-5", output: 4_000_000 });

    const stats = getSessionStats(30);
    assert.strictEqual(stats.topSession!.projectName, "loud");
    assert.ok(stats.busiestDay);
    assert.match(stats.busiestDay!.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports zeroes rather than NaN when there is no data", () => {
    const stats = getSessionStats(30);
    assert.strictEqual(stats.sessionCount, 0);
    assert.strictEqual(stats.avgCostPerSession, 0);
    assert.strictEqual(stats.avgTokensPerSession, 0);
    assert.strictEqual(stats.topSession, null);
    assert.strictEqual(stats.busiestDay, null);
  });
});

describe("getActivityHeatmap", () => {
  it("returns cells within the valid day and hour ranges", () => {
    addProject(1, "p1");
    addEvent({ session: "s1", project: 1, model: "claude-opus-5", output: 1000 });
    addEvent({ session: "s1", project: 1, model: "claude-opus-5", output: 1000, at: "-3 hours" });

    const cells = getActivityHeatmap(30);
    assert.ok(cells.length > 0);
    for (const cell of cells) {
      assert.ok(cell.dayOfWeek >= 0 && cell.dayOfWeek <= 6, `bad dow ${cell.dayOfWeek}`);
      assert.ok(cell.hour >= 0 && cell.hour <= 23, `bad hour ${cell.hour}`);
      assert.ok(cell.tokens >= 0);
    }
    assert.strictEqual(
      cells.reduce((sum, c) => sum + c.events, 0),
      2
    );
  });

  it("is empty when there is nothing in range", () => {
    assert.deepStrictEqual(getActivityHeatmap(30), []);
  });
});
