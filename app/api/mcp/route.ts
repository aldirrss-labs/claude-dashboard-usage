import { NextRequest, NextResponse } from "next/server";
import { McpUnavailableError, listMcpServers } from "@/lib/mcp";
import { pendingLoginNames } from "@/lib/mcp-login";

export async function GET(request: NextRequest) {
  try {
    const servers = await listMcpServers({ force: request.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json({
      servers,
      pendingLogins: pendingLoginNames(),
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
