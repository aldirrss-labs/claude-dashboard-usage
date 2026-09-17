import { getDb } from "./db";
import { normalizeModelId } from "./pricing-seed";

export interface DashboardSummary {
  totalTokens: number;
  totalCostUsd: number;
  activeProjectCount: number;
  cacheEfficiencyPct: number;
  cacheSavingsUsd: number;
  projectedMonthlyCostUsd: number;
  todayCostUsd: number;
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
  weekOverWeekPct: number | null;
}
export interface ProjectDetail extends ProjectListRow {
  sessions: Array<{
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    messageCount: number;
    totalTokens: number;
    costUsd: number;
    dominantModel: string | null;
  }>;
}
export interface TopProjectRow {
  slug: string;
  displayName: string;
  costUsd: number;
  totalTokens: number;
  sparkline: number[];
}
export interface BudgetLimit {
  limitUsd: number | null;
}
export interface EmailSettings {
  smtpUser: string | null;
  smtpAppPassword: string | null;
  recipientEmail: string | null;
  enabled: boolean;
}
export interface DailyReport {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  previousDayCostUsd: number;
  costChangePct: number | null;
  cacheEfficiencyPct: number;
  cacheSavingsUsd: number;
  byProject: Array<{ displayName: string; totalTokens: number; costUsd: number }>;
  byModel: Array<{ model: string; totalTokens: number; costUsd: number }>;
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

const ZERO_PRICE = { input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 };

/**
 * Look a model up in the pricing table, falling back to its normalized id
 * before giving up on the zero-priced `unknown` row — session logs record
 * variants like `claude-opus-5[1m]` that have no row of their own.
 */
function priceFor(pricing: PricingMap, model: string) {
  return pricing[model] ?? pricing[normalizeModelId(model)] ?? pricing["unknown"] ?? ZERO_PRICE;
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
  const price = priceFor(pricing, model);
  return (
    (tokens.input_tokens / 1_000_000) * price.input_price +
    (tokens.cache_creation_input_tokens / 1_000_000) * price.cache_write_price +
    (tokens.cache_read_input_tokens / 1_000_000) * price.cache_read_price +
    (tokens.output_tokens / 1_000_000) * price.output_price
  );
}

export function getLastSyncedAt(): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT MAX(updated_at) as lastSyncedAt FROM ingest_state`).get() as {
    lastSyncedAt: string | null;
  };
  return row.lastSyncedAt;
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
  let cacheSavingsUsd = 0;

  for (const row of rows) {
    totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    totalCostUsd += costForRow(pricing, row.model, row);
    totalInput += row.input_tokens;
    totalCacheRead += row.cache_read_input_tokens;

    const price = priceFor(pricing, row.model);
    const cacheReadCost = (row.cache_read_input_tokens / 1_000_000) * price.cache_read_price;
    const hadItBeenInputCost = (row.cache_read_input_tokens / 1_000_000) * price.input_price;
    cacheSavingsUsd += hadItBeenInputCost - cacheReadCost;
  }

  const todayCostUsd = (() => {
    const todayRows = db
      .prepare(
        `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
         FROM usage_events WHERE timestamp >= datetime('now', 'start of day')`
      )
      .all() as typeof rows;
    return todayRows.reduce((sum, row) => sum + costForRow(pricing, row.model, row), 0);
  })();

  const projectedMonthlyCostUsd = rangeDays > 0 ? (totalCostUsd / rangeDays) * 30 : 0;

  const activeProjectCount = (
    db
      .prepare(`SELECT COUNT(DISTINCT project_id) as c FROM usage_events WHERE timestamp >= datetime('now', ?)`)
      .get(`-${rangeDays} days`) as { c: number }
  ).c;

  const cacheEfficiencyPct = totalInput + totalCacheRead > 0 ? (totalCacheRead / (totalInput + totalCacheRead)) * 100 : 0;

  return {
    totalTokens,
    totalCostUsd,
    activeProjectCount,
    cacheEfficiencyPct,
    cacheSavingsUsd,
    projectedMonthlyCostUsd,
    todayCostUsd,
  };
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

export interface TokenCompositionRow {
  kind: "Input" | "Output" | "Cache read" | "Cache write";
  tokens: number;
  costUsd: number;
}

/**
 * Split usage into the four token kinds, by volume *and* by cost.
 *
 * These two tell very different stories, which is the point of showing both:
 * cache reads dominate the token count but are billed at a tenth of the input
 * rate, so the share of spend they account for is far smaller than their share
 * of tokens. A tokens-only view makes caching look like the whole bill.
 */
export function getTokenComposition(rangeDays: number): TokenCompositionRow[] {
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

  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  // Cost has to be accumulated per model, since each model prices the four
  // kinds differently — summing tokens first and pricing once would be wrong.
  for (const row of rows) {
    const price = priceFor(pricing, row.model);
    totals.input += row.input_tokens;
    totals.output += row.output_tokens;
    totals.cacheRead += row.cache_read_input_tokens;
    totals.cacheWrite += row.cache_creation_input_tokens;

    cost.input += (row.input_tokens / 1_000_000) * price.input_price;
    cost.output += (row.output_tokens / 1_000_000) * price.output_price;
    cost.cacheRead += (row.cache_read_input_tokens / 1_000_000) * price.cache_read_price;
    cost.cacheWrite += (row.cache_creation_input_tokens / 1_000_000) * price.cache_write_price;
  }

  return [
    { kind: "Input", tokens: totals.input, costUsd: cost.input },
    { kind: "Output", tokens: totals.output, costUsd: cost.output },
    { kind: "Cache read", tokens: totals.cacheRead, costUsd: cost.cacheRead },
    { kind: "Cache write", tokens: totals.cacheWrite, costUsd: cost.cacheWrite },
  ];
}

export interface ProjectModelCell {
  model: string;
  tokens: number;
  costUsd: number;
}

export interface ProjectModelRow {
  slug: string;
  displayName: string;
  totalTokens: number;
  totalCostUsd: number;
  models: ProjectModelCell[];
}

/**
 * Which models each project actually runs on, ranked by spend within the
 * project. Answers "what is this project costing me, and on which model" in
 * one place — a per-project total alone hides that one project may be cheap
 * only because it runs on Sonnet.
 */
export function getProjectModelBreakdown(rangeDays: number, limit = 10): ProjectModelRow[] {
  const db = getDb();
  const pricing = loadPricing();

  const rows = db
    .prepare(
      `SELECT p.slug, p.display_name, e.model,
              SUM(e.input_tokens) as input_tokens,
              SUM(e.cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(e.cache_read_input_tokens) as cache_read_input_tokens,
              SUM(e.output_tokens) as output_tokens
         FROM usage_events e
         JOIN projects p ON p.id = e.project_id
        WHERE e.timestamp >= datetime('now', ?)
        GROUP BY p.id, e.model`
    )
    .all(`-${rangeDays} days`) as Array<{
    slug: string;
    display_name: string;
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }>;

  const byProject = new Map<string, ProjectModelRow>();
  for (const row of rows) {
    const tokens =
      row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    // `<synthetic>` rows are bookkeeping entries Claude Code writes with no
    // usage attached; carrying a 0/0 cell would add a column of dashes to
    // every project for no information.
    if (tokens === 0) continue;

    const costUsd = costForRow(pricing, row.model, row);
    const existing = byProject.get(row.slug);
    const cell: ProjectModelCell = { model: row.model, tokens, costUsd };

    if (existing) {
      existing.models.push(cell);
      existing.totalTokens += tokens;
      existing.totalCostUsd += costUsd;
    } else {
      byProject.set(row.slug, {
        slug: row.slug,
        displayName: row.display_name,
        totalTokens: tokens,
        totalCostUsd: costUsd,
        models: [cell],
      });
    }
  }

  return [...byProject.values()]
    .map((project) => ({
      ...project,
      models: project.models.sort((a, b) => b.costUsd - a.costUsd),
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, limit);
}

export interface SessionStats {
  sessionCount: number;
  eventCount: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
  busiestDay: { date: string; costUsd: number; tokens: number } | null;
  topSession: { id: string; projectName: string; costUsd: number; tokens: number } | null;
}

export function getSessionStats(rangeDays: number): SessionStats {
  const db = getDb();
  const pricing = loadPricing();
  const range = `-${rangeDays} days`;

  const counts = db
    .prepare(
      `SELECT COUNT(*) as events, COUNT(DISTINCT session_id) as sessions
         FROM usage_events WHERE timestamp >= datetime('now', ?)`
    )
    .get(range) as { events: number; sessions: number };

  const perSession = db
    .prepare(
      `SELECT e.session_id, p.display_name, e.model,
              SUM(e.input_tokens) as input_tokens,
              SUM(e.cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(e.cache_read_input_tokens) as cache_read_input_tokens,
              SUM(e.output_tokens) as output_tokens
         FROM usage_events e
         LEFT JOIN projects p ON p.id = e.project_id
        WHERE e.timestamp >= datetime('now', ?)
        GROUP BY e.session_id, e.model`
    )
    .all(range) as Array<{
    session_id: string;
    display_name: string | null;
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }>;

  // Grouped by (session, model) above so cost is priced per model, then folded
  // back to one entry per session here.
  const sessions = new Map<string, { project: string; tokens: number; cost: number }>();
  for (const row of perSession) {
    const tokens =
      row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    const cost = costForRow(pricing, row.model, row);
    const existing = sessions.get(row.session_id);
    if (existing) {
      existing.tokens += tokens;
      existing.cost += cost;
    } else {
      sessions.set(row.session_id, { project: row.display_name ?? "—", tokens, cost });
    }
  }

  let totalTokens = 0;
  let totalCost = 0;
  let topSession: SessionStats["topSession"] = null;
  for (const [id, s] of sessions) {
    totalTokens += s.tokens;
    totalCost += s.cost;
    if (!topSession || s.cost > topSession.costUsd) {
      topSession = { id, projectName: s.project, costUsd: s.cost, tokens: s.tokens };
    }
  }

  const perDay = db
    .prepare(
      `SELECT substr(timestamp, 1, 10) as day, model,
              SUM(input_tokens) as input_tokens,
              SUM(cache_creation_input_tokens) as cache_creation_input_tokens,
              SUM(cache_read_input_tokens) as cache_read_input_tokens,
              SUM(output_tokens) as output_tokens
         FROM usage_events WHERE timestamp >= datetime('now', ?)
        GROUP BY day, model`
    )
    .all(range) as Array<{
    day: string;
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }>;

  const days = new Map<string, { cost: number; tokens: number }>();
  for (const row of perDay) {
    const entry = days.get(row.day) ?? { cost: 0, tokens: 0 };
    entry.cost += costForRow(pricing, row.model, row);
    entry.tokens +=
      row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    days.set(row.day, entry);
  }

  let busiestDay: SessionStats["busiestDay"] = null;
  for (const [date, entry] of days) {
    if (!busiestDay || entry.cost > busiestDay.costUsd) {
      busiestDay = { date, costUsd: entry.cost, tokens: entry.tokens };
    }
  }

  const sessionCount = sessions.size;
  return {
    sessionCount,
    eventCount: counts.events,
    avgTokensPerSession: sessionCount ? totalTokens / sessionCount : 0,
    avgCostPerSession: sessionCount ? totalCost / sessionCount : 0,
    busiestDay,
    topSession,
  };
}

export interface ActivityCell {
  /** 0 = Sunday, matching SQLite's strftime('%w'). */
  dayOfWeek: number;
  hour: number;
  events: number;
  tokens: number;
}

/**
 * When the work actually happens, as a day-of-week × hour grid.
 *
 * Timestamps are stored UTC, and `'localtime'` converts them to the server's
 * zone so the grid matches the hours the user recognises rather than being
 * shifted by their offset.
 */
export function getActivityHeatmap(rangeDays: number): ActivityCell[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%w', timestamp, 'localtime') AS INTEGER) as dow,
              CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) as hour,
              COUNT(*) as events,
              SUM(input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens) as tokens
         FROM usage_events
        WHERE timestamp >= datetime('now', ?)
        GROUP BY dow, hour`
    )
    .all(`-${rangeDays} days`) as Array<{ dow: number; hour: number; events: number; tokens: number }>;

  return rows.map((r) => ({ dayOfWeek: r.dow, hour: r.hour, events: r.events, tokens: r.tokens ?? 0 }));
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

    const thisWeekRows = db
      .prepare(
        `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
         FROM usage_events WHERE project_id = ? AND timestamp >= datetime('now', '-7 days')`
      )
      .all(project.id) as Array<{
      model: string;
      input_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      output_tokens: number;
    }>;
    const lastWeekRows = db
      .prepare(
        `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
         FROM usage_events WHERE project_id = ? AND timestamp >= datetime('now', '-14 days') AND timestamp < datetime('now', '-7 days')`
      )
      .all(project.id) as typeof thisWeekRows;

    const thisWeekCost = thisWeekRows.reduce((sum, row) => sum + costForRow(pricing, row.model, row), 0);
    const lastWeekCost = lastWeekRows.reduce((sum, row) => sum + costForRow(pricing, row.model, row), 0);
    const weekOverWeekPct = lastWeekCost > 0 ? ((thisWeekCost - lastWeekCost) / lastWeekCost) * 100 : null;

    return {
      slug: project.slug,
      displayName: project.display_name,
      displayPath: project.display_path,
      totalTokens,
      costUsd,
      lastActiveAt: project.last_active_at,
      sessionCount,
      weekOverWeekPct,
    };
  });
}

