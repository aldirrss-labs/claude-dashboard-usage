import fs from "node:fs";
import path from "node:path";

export interface CatalogRemote {
  type: string;
  url: string;
}

export interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  version: string | null;
  remotes?: CatalogRemote[];
  packages?: string[];
  repository?: string;
  website?: string;
  updatedAt: string | null;
}

export interface CatalogMeta {
  source: string;
  fetchedAt: string;
  count: number;
  installableCount: number;
}

interface CatalogFile extends CatalogMeta {
  servers: CatalogEntry[];
}

/**
 * The marketplace catalogue: a snapshot of the official MCP registry, generated
 * by scripts/sync-mcp-registry.ts.
 *
 * It is a file rather than a live API call for three reasons: search stays
 * instant, the room works with no network, and the registry's own pagination
 * (over a thousand pages) is not something to walk on every page load.
 *
 * ~32k entries parse in under 100ms and are held in memory for the life of the
 * process, so the cost is paid once on first use.
 */
let cache: CatalogFile | null = null;

function catalogPath(): string {
  // The standalone build runs from .next/standalone, so resolve from cwd with a
  // fallback to the packaged copy beside it.
  const candidates = [
    path.join(process.cwd(), "data", "mcp-registry.json"),
    path.join(process.cwd(), "..", "..", "data", "mcp-registry.json"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

export class CatalogUnavailableError extends Error {}

function load(): CatalogFile {
  if (cache) return cache;
  const file = catalogPath();
  if (!fs.existsSync(file)) {
    throw new CatalogUnavailableError(
      "The marketplace catalogue is missing. Run `npm run sync:mcp` to generate it."
    );
  }
  cache = JSON.parse(fs.readFileSync(file, "utf-8")) as CatalogFile;
  return cache;
}

export function catalogMeta(): CatalogMeta {
  const file = load();
  return {
    source: file.source,
    fetchedAt: file.fetchedAt,
    count: file.count,
    installableCount: file.installableCount,
  };
}

export interface SearchOptions {
  query?: string;
  /** Only entries this app can actually install, i.e. those with a URL remote. */
  installableOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  entries: CatalogEntry[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Substring search over name, title and description.
 *
 * Results are ranked so an exact or prefix name match beats a description
 * mention — with 32k entries, searching "github" otherwise buries the GitHub
 * server under everything that merely mentions it.
 */
export function searchCatalog(options: SearchOptions = {}): SearchResult {
  const { servers } = load();
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const query = (options.query ?? "").trim().toLowerCase();

  let pool = servers;
  if (options.installableOnly) pool = pool.filter((s) => (s.remotes?.length ?? 0) > 0);

  if (!query) {
    return { entries: pool.slice(offset, offset + limit), total: pool.length, offset, limit };
  }

  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const entry of pool) {
    const name = entry.name.toLowerCase();
    const title = entry.title.toLowerCase();
    const description = entry.description.toLowerCase();

    let score = 0;
    if (name === query || title === query) score = 100;
    else if (name.startsWith(query) || title.startsWith(query)) score = 80;
    else if (name.includes(query)) score = 60;
    else if (title.includes(query)) score = 50;
    else if (description.includes(query)) score = 20;
    else continue;

    // A server you can actually install should outrank one you cannot.
    if ((entry.remotes?.length ?? 0) > 0) score += 5;
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

  return {
    entries: scored.slice(offset, offset + limit).map((s) => s.entry),
    total: scored.length,
    offset,
    limit,
  };
}

export function findCatalogEntry(name: string): CatalogEntry | null {
  return load().servers.find((s) => s.name === name) ?? null;
}

/**
 * Match a locally configured server back to its catalogue entry by endpoint.
 * Local names are chosen by whoever added the server and rarely match the
 * registry's, but the URL usually does.
 */
export function findCatalogEntryByUrl(url: string): CatalogEntry | null {
  const target = url.replace(/\/+$/, "").toLowerCase();
  return (
    load().servers.find((s) =>
      (s.remotes ?? []).some((r) => r.url.replace(/\/+$/, "").toLowerCase() === target)
    ) ?? null
  );
}
