import { NextRequest, NextResponse } from "next/server";
import {
  getActivityHeatmap,
  getDailyBudgetLimit,
  getDashboardSummary,
  getModelBreakdown,
  getProjectModelBreakdown,
  getSessionStats,
  getTokenComposition,
  getTopProjects,
  getUsageTimeSeries,
} from "@/lib/queries";

export async function GET(request: NextRequest) {
  const rangeDays = Number(request.nextUrl.searchParams.get("rangeDays") ?? "30");
  const bucket = (request.nextUrl.searchParams.get("bucket") ?? "day") as "day" | "week" | "month";

  return NextResponse.json({
    summary: getDashboardSummary(rangeDays),
    timeSeries: getUsageTimeSeries(rangeDays, bucket),
    modelBreakdown: getModelBreakdown(rangeDays),
    topProjects: getTopProjects(rangeDays),
    budgetLimit: getDailyBudgetLimit(),
    tokenComposition: getTokenComposition(rangeDays),
    projectModels: getProjectModelBreakdown(rangeDays),
    sessionStats: getSessionStats(rangeDays),
    activity: getActivityHeatmap(rangeDays),
  });
}
