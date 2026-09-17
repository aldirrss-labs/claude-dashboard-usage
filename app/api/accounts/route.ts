import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/account-queries";
import { addAccountFromCurrentSession, readLiveClaudeState } from "@/lib/account-swap";
import { type AccountUsageState, getAllAccountUsage } from "@/lib/account-usage";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const live = readLiveClaudeState();
  const liveOrganizationUuid = live.oauthAccount?.organizationUuid;
  const liveAccountUuid = live.oauthAccount?.accountUuid;

  let usageById = new Map<number, AccountUsageState>();
  try {
    usageById = await getAllAccountUsage({ force });
  } catch {
    // A total failure here must not take the page down — the list still
    // renders, just without quota numbers.
  }

  const accounts = listAccounts().map((row) => {
    const credentials = JSON.parse(row.credentialsSnapshot);
    const refreshTokenExpiresAt = credentials?.claudeAiOauth?.refreshTokenExpiresAt;
    const usageState = usageById.get(row.id) ?? null;
    const loginLapsed = typeof refreshTokenExpiresAt === "number" && refreshTokenExpiresAt < Date.now();

    return {
      id: row.id,
      label: row.label,
      email: row.email,
      organizationUuid: row.organizationUuid,
      updatedAt: row.updatedAt,
      active: row.organizationUuid === liveOrganizationUuid && row.accountUuid === liveAccountUuid,
      disabled: row.disabled,
      lastUsedAt: row.lastUsedAt,
      refreshTokenExpired: loginLapsed,
      reloginRequired: loginLapsed || (usageState?.reloginRequired ?? row.reloginRequired),
      usage: usageState?.usage ?? null,
      usageFetchedAt: usageState?.fetchedAt ?? row.usageFetchedAt,
      usageError: usageState?.error ?? null,
      usageStale: usageState?.stale ?? true,
    };
  });

  const liveEmail = typeof live.oauthAccount?.emailAddress === "string" ? live.oauthAccount.emailAddress : null;
  const liveSaved = accounts.some((a) => a.active);

  return NextResponse.json({ accounts, live: { email: liveEmail, saved: liveSaved } });
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
