import { NextRequest, NextResponse } from "next/server";
import { getDailyBudgetLimit, setDailyBudgetLimit } from "@/lib/queries";

export async function GET() {
  return NextResponse.json(getDailyBudgetLimit());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const limitUsd = typeof body.limitUsd === "number" && body.limitUsd > 0 ? body.limitUsd : null;
  setDailyBudgetLimit(limitUsd);
  return NextResponse.json(getDailyBudgetLimit());
}
