import { NextRequest, NextResponse } from "next/server";
import { getAccountById, setAccountDisabled } from "@/lib/account-queries";
import { readLiveClaudeState } from "@/lib/account-swap";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  const account = getAccountById(accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const body = await request.json();
  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "`disabled` must be a boolean." }, { status: 400 });
  }

  // Disabling the account you are currently signed in as would exclude the
  // live session from auto-switch while leaving it in use — confusing, and
  // claude-swap forbids it too. Switch away first.
  if (body.disabled) {
    const live = readLiveClaudeState();
    const isActive =
      account.organizationUuid === live.oauthAccount?.organizationUuid &&
      account.accountUuid === live.oauthAccount?.accountUuid;
    if (isActive) {
      return NextResponse.json(
        { error: "This account is currently active — switch to another account before disabling it." },
        { status: 409 }
      );
    }
  }

  setAccountDisabled(accountId, body.disabled);
  return NextResponse.json({ account: getAccountById(accountId) });
}
