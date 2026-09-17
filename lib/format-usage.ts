/** "3m ago", "2h ago", "just now" — the relative stamp claude-swap shows. */
export function formatRelativeTime(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone.
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;

  const seconds = Math.floor((now - parsed) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/**
 * "resets 2h 31m · 12:20" / "resets 4d 2h · Sep 21 12:00" — a countdown plus
 * the wall-clock moment, matching claude-swap's dashboard.
 */
export function formatReset(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;

  const deltaMs = target - now;
  if (deltaMs <= 0) return "resetting…";

  const totalMinutes = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const countdown = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  const date = new Date(target);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  // Within a day the date is noise; past that it is the useful part.
  const stamp =
    days > 0
      ? `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`
      : time;

  return `resets ${countdown} · ${stamp}`;
}

export function formatCents(cents: number, currency = "USD"): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Green under pressure, amber approaching the cap, red at it. */
export function utilizationColor(percent: number): string {
  if (percent >= 90) return "var(--danger-500, #dc2626)";
  if (percent >= 70) return "var(--warning-500, #d97706)";
  return "var(--accent-500)";
}
