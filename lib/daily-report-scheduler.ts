import { getDailyReport, getEmailSettings, hasEmailLogEntry, recordEmailLog } from "./queries";
import { sendDailyReportEmail } from "./mailer";

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const REPORT_WINDOW_MINUTES = 10;

export async function maybeSendDailyReport(now: Date = new Date()): Promise<void> {
  const settings = getEmailSettings();
  if (!settings.enabled) return;
  if (now.getHours() !== 0 || now.getMinutes() >= REPORT_WINDOW_MINUTES) return;

  const dateISO = yesterdayIso();
  if (hasEmailLogEntry(dateISO)) return;

  try {
    const report = getDailyReport(dateISO);
    await sendDailyReportEmail(settings, report);
    recordEmailLog(dateISO, "sent");
  } catch (err) {
    recordEmailLog(dateISO, "failed");
    console.error("[daily-report] send failed:", err);
  }
}
