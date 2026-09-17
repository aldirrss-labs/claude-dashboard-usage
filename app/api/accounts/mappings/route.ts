import { NextRequest, NextResponse } from "next/server";
import { getAccountById } from "@/lib/account-queries";
import { deleteMapping, listMappings, resolveMappingForDir, setMapping } from "@/lib/directory-mappings";

export async function GET(request: NextRequest) {
  // ?dir=... asks which account a given directory resolves to, exercising the
  // same ancestor-walk the switcher uses.
  const dir = request.nextUrl.searchParams.get("dir");
  if (dir) {
    const resolved = resolveMappingForDir(dir);
    return NextResponse.json({
      resolved: resolved
        ? {
            canonicalDir: resolved.mapping.canonicalDir,
            accountId: resolved.account.id,
            accountLabel: resolved.account.label,
            accountEmail: resolved.account.email,
          }
        : null,
    });
  }

  const mappings = listMappings().map((m) => {
    const account = getAccountById(m.accountId);
    return {
      canonicalDir: m.canonicalDir,
      accountId: m.accountId,
      accountLabel: account?.label ?? null,
      accountEmail: account?.email ?? null,
      createdAt: m.createdAt,
    };
  });

  return NextResponse.json({ mappings });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dir = typeof body.dir === "string" ? body.dir : "";
  const accountId = Number(body.accountId);

  if (!dir.trim()) {
    return NextResponse.json({ error: "Directory is required." }, { status: 400 });
  }
  if (!Number.isInteger(accountId)) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ mapping: setMapping(dir, accountId) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save mapping." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");
  if (!dir) {
    return NextResponse.json({ error: "dir is required." }, { status: 400 });
  }
  deleteMapping(dir);
  return NextResponse.json({ ok: true });
}