export function getTopProjects(rangeDays: number, limit: number = 5): TopProjectRow[] {
  const db = getDb();
  const pricing = loadPricing();
  const projects = db.prepare(`SELECT id, slug, display_name FROM projects`).all() as Array<{
    id: number;
    slug: string;
    display_name: string;
  }>;

  const ranked = projects.map((project) => {
    const rows = db
      .prepare(
        `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
         FROM usage_events WHERE project_id = ? AND timestamp >= datetime('now', ?)`
      )
      .all(project.id, `-${rangeDays} days`) as Array<{
      model: string;
      input_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      output_tokens: number;
    }>;

    let totalTokens = 0;
    let costUsd = 0;
    for (const row of rows) {
      totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      costUsd += costForRow(pricing, row.model, row);
    }
    return { project, totalTokens, costUsd };
  });

  const top = ranked
    .filter((r) => r.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, limit);

  return top.map(({ project, totalTokens, costUsd }) => {
    const dailyRows = db
      .prepare(
        `SELECT strftime('%Y-%m-%d', timestamp) as day,
                SUM(input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens) as tokens
         FROM usage_events
         WHERE project_id = ? AND timestamp >= datetime('now', ?)
         GROUP BY day ORDER BY day ASC`
      )
      .all(project.id, `-${rangeDays} days`) as Array<{ day: string; tokens: number }>;

    return {
      slug: project.slug,
      displayName: project.display_name,
      costUsd,
      totalTokens,
      sparkline: dailyRows.map((r) => r.tokens),
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
    let dominantModel: string | null = null;
    let dominantModelTokens = -1;
    for (const row of usageRows) {
      const rowTokens = row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      totalTokens += rowTokens;
      costUsd += costForRow(pricing, row.model, row);
      if (rowTokens > dominantModelTokens) {
        dominantModelTokens = rowTokens;
        dominantModel = row.model;
      }
    }

    return {
      id: session.id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      messageCount: session.message_count,
      totalTokens,
      costUsd,
      dominantModel,
    };
  });

  return { ...listRow, sessions };
}

export function getDailyBudgetLimit(): BudgetLimit {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT limit_usd FROM budget_limits WHERE scope = 'global' AND period = 'daily' ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { limit_usd: number } | undefined;
  return { limitUsd: row?.limit_usd ?? null };
}

export function setDailyBudgetLimit(limitUsd: number | null): void {
  const db = getDb();
  db.prepare(`DELETE FROM budget_limits WHERE scope = 'global' AND period = 'daily'`).run();
  if (limitUsd !== null) {
    db.prepare(
      `INSERT INTO budget_limits (scope, period, limit_usd, created_at) VALUES ('global', 'daily', ?, datetime('now'))`
    ).run(limitUsd);
  }
}

export function getEmailSettings(): EmailSettings {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM email_settings WHERE id = 1`).get() as
    | { smtp_user: string | null; smtp_app_password: string | null; recipient_email: string | null; enabled: number }
    | undefined;
  if (!row) return { smtpUser: null, smtpAppPassword: null, recipientEmail: null, enabled: false };
  return {
    smtpUser: row.smtp_user,
    smtpAppPassword: row.smtp_app_password,
    recipientEmail: row.recipient_email,
    enabled: row.enabled === 1,
  };
}

export function setEmailSettings(settings: {
  smtpUser: string | null;
  smtpAppPassword: string | null;
  recipientEmail: string | null;
  enabled: boolean;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO email_settings (id, smtp_user, smtp_app_password, recipient_email, enabled)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       smtp_user = excluded.smtp_user,
       smtp_app_password = excluded.smtp_app_password,
       recipient_email = excluded.recipient_email,
       enabled = excluded.enabled`
  ).run(settings.smtpUser, settings.smtpAppPassword, settings.recipientEmail, settings.enabled ? 1 : 0);
}

