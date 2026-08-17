import { NextResponse } from "next/server";
import { runIngestCycle } from "@/lib/ingest";
import { getLastSyncedAt } from "@/lib/queries";

export async function POST() {
  try {
    const result = runIngestCycle();
    return NextResponse.json({
      ok: true,
      filesScanned: result.filesScanned,
      eventsInserted: result.eventsInserted,
      syncedAt: getLastSyncedAt(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error during sync." },
      { status: 500 }
    );
  }
}
