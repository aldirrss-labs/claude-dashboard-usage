import { NextRequest, NextResponse } from "next/server";
import {
  getDashboardSummary,
  getUsageTimeSeries,
  getModelBreakdown,
  getTopProjects,
  getDailyBudgetLimit,
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
  });
}
