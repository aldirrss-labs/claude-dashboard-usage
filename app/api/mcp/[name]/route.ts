import { NextRequest, NextResponse } from "next/server";
import {
  McpUnavailableError,
  UnknownServerError,
  getMcpServerDetail,
  logoutMcpServer,
  removeMcpServer,
  type McpScope,
} from "@/lib/mcp";

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

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    return NextResponse.json({ detail: await getMcpServerDetail(decodeURIComponent(name)) });
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
