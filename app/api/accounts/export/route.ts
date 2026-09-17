import { NextRequest, NextResponse } from "next/server";
import { collectAccountsForExport, encryptExport } from "@/lib/account-transfer";

// POST, not GET: the passphrase must not land in a URL, browser history, or
// the server log.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";

  if (passphrase.length < 8) {
    return NextResponse.json(
      { error: "Passphrase must be at least 8 characters — this file contains live logins." },
      { status: 400 }
    );
  }

  const accounts = collectAccountsForExport();
  if (accounts.length === 0) {
    return NextResponse.json({ error: "No accounts to export." }, { status: 400 });
  }

  const payload = encryptExport(accounts, passphrase);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="claude-accounts-${stamp}.json"`,
      // Never let a proxy or the browser retain a file full of live tokens.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
