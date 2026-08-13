import { getDb } from "./db";

export interface DashboardSummary {
  totalTokens: number;
  totalCostUsd: number;
  activeProjectCount: number;
  cacheEfficiencyPct: number;
}
export interface TimeSeriesPoint {
  bucketStart: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
export interface ModelBreakdownRow {
  model: string;
  totalTokens: number;
  costUsd: number;
}
export interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}
export interface ProjectDetail extends ProjectListRow {
  sessions: Array<{
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    messageCount: number;
    totalTokens: number;
    costUsd: number;
  }>;
}

interface PricingMap {
  [model: string]: { input_price: number; cache_write_price: number; cache_read_price: number; output_price: number };
}

function loadPricing(): PricingMap {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM model_pricing").all() as Array<{
    model: string;
    input_price: number;
    cache_write_price: number;
    cache_read_price: number;
    output_price: number;
  }>;
  const map: PricingMap = {};
  for (const row of rows) map[row.model] = row;
  return map;
}

function costForRow(
  pricing: PricingMap,
  model: string,
  tokens: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }
): number {
  const price = pricing[model] ??
    pricing["unknown"] ?? { input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 };
  return (
    (tokens.input_tokens / 1_000_000) * price.input_price +
    (tokens.cache_creation_input_tokens / 1_000_000) * price.cache_write_price +
    (tokens.cache_read_input_tokens / 1_000_000) * price.cache_read_price +
    (tokens.output_tokens / 1_000_000) * price.output_price
  );
}

export function getDashboardSummary(rangeDays: number): DashboardSummary {
  const db = getDb();
  const pricing = loadPricing();
  const rows = db
    .prepare(
      `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
       FROM usage_events WHERE timestamp >= datetime('now', ?)`
    )
    .all(`-${rangeDays} days`) as Array<{
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }>;

  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalInput = 0;
  let totalCacheRead = 0;

  for (const row of rows) {
    totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    totalCostUsd += costForRow(pricing, row.model, row);
    totalInput += row.input_tokens;
    totalCacheRead += row.cache_read_input_tokens;
  }

  const activeProjectCount = (
    db
      .prepare(`SELECT COUNT(DISTINCT project_id) as c FROM usage_events WHERE timestamp >= datetime('now', ?)`)
      .get(`-${rangeDays} days`) as { c: number }
  ).c;

  const cacheEfficiencyPct = totalInput + totalCacheRead > 0 ? (totalCacheRead / (totalInput + totalCacheRead)) * 100 : 0;

  return { totalTokens, totalCostUsd, activeProjectCount, cacheEfficiencyPct };
}

export function getUsageTimeSeries(rangeDays: number, bucket: "day" | "week" | "month"): TimeSeriesPoint[] {
  const db = getDb();
  const format = bucket === "day" ? "%Y-%m-%d" : bucket === "week" ? "%Y-W%W" : "%Y-%m";
  const rows = db
    .prepare(
      `SELECT strftime('${format}', timestamp) as bucketStart,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(cache_read_input_tokens) as cache_read_input_tokens
       FROM usage_events
       WHERE timestamp >= datetime('now', ?)
       GROUP BY bucketStart
       ORDER BY bucketStart ASC`
    )
    .all(`-${rangeDays} days`) as TimeSeriesPoint[];
  return rows;
}

export function getModelBreakdown(rangeDays: number): ModelBreakdownRow[] {
  const db = getDb();
  const pricing = loadPricing();
  const rows = db
    .prepare(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(cache_read_input_tokens) as cache_read_input_tokens,
              SUM(output_tokens) as output_tokens
       FROM usage_events
       WHERE timestamp >= datetime('now', ?)
       GROUP BY model`
    )
    .all(`-${rangeDays} days`) as Array<{
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }>;

  return rows.map((row) => ({
    model: row.model,
    totalTokens: row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens,
    costUsd: costForRow(pricing, row.model, row),
  }));
}

export function listProjects(): ProjectListRow[] {
  const db = getDb();
  const pricing = loadPricing();
  const projects = db.prepare(`SELECT * FROM projects ORDER BY last_active_at DESC`).all() as Array<{
    slug: string;
    display_name: string;
    display_path: string;
    last_active_at: string | null;
    id: number;
  }>;

  return projects.map((project) => {
    const usageRows = db
      .prepare(
        `SELECT model, SUM(input_tokens) as input_tokens, SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
                SUM(cache_read_input_tokens) as cache_read_input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE project_id = ? GROUP BY model`
      )
      .all(project.id) as Array<{
      model: string;
      input_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      output_tokens: number;
    }>;

    let totalTokens = 0;
    let costUsd = 0;
    for (const row of usageRows) {
      totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      costUsd += costForRow(pricing, row.model, row);
    }

    const sessionCount = (db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE project_id = ?`).get(project.id) as {
      c: number;
    }).c;

    return {
      slug: project.slug,
      displayName: project.display_name,
      displayPath: project.display_path,
      totalTokens,
      costUsd,
      lastActiveAt: project.last_active_at,
      sessionCount,
    };
  });
}

export function getProjectDetail(slug: string): ProjectDetail | null {
  const db = getDb();
  const pricing = loadPricing();
  const project = db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) as
    | { id: number; slug: string; display_name: string; display_path: string; last_active_at: string | null }
    | undefined;
  if (!project) return null;

  const listRow = listProjects().find((p) => p.slug === slug)!;

  const sessionRows = db.prepare(`SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC`).all(
    project.id
  ) as Array<{
    id: string;
    started_at: string | null;
    ended_at: string | null;
    message_count: number;
  }>;

  const sessions = sessionRows.map((session) => {
    const usageRows = db
      .prepare(
        `SELECT model, SUM(input_tokens) as input_tokens, SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
                SUM(cache_read_input_tokens) as cache_read_input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE session_id = ? GROUP BY model`
      )
      .all(session.id) as Array<{
      model: string;
      input_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      output_tokens: number;
    }>;

    let totalTokens = 0;
    let costUsd = 0;
    for (const row of usageRows) {
      totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      costUsd += costForRow(pricing, row.model, row);
    }

    return {
      id: session.id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      messageCount: session.message_count,
      totalTokens,
      costUsd,
    };
  });

  return { ...listRow, sessions };
}
