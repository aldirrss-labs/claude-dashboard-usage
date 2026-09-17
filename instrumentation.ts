/**
 * Next.js runs `register()` once when the server process boots, before any
 * request. Starting the scheduler here rather than from `app/layout.tsx` fixes
 * a real gap: the root page is statically prerendered, so the layout module was
 * only evaluated once some dynamic route was requested — meaning a service that
 * booted and was never visited did no ingesting and sent no daily report.
 *
 * It also means the data directory is locked down at startup rather than
 * whenever the database first happens to be opened.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getDashboardDataDir, getDbPath, secureDbFiles } = await import("./lib/paths");
  try {
    getDashboardDataDir();
    secureDbFiles(getDbPath());
  } catch (err) {
    console.error("[startup] could not secure the data directory:", err);
  }

  const { startIngestScheduler } = await import("./lib/ingest-scheduler");
  startIngestScheduler();
}
