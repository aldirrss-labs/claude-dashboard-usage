import { NextRequest, NextResponse } from "next/server";
import { getAccountById } from "@/lib/account-queries";
import { deleteSessionProfile, describeProfile, ensureSessionProfile } from "@/lib/session-profiles";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (!getAccountById(accountId)) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  return NextResponse.json({ profile: describeProfile(accountId) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (!getAccountById(accountId)) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  try {
    const profile = ensureSessionProfile(accountId, { refreshExisting: body.refreshExisting === true });
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not prepare the session profile." },
      { status: 409 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    deleteSessionProfile(Number(id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not remove the session profile." },
      { status: 409 }
    );
  }
}
