import { NextResponse } from "next/server";
import { AccountNotFoundError, UnsavedActiveSessionError, switchToAccount } from "@/lib/account-swap";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);

  try {
    await switchToAccount(accountId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof UnsavedActiveSessionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Switch failed." },
      { status: 500 }
    );
  }
}
