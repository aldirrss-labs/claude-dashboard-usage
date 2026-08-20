import { getDb } from "./db";

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

    const price = pricing[row.model] ??
      pricing["unknown"] ?? { input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 };
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
      const price = pricing[row.model] ??
        pricing["unknown"] ?? { input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 };
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
