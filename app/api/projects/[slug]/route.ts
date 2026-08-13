import { NextResponse } from "next/server";
import { getProjectDetail } from "@/lib/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = getProjectDetail(slug);
  if (!detail) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project: detail });
}
