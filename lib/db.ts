import Database from "better-sqlite3";
import { getDbPath, secureDbFiles } from "./paths";
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

CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  smtp_user TEXT,
  smtp_app_password TEXT,
  recipient_email TEXT,
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS email_log (
  report_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claude_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  organization_uuid TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  credentials_snapshot TEXT NOT NULL,
  oauth_account_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_accounts_identity
  ON claude_accounts(organization_uuid, account_uuid);
`;

function migrateClaudeAccountsTable(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(claude_accounts)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  // Excluded from auto-switch and from usage polling, but kept on disk so the
  // credentials survive — this is "disable", not "remove".
  if (!columnNames.has("disabled")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
  }
  // Set every time the account becomes the live one, so the list can show
  // "3m ago" the way claude-swap's dashboard does.
  if (!columnNames.has("last_used_at")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN last_used_at TEXT`);
  }
  // Last successful /api/oauth/usage payload, so the UI has something to show
  // while a refetch is in flight and after a transient failure.
  if (!columnNames.has("usage_snapshot")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN usage_snapshot TEXT`);
  }
  if (!columnNames.has("usage_fetched_at")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN usage_fetched_at TEXT`);
  }
  // Sticky "this login is dead" marker, cleared when a fetch succeeds again.
  if (!columnNames.has("usage_error")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN usage_error TEXT`);
  }
  if (!columnNames.has("relogin_required")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN relogin_required INTEGER NOT NULL DEFAULT 0`);
  }
  // Free-text grouping ("work-fulltime", "freelance", "personal"). Auto-switch
  // can be confined to one group so it never rotates a work job onto a
  // personal account, or a client's quota onto another client's.
  if (!columnNames.has("group_name")) {
    db.exec(`ALTER TABLE claude_accounts ADD COLUMN group_name TEXT`);
  }
}

function migrateDirectoryMappingsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS directory_mappings (
      canonical_dir TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES claude_accounts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_directory_mappings_account
      ON directory_mappings(account_id);
  `);
}

function migrateAutoSwitchStateTable(db: Database.Database): void {
  // Single-row table holding cooldown / anti-flap state, so the decision is
  // stable across server restarts rather than resetting every boot.
  db.exec(`
    CREATE TABLE IF NOT EXISTS autoswitch_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_switch_from INTEGER,
      last_switch_to INTEGER,
      last_switch_at TEXT,
      last_trigger TEXT
    );
    CREATE TABLE IF NOT EXISTS autoswitch_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      strategy TEXT NOT NULL DEFAULT 'best',
      threshold_percent REAL NOT NULL DEFAULT 90,
      hysteresis_percent REAL NOT NULL DEFAULT 5,
      cooldown_seconds INTEGER NOT NULL DEFAULT 900,
      restrict_to_group INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS usage_poll_state (
      account_id INTEGER PRIMARY KEY REFERENCES claude_accounts(id) ON DELETE CASCADE,
      next_poll_at TEXT,
      interval_seconds INTEGER,
      last_binding_percent REAL,
      last_429_at TEXT
    );
  `);
}

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
  // Seed rows are marked source='seed' so that shipping a corrected price in
  // DEFAULT_PRICING actually reaches existing databases. Rows the user edited
  // in Settings ('manual') or pulled from Anthropic ('synced') are left alone.
  const insert = db.prepare(
    `INSERT INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
     VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'seed')
     ON CONFLICT(model) DO UPDATE SET
       input_price = @input_price, cache_write_price = @cache_write_price,
       cache_read_price = @cache_read_price, output_price = @output_price,
       updated_at = datetime('now')
     WHERE model_pricing.source = 'seed'`
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
  // After WAL mode, so the -wal/-shm sidecars exist and get locked down too.
  secureDbFiles(dbPath);
  db.exec(SCHEMA);
  migrateProjectsTable(db);
  migrateClaudeAccountsTable(db);
  migrateDirectoryMappingsTable(db);
  migrateAutoSwitchStateTable(db);
  seedPricing(db);
  dbInstance = db;
  return db;
}
