import { runIngestCycle } from "./ingest";
import { maybeSendDailyReport } from "./daily-report-scheduler";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __claudeDashboardIngestStarted: boolean | undefined;
}

function runCycle(): void {
  try {
    runIngestCycle();
  } catch (err) {
    console.error("[ingest] cycle failed:", err);
  }
  maybeSendDailyReport().catch((err) => console.error("[daily-report] cycle failed:", err));
}

export function startIngestScheduler(intervalMs: number = FIVE_MINUTES_MS): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (global.__claudeDashboardIngestStarted) return;
  global.__claudeDashboardIngestStarted = true;

  runCycle();
  setInterval(runCycle, intervalMs).unref();
}
