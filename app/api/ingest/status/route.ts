import { NextResponse } from "next/server";
import { getLastSyncedAt } from "@/lib/queries";

export async function GET() {
  return NextResponse.json({ lastSyncedAt: getLastSyncedAt() });
}
