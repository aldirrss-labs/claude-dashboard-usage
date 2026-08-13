import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claude-dashboard-test-")), "usage.db");
process.env.CLAUDE_DASHBOARD_DB_PATH = testDbPath;