export function hasEmailLogEntry(dateISO: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM email_log WHERE report_date = ?`).get(dateISO);
  return row !== undefined;
}

export function recordEmailLog(dateISO: string, status: "sent" | "failed"): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO email_log (report_date, sent_at, status) VALUES (?, datetime('now'), ?)
     ON CONFLICT(report_date) DO UPDATE SET sent_at = excluded.sent_at, status = excluded.status`
  ).run(dateISO, status);
}

export function getDailyReport(dateISO: string): DailyReport {
  const db = getDb();
  const pricing = loadPricing();

  function costAndTokensFor(dayStart: string, dayEnd: string) {
    const rows = db
      .prepare(
        `SELECT model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens
         FROM usage_events WHERE timestamp >= ? AND timestamp < ?`
      )
      .all(dayStart, dayEnd) as Array<{
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
    let cacheSavingsUsd = 0;
    for (const row of rows) {
      totalTokens += row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
      totalCostUsd += costForRow(pricing, row.model, row);
      totalInput += row.input_tokens;
      totalCacheRead += row.cache_read_input_tokens;
      const price = priceFor(pricing, row.model);
      cacheSavingsUsd +=
        (row.cache_read_input_tokens / 1_000_000) * price.input_price -
        (row.cache_read_input_tokens / 1_000_000) * price.cache_read_price;
    }
    const cacheEfficiencyPct = totalInput + totalCacheRead > 0 ? (totalCacheRead / (totalInput + totalCacheRead)) * 100 : 0;
    return { totalTokens, totalCostUsd, cacheEfficiencyPct, cacheSavingsUsd };
  }

  // usage_events.timestamp is stored as ISO 8601 with a literal "T"/"Z"
  // (e.g. "2026-08-17T10:00:00.000Z"), so range bounds must match that
  // exact format — a "YYYY-MM-DD HH:MM:SS" (space-separated) bound never
  // matches anything since SQLite compares timestamps as plain strings.
  const dayStart = `${dateISO}T00:00:00.000Z`;
  const dayEnd = `${dateISO}T23:59:59.999Z`;
  const prevDate = new Date(`${dateISO}T00:00:00Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevDateISO = prevDate.toISOString().slice(0, 10);
  const prevDayStart = `${prevDateISO}T00:00:00.000Z`;
  const prevDayEnd = `${prevDateISO}T23:59:59.999Z`;

  const today = costAndTokensFor(dayStart, dayEnd);
  const previous = costAndTokensFor(prevDayStart, prevDayEnd);
  const costChangePct = previous.totalCostUsd > 0 ? ((today.totalCostUsd - previous.totalCostUsd) / previous.totalCostUsd) * 100 : null;

  const byProjectRows = db
    .prepare(
      `SELECT p.display_name as displayName, e.model, e.input_tokens, e.cache_creation_input_tokens,
              e.cache_read_input_tokens, e.output_tokens
       FROM usage_events e JOIN projects p ON p.id = e.project_id
       WHERE e.timestamp >= ? AND e.timestamp < ?`
    )
    .all(dayStart, dayEnd) as Array<{
    displayName: string;
    model: string;
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  }>;

  const projectTotals = new Map<string, { totalTokens: number; costUsd: number }>();
  const modelTotals = new Map<string, { totalTokens: number; costUsd: number }>();
  for (const row of byProjectRows) {
    const tokens = row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens + row.output_tokens;
    const cost = costForRow(pricing, row.model, row);

    const p = projectTotals.get(row.displayName) ?? { totalTokens: 0, costUsd: 0 };
    p.totalTokens += tokens;
    p.costUsd += cost;
    projectTotals.set(row.displayName, p);

    const m = modelTotals.get(row.model) ?? { totalTokens: 0, costUsd: 0 };
    m.totalTokens += tokens;
    m.costUsd += cost;
    modelTotals.set(row.model, m);
  }

  const byProject = [...projectTotals.entries()]
    .map(([displayName, v]) => ({ displayName, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const byModel = [...modelTotals.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    date: dateISO,
    totalTokens: today.totalTokens,
    totalCostUsd: today.totalCostUsd,
    previousDayCostUsd: previous.totalCostUsd,
    costChangePct,
    cacheEfficiencyPct: today.cacheEfficiencyPct,
    cacheSavingsUsd: today.cacheSavingsUsd,
    byProject,
    byModel,
  };
}
