import { NextRequest, NextResponse } from "next/server";
import { InvalidServerError, McpUnavailableError, addMcpServer, listMcpServers } from "@/lib/mcp";
import { pendingLoginNames } from "@/lib/mcp-login";
import { listProjects } from "@/lib/queries";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    const output = await addMcpServer({
      name: String(body.name ?? ""),
      url: String(body.url ?? ""),
      transport: String(body.transport ?? "http"),
      scope: body.scope === "local" || body.scope === "project" ? body.scope : "user",
      projectDir: typeof body.projectDir === "string" ? body.projectDir : undefined,
    });
    return NextResponse.json({ ok: true, output });
  } catch (err) {
    if (err instanceof InvalidServerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof McpUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not add the server." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const servers = await listMcpServers({ force: request.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json({
      servers,
      pendingLogins: pendingLoginNames(),
      // The project list feeds the scope picker: local/project scope needs a
      // real directory, and these are the ones this machine actually uses.
      projects: listProjects().map((p) => ({ slug: p.slug, name: p.displayName, dir: p.displayPath })),
      summary: {
        total: servers.length,
        connected: servers.filter((s) => s.status === "connected").length,
        needsAuth: servers.filter((s) => s.status === "needs-auth").length,
        connectors: servers.filter((s) => s.isConnector).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not list MCP servers.";
    return NextResponse.json({ error: message }, { status: err instanceof McpUnavailableError ? 503 : 500 });
  }
}
