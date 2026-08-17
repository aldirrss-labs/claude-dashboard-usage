import { NextResponse } from "next/server";
import { getEmailSettings, getDailyReport } from "@/lib/queries";
import { sendDailyReportEmail } from "@/lib/mailer";

export async function POST() {
  try {
    const settings = getEmailSettings();
    const todayIso = new Date().toISOString().slice(0, 10);
    const report = getDailyReport(todayIso);
    await sendDailyReportEmail(settings, report);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to send test email" },
      { status: 500 }
    );
  }
}
