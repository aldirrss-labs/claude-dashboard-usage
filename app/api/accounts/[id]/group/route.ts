import { NextRequest, NextResponse } from "next/server";
import { getAccountById, setAccountGroup } from "@/lib/account-queries";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (!getAccountById(accountId)) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  // An empty string clears the grouping rather than storing "".
  const groupName = typeof body.groupName === "string" && body.groupName.trim() ? body.groupName : null;

  setAccountGroup(accountId, groupName);
  return NextResponse.json({ account: getAccountById(accountId) });
}
