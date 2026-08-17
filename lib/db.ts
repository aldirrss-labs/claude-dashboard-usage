import Database from "better-sqlite3";
import { getDbPath } from "./paths";
import { DEFAULT_PRICING } from "./pricing-seed";

let dbInstance: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ingest_state (
  file_path TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  last_byte_offset INTEGER NOT NULL DEFAULT 0,
  last_mtime TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  canonical_path TEXT,
  path_source TEXT NOT NULL DEFAULT 'cwd',
  first_seen_at TEXT,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  started_at TEXT,
  ended_at TEXT,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  timestamp TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_project_ts ON usage_events(project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);

CREATE TABLE IF NOT EXISTS model_pricing (
  model TEXT PRIMARY KEY,
  input_price REAL,
  cache_write_price REAL,
  cache_read_price REAL,
  output_price REAL,
  updated_at TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS budget_limits (
  id INTEGER PRIMARY KEY,
  scope TEXT,
  period TEXT,
  limit_usd REAL,
  created_at TEXT
);
`;

function migrateProjectsTable(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("canonical_path")) {
    db.exec(`ALTER TABLE projects ADD COLUMN canonical_path TEXT`);
  }
  if (!columnNames.has("path_source")) {
    db.exec(`ALTER TABLE projects ADD COLUMN path_source TEXT NOT NULL DEFAULT 'cwd'`);
  }

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_canonical_path
       ON projects(canonical_path)
       WHERE path_source = 'cwd'`
  );
}

function seedPricing(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
     VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'manual')`
  );
  const seedAll = db.transaction((rows: typeof DEFAULT_PRICING) => {
    for (const row of rows) insert.run(row);
  });
  seedAll(DEFAULT_PRICING);
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = process.env.CLAUDE_DASHBOARD_DB_PATH ?? getDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrateProjectsTable(db);
  seedPricing(db);
  dbInstance = db;
  return db;
}
