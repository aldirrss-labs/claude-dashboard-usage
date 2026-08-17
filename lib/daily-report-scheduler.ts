import { getDailyReport, getEmailSettings, hasEmailLogEntry, recordEmailLog } from "./queries";
import { sendDailyReportEmail } from "./mailer";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * How many past days we're willing to "catch up" on if the app was offline
 * (laptop asleep/shut down) when midnight passed. Bounded so that enabling
 * the feature for the first time doesn't suddenly backfill months of email.
 */
const MAX_CATCH_UP_DAYS = 3;

async function sendReportFor(dateISO: string, settings: ReturnType<typeof getEmailSettings>): Promise<void> {
  try {
    const report = getDailyReport(dateISO);
    await sendDailyReportEmail(settings, report);
    recordEmailLog(dateISO, "sent");
  } catch (err) {
    recordEmailLog(dateISO, "failed");
    console.error(`[daily-report] send failed for ${dateISO}:`, err);
  }
}

/**
 * Runs on every ingest cycle (every 5 minutes), not just around midnight,
 * so a report for any completed day that's missing from email_log — e.g.
 * because the machine was off at midnight — gets sent as soon as the app
 * is next running, instead of being silently skipped.
 */
export async function maybeSendDailyReport(now: Date = new Date()): Promise<void> {
  const settings = getEmailSettings();
  if (!settings.enabled) return;

  const today = new Date(now);
  for (let daysAgo = 1; daysAgo <= MAX_CATCH_UP_DAYS; daysAgo++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    const dateISO = toIsoDate(d);
    if (hasEmailLogEntry(dateISO)) continue;
    await sendReportFor(dateISO, settings);
  }
}
