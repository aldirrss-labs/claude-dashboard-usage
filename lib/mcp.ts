import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { getClaudeGlobalConfigPath } from "./claude-account-fs";

const execFileAsync = promisify(execFile);

/**
 * MCP server management, driven through the `claude mcp` CLI.
 *
 * Two rules shape this module.
 *
 * 1. Never edit the config files directly. `~/.claude.json` and
 *    `.credentials.json` hold machine-wide keys alongside per-server ones —
 *    lib/account-swap-fields.ts exists because of exactly that hazard. The CLI
 *    is the supported path and gets the merging right.
 * 2. Never build a shell string. Every call uses execFile with an argument
 *    array and no shell, and every server name is checked against the set the
 *    CLI itself reports before being passed as an argument. The dashboard has
 *    no authentication, so "run a command" must never become "run any command".
 */

export type McpStatus = "connected" | "needs-auth" | "failed" | "pending-approval" | "unknown";
export type McpScope = "local" | "user" | "project" | "connector" | "unknown";

export interface McpServer {
  name: string;
  url: string | null;
  transport: string | null;
  status: McpStatus;
  statusLabel: string;
  scope: McpScope;
  /** True for the claude.ai connectors, which are bound to the account. */
  isConnector: boolean;
}

/**
 * Where to find the `claude` binary.
 *
 * A systemd user service does not source a shell profile, so `claude` is not on
 * its PATH even though it is on yours — the same trap the node path hit.
 * install.sh resolves it and writes CLAUDE_BIN into the unit; the fallbacks
 * cover `npm run dev` from a terminal, where PATH is normal, and a couple of
 * standard install locations.
 */
