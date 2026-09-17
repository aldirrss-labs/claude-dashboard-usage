"use client";

import { formatCompact } from "@/lib/format-usage";

export interface ActivityCell {
  dayOfWeek: number; // 0 = Sunday, matching SQLite strftime('%w')
  hour: number;
  events: number;
  tokens: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Day-of-week × hour grid of when work actually happens.
 *
 * Intensity is scaled against the busiest cell rather than the total, because
 * usage is extremely uneven — a linear scale against the sum would leave every
 * cell but one indistinguishably dark. Empty cells are drawn rather than
 * skipped so the grid keeps its shape and a quiet hour reads as quiet rather
 * than as missing.
 */
export function ActivityHeatmap({ cells }: { cells: ActivityCell[] }) {
  const byKey = new Map(cells.map((c) => [`${c.dayOfWeek}:${c.hour}`, c]));
  const peak = Math.max(...cells.map((c) => c.tokens), 0);

  if (cells.length === 0) {
    return <p className="label-mono">No activity in this range.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className="w-10 shrink-0" />
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="label-mono flex-1 text-center"
              style={{ minWidth: 18, fontSize: "9px", letterSpacing: 0 }}
            >
              {/* Every third hour, so the strip stays readable when narrow. */}
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </div>
          ))}
        </div>

        {DAYS.map((dayLabel, day) => (
          <div key={day} className="flex items-center">
            <div className="label-mono w-10 shrink-0" style={{ fontSize: "10px" }}>
              {dayLabel}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = byKey.get(`${day}:${hour}`);
              const intensity = cell && peak > 0 ? cell.tokens / peak : 0;
              return (
                <div
                  key={hour}
                  className="flex-1"
                  style={{
                    minWidth: 18,
                    height: 18,
                    margin: 1,
                    // Floor the opacity of any non-empty cell so a real but
                    // small hour never renders as indistinguishable from zero.
                    background: cell
                      ? `color-mix(in srgb, var(--accent-500) ${Math.max(intensity * 100, 8)}%, var(--surface-2))`
                      : "var(--surface-2)",
                  }}
                  title={
                    cell
                      ? `${dayLabel} ${String(hour).padStart(2, "0")}:00 — ${formatCompact(cell.tokens)} tokens, ${cell.events.toLocaleString()} events`
                      : `${dayLabel} ${String(hour).padStart(2, "0")}:00 — no activity`
                  }
                />
              );
            })}
          </div>
        ))}

        <div className="mt-3 flex items-center gap-2">
          <span className="label-mono">Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => (
            <div
              key={step}
              style={{
                width: 18,
                height: 10,
                background: `color-mix(in srgb, var(--accent-500) ${Math.max(step * 100, 8)}%, var(--surface-2))`,
              }}
            />
          ))}
          <span className="label-mono">More · peak {formatCompact(peak)} tokens/hour</span>
        </div>
      </div>
    </div>
  );
}
