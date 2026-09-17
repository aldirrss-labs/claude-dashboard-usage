import { runIngestCycle } from "./ingest";
import { maybeSendDailyReport } from "./daily-report-scheduler";
import { runAutoSwitchTick } from "./autoswitch-runner";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

declare global {
  // `var` is required here: a global augmentation cannot use let/const.
  var __claudeDashboardIngestStarted: boolean | undefined;
}

function runCycle(): void {
  try {
    runIngestCycle();
  } catch (err) {
    console.error("[ingest] cycle failed:", err);
  }
  maybeSendDailyReport().catch((err) => console.error("[daily-report] cycle failed:", err));

  // No-op unless the user has explicitly enabled auto-switch. Logged when it
  // acts, because silently changing which account is logged in would be a
  // nasty surprise to debug later.
  runAutoSwitchTick()
    .then((result) => {
      if (result.acted) console.log("[autoswitch]", result.reason);
    })
    .catch((err) => console.error("[autoswitch] tick failed:", err));
}

export function startIngestScheduler(intervalMs: number = FIVE_MINUTES_MS): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (global.__claudeDashboardIngestStarted) return;
  global.__claudeDashboardIngestStarted = true;

  runCycle();
  setInterval(runCycle, intervalMs).unref();
}