export function resolveClaudeBin(): string {
  const configured = process.env.CLAUDE_BIN;
  if (configured && fs.existsSync(configured)) return configured;

  for (const candidate of [
    `${process.env.HOME ?? ""}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "claude"; // last resort: whatever PATH offers
}

const CLI_TIMEOUT_MS = 90_000;
/** `claude mcp list` health-checks every server, so it is slow and worth caching. */
const LIST_CACHE_MS = 30_000;

export class McpUnavailableError extends Error {}
export class UnknownServerError extends Error {}

let cache: { at: number; servers: McpServer[] } | null = null;
let inFlight: Promise<McpServer[]> | null = null;

function classify(statusText: string): { status: McpStatus; label: string } {
  const text = statusText.trim();
  if (/connected/i.test(text)) return { status: "connected", label: "Connected" };
  if (/needs authentication/i.test(text)) return { status: "needs-auth", label: "Needs authentication" };
  if (/pending approval/i.test(text)) return { status: "pending-approval", label: "Pending approval" };
  if (/fail|error/i.test(text)) return { status: "failed", label: text.replace(/^[^A-Za-z]+/, "") };
  return { status: "unknown", label: text.replace(/^[^A-Za-z]+/, "") || "Unknown" };
}

/**
 * Parse `claude mcp list`. Lines look like:
 *   `vercel: https://mcp.vercel.com (HTTP) - ✔ Connected`
 *   `claude.ai Asana: https://mcp.asana.com/sse - ! Needs authentication`
 *
 * Names may contain spaces and dots, and URLs contain colons, so the split is
 * anchored on the first ": " and the last " - " rather than on any single
 * character.
 */
export function parseMcpList(output: string): McpServer[] {
  const servers: McpServer[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^checking mcp server health/i.test(line)) continue;

    const nameSplit = line.indexOf(": ");
    if (nameSplit === -1) continue;
    const name = line.slice(0, nameSplit).trim();
    let rest = line.slice(nameSplit + 2).trim();
    if (!name || !rest) continue;

    let statusLabel = "";
    const statusSplit = rest.lastIndexOf(" - ");
    if (statusSplit !== -1) {
      statusLabel = rest.slice(statusSplit + 3).trim();
      rest = rest.slice(0, statusSplit).trim();
    }

    let transport: string | null = null;
    const transportMatch = rest.match(/\(([^)]+)\)\s*$/);
    if (transportMatch) {
      transport = transportMatch[1].toUpperCase();
      rest = rest.slice(0, transportMatch.index).trim();
    }

    const isConnector = name.startsWith("claude.ai ");
    const { status, label } = classify(statusLabel);

    servers.push({
      name,
      url: rest || null,
      transport,
      status,
      statusLabel: label,
      // The CLI's list output does not say which scope a server came from;
      // `claude mcp get` does, and the local config fills in the rest.
      scope: isConnector ? "connector" : "unknown",
      isConnector,
    });
  }

  return servers;
}

/** Scopes that the local config can tell us about without another CLI call. */
function scopesFromConfig(): Map<string, McpScope> {
  const scopes = new Map<string, McpScope>();
  try {
    const config = JSON.parse(fs.readFileSync(getClaudeGlobalConfigPath(), "utf-8"));
    for (const name of Object.keys(config.mcpServers ?? {})) scopes.set(name, "user");
    for (const project of Object.values(config.projects ?? {}) as Array<Record<string, unknown>>) {
      for (const name of Object.keys((project?.mcpServers as object) ?? {})) scopes.set(name, "local");
    }
  } catch {
    // Unreadable or absent config: scope stays unknown, which the UI handles.
  }
  return scopes;
}

async function runClaudeMcp(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(resolveClaudeBin(), ["mcp", ...args], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return `${stdout}${stderr}`;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    if (e.code === "ENOENT") {
      throw new McpUnavailableError("The `claude` CLI is not on PATH for this service.");
    }
    if (e.killed) {
      throw new McpUnavailableError(`\`claude mcp ${args[0]}\` timed out after ${CLI_TIMEOUT_MS / 1000}s.`);
    }
    // A non-zero exit still carries useful output (e.g. "No MCP servers configured").
    const combined = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    if (combined) return combined;
    throw new McpUnavailableError(e.message);
  }
}

export async function listMcpServers(options: { force?: boolean } = {}): Promise<McpServer[]> {
  const now = Date.now();
  if (!options.force && cache && now - cache.at < LIST_CACHE_MS) return cache.servers;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const output = await runClaudeMcp(["list"]);
    const scopes = scopesFromConfig();
    const servers = parseMcpList(output).map((server) => ({
      ...server,
      scope: server.isConnector ? ("connector" as const) : (scopes.get(server.name) ?? server.scope),
    }));
    cache = { at: Date.now(), servers };
    return servers;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Resolve a caller-supplied name to one the CLI actually knows.
 *
 * This is the security boundary: it means a request can only ever name a server
 * that already exists, so no input reaches the CLI as an argument unless the
 * CLI itself listed it first.
 */
async function requireKnownServer(name: string): Promise<McpServer> {
  const servers = await listMcpServers();
  const found = servers.find((s) => s.name === name);
  if (!found) throw new UnknownServerError(`No MCP server named "${name}".`);
  return found;
}

export async function getMcpServerDetail(name: string): Promise<string> {
  await requireKnownServer(name);
  return runClaudeMcp(["get", name]);
}

export async function logoutMcpServer(name: string): Promise<string> {
  await requireKnownServer(name);
  const output = await runClaudeMcp(["logout", name]);
  cache = null;
  return output.trim();
}

export async function removeMcpServer(name: string, scope?: McpScope): Promise<string> {
  const server = await requireKnownServer(name);
  if (server.isConnector) {
    throw new UnknownServerError(
      "claude.ai connectors are managed on claude.ai, not from this machine — remove it there instead."
    );
  }
  const args = ["remove", name];
  if (scope === "local" || scope === "user" || scope === "project") args.push("-s", scope);
  const output = await runClaudeMcp(args);
  cache = null;
  return output.trim();
}

/** The command to run by hand, for flows this dashboard cannot drive. */
export function loginCommandFor(name: string): string {
  const quoted = /^[A-Za-z0-9_.@:/-]+$/.test(name) ? name : `'${name.replace(/'/g, `'\\''`)}'`;
  return `claude mcp login ${quoted}`;
}
