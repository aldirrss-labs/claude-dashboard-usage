import { runIngestCycle } from "./ingest";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __claudeDashboardIngestStarted: boolean | undefined;
}

export function startIngestScheduler(intervalMs: number = FIVE_MINUTES_MS): void {
  if (global.__claudeDashboardIngestStarted) return;
  global.__claudeDashboardIngestStarted = true;

  runIngestCycle();
  setInterval(() => {
    try {
      runIngestCycle();
    } catch (err) {
      console.error("[ingest] cycle failed:", err);
    }
  }, intervalMs).unref();
}
