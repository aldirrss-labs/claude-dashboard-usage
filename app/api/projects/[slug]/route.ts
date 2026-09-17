import { NextRequest, NextResponse } from "next/server";
import {
  getProjectBranchUsage,
  getProjectDailySeries,
  getProjectDetail,
  getProjectModelBreakdown,
  getUsageByAccount,
} from "@/lib/queries";
import { attributionStartedAt } from "@/lib/account-activity";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rangeDays = Number(request.nextUrl.searchParams.get("rangeDays") ?? "90");

  const detail = getProjectDetail(slug);
  if (!detail) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // getProjectModelBreakdown works across projects; pick this one out of it so
  // the per-project model split uses exactly the same costing as the dashboard.
  const models = getProjectModelBreakdown(rangeDays, 500).find((p) => p.slug === slug)?.models ?? [];

  return NextResponse.json({
    project: detail,
    daily: getProjectDailySeries(slug, rangeDays),
    models,
    branches: getProjectBranchUsage(slug, rangeDays),
    byAccount: getUsageByAccount(rangeDays, slug),
    attributionStartedAt: attributionStartedAt(),
    rangeDays,
  });
}
