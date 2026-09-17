import { NextRequest, NextResponse } from "next/server";
import { CatalogUnavailableError, catalogMeta, searchCatalog } from "@/lib/mcp-catalog";
import { listMcpServers } from "@/lib/mcp";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  try {
    const result = searchCatalog({
      query: params.get("q") ?? undefined,
      installableOnly: params.get("installable") !== "0",
      limit: Number(params.get("limit") ?? 40),
      offset: Number(params.get("offset") ?? 0),
    });

    // Mark what is already installed so the UI can show "Installed" rather than
    // offering an add that would fail on the duplicate-name check.
    let installedNames: string[] = [];
    try {
      installedNames = (await listMcpServers()).map((s) => s.name);
    } catch {
      // The catalogue is still browsable when the CLI is unavailable.
    }

    return NextResponse.json({ ...result, meta: catalogMeta(), installedNames });
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Catalogue search failed." },
      { status: 500 }
    );
  }
}
