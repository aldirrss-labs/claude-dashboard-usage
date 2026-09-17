import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/account-queries";
import { addAccountFromCurrentSession, readLiveClaudeState } from "@/lib/account-swap";

export async function GET() {
  const live = readLiveClaudeState();
  const liveOrganizationUuid = live.oauthAccount?.organizationUuid;
  const liveAccountUuid = live.oauthAccount?.accountUuid;

  const accounts = listAccounts().map((row) => {
    const credentials = JSON.parse(row.credentialsSnapshot);
    const refreshTokenExpiresAt = credentials?.claudeAiOauth?.refreshTokenExpiresAt;
    return {
      id: row.id,
      label: row.label,
      email: row.email,
      organizationUuid: row.organizationUuid,
      updatedAt: row.updatedAt,
      active: row.organizationUuid === liveOrganizationUuid && row.accountUuid === liveAccountUuid,
      refreshTokenExpired: typeof refreshTokenExpiresAt === "number" && refreshTokenExpiresAt < Date.now(),
    };
  });

  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Label is required." }, { status: 400 });
  }

  try {
    const account = await addAccountFromCurrentSession(label);
    return NextResponse.json({ account });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save the current session." },
      { status: 400 }
    );
  }
}
