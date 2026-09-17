import { NextRequest, NextResponse } from "next/server";
import { LoginError, beginLogin, cancelLogin, completeLogin } from "@/lib/mcp-login";
import { loginCommandFor } from "@/lib/mcp";

/**
 * `claude mcp login` is a two-step conversation, so this endpoint is too:
 * POST with no body starts it and returns the authorization URL; POST with a
 * `redirectUrl` finishes it. DELETE abandons a started login.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);
  const body = await request.json().catch(() => ({}));

  try {
    if (typeof body.redirectUrl === "string" && body.redirectUrl.trim()) {
      return NextResponse.json({ ok: true, output: await completeLogin(name, body.redirectUrl) });
    }
    const { authUrl, expiresInMs } = await beginLogin(name);
    return NextResponse.json({ ok: true, authUrl, expiresInMs });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Login failed.",
        // Always offer the manual path: this flow depends on the CLI's
        // interactive prompt, and the terminal is the fallback when it changes.
        fallbackCommand: loginCommandFor(name),
      },
      { status: err instanceof LoginError ? 400 : 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return NextResponse.json({ ok: true, cancelled: cancelLogin(decodeURIComponent(name)) });
}
