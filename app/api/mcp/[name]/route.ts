import { NextRequest, NextResponse } from "next/server";
import {
  McpUnavailableError,
  UnknownServerError,
  getMcpServerDetail,
  listMcpServers,
  logoutMcpServer,
  removeMcpServer,
  type McpScope,
} from "@/lib/mcp";
import { findCatalogEntry, findCatalogEntryByUrl } from "@/lib/mcp-catalog";

function errorResponse(err: unknown) {
  if (err instanceof UnknownServerError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof McpUnavailableError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "MCP command failed." },
    { status: 500 }
  );
}

/** Turn `claude mcp get`'s "  Key: value" lines into fields the UI can lay out. */
function parseDetail(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s{2,}([A-Za-z][A-Za-z ]*):\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name: encoded } = await params;
  const name = decodeURIComponent(encoded);

  try {
    const raw = await getMcpServerDetail(name);
    const servers = await listMcpServers();
    const server = servers.find((s) => s.name === name) ?? null;

    // The registry knows things the local config does not: what the server is
    // for, who publishes it, where the source lives, and any alternative
    // endpoints. Absent for hand-added servers, which is fine.
    let catalog = null;
    try {
      catalog = findCatalogEntry(name);
      if (!catalog && server?.url) {
        // Hand-added servers rarely carry the registry's name, so fall back to
        // matching on the endpoint they point at.
        catalog = findCatalogEntryByUrl(server.url);
      }
    } catch {
      // No catalogue snapshot on disk; the rest of the detail still works.
    }

    return NextResponse.json({
      server,
      fields: parseDetail(raw),
      raw,
      catalog,
      removeCommand: `claude mcp remove ${/\s/.test(name) ? `'${name}'` : name}`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    if (body.action === "logout") {
      return NextResponse.json({ ok: true, output: await logoutMcpServer(decodeURIComponent(name)) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = request.nextUrl.searchParams.get("scope") as McpScope | null;
  try {
    return NextResponse.json({
      ok: true,
      output: await removeMcpServer(decodeURIComponent(name), scope ?? undefined),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
