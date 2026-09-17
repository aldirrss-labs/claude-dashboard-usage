import { NextRequest, NextResponse } from "next/server";
import {
  InvalidPassphraseError,
  MalformedExportError,
  decryptExport,
  importAccounts,
} from "@/lib/account-transfer";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  const overwrite = body.overwrite === true;

  if (!passphrase) {
    return NextResponse.json({ error: "Passphrase is required." }, { status: 400 });
  }
  if (!body.payload) {
    return NextResponse.json({ error: "No export file provided." }, { status: 400 });
  }

  try {
    const accounts = decryptExport(body.payload, passphrase);
    const result = importAccounts(accounts, { overwrite });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof InvalidPassphraseError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof MalformedExportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed." },
      { status: 500 }
    );
  }
}
