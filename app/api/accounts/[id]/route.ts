import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, getAccountById, renameAccount } from "@/lib/account-queries";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (!getAccountById(accountId)) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const body = await request.json();
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Label is required." }, { status: 400 });
  }

  renameAccount(accountId, label);
  return NextResponse.json({ account: getAccountById(accountId) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (!getAccountById(accountId)) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  deleteAccount(accountId);
  return NextResponse.json({ ok: true });
}
