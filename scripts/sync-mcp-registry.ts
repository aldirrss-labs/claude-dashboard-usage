/**
 * Regenerate data/mcp-registry.json from the official MCP registry.
 *
 * The catalogue is generated rather than hand-written. A hand-kept list of
 * "every MCP server" is wrong the week after it is written; the registry is the
 * upstream source of truth and this script snapshots it, so the app can search
 * thousands of servers without a network round trip and still work offline.
 *
 *   npm run sync:mcp
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const PAGE_SIZE = 100;
/** Generous but bounded, so a pagination bug upstream cannot loop forever. */
const MAX_PAGES = 3000;
const OUTPUT = path.join(process.cwd(), "data", "mcp-registry.json");

interface Remote {
  type: string;
  url: string;
}

interface RegistryEntryRaw {
  server?: {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
    repository?: { url?: string; source?: string };
    websiteUrl?: string;
    remotes?: Remote[];
    packages?: Array<{ registryType?: string; identifier?: string }>;
  };
  _meta?: Record<string, { status?: string; isLatest?: boolean; updatedAt?: string }>;
}

export interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  version: string | null;
  /** URL transports, the only kind this app offers to install. */
  remotes: Remote[];
  /** Package identifiers, recorded so the UI can say why it cannot install them. */
  packages: string[];
  repository: string | null;
  website: string | null;
  updatedAt: string | null;
}

function officialMeta(entry: RegistryEntryRaw) {
  return entry._meta?.["io.modelcontextprotocol.registry/official"];
}

async function fetchPage(cursor: string | null): Promise<{ entries: RegistryEntryRaw[]; next: string | null }> {
  const url = new URL(BASE);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Registry returned ${res.status} for ${url}`);

  const json = (await res.json()) as { servers?: RegistryEntryRaw[]; metadata?: { nextCursor?: string } };
  return { entries: json.servers ?? [], next: json.metadata?.nextCursor ?? null };
}

async function main(): Promise<void> {
  const seen = new Map<string, CatalogEntry>();
  let cursor: string | null = null;
  let pages = 0;
  let raw = 0;

  do {
    const { entries, next } = await fetchPage(cursor);
    raw += entries.length;
    pages++;

    for (const entry of entries) {
      const server = entry.server;
      const meta = officialMeta(entry);
      if (!server?.name) continue;
      // The registry keeps every published version; only the current one is
      // useful here, and withdrawn entries should not be installable at all.
      if (meta?.isLatest === false) continue;
      if (meta?.status && meta.status !== "active") continue;

      const remotes = (server.remotes ?? []).filter((r) => typeof r?.url === "string" && r.url);

      seen.set(server.name, {
        name: server.name,
        title: server.title || server.name,
        description: server.description ?? "",
        version: server.version ?? null,
        remotes,
        packages: (server.packages ?? [])
          .map((p) => [p.registryType, p.identifier].filter(Boolean).join(":"))
          .filter(Boolean),
        repository: server.repository?.url ?? null,
        website: server.websiteUrl ?? null,
        updatedAt: meta?.updatedAt ?? null,
      });
    }

    cursor = next;
    if (pages % 10 === 0) process.stdout.write(`  ${pages} pages, ${seen.size} servers\n`);
  } while (cursor && pages < MAX_PAGES);

  if (cursor) {
    console.warn(`warning: stopped at the ${MAX_PAGES}-page cap; the snapshot may be incomplete.`);
  }

  const servers = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const installable = servers.filter((s) => s.remotes.length > 0).length;

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(
    OUTPUT,
    `${JSON.stringify(
      {
        source: BASE,
        fetchedAt: new Date().toISOString(),
        count: servers.length,
        installableCount: installable,
        servers,
      },
      null,
      0
    )}\n`
  );

  const sizeMb = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2);
  console.log(`\n${raw} raw entries over ${pages} pages`);
  console.log(`${servers.length} current servers (${installable} installable over a URL)`);
  console.log(`wrote ${OUTPUT} (${sizeMb} MB)`);
}

main().catch((err) => {
  console.error("sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
