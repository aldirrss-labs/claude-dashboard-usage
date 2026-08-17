interface TrendIndicatorProps {
  pct: number | null;
  label?: string;
  invert?: boolean;
}

export function TrendIndicator({ pct, label, invert = false }: TrendIndicatorProps) {
  if (pct === null) {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        —
      </span>
    );
  }

  const rounded = Math.round(pct);
  const isFlat = rounded === 0;
  const isUp = rounded > 0;
  const isGood = invert ? !isUp : isUp;
  const color = isFlat ? "var(--text-muted)" : isGood ? "var(--trend-down)" : "var(--trend-up)";
  const arrow = isFlat ? "" : isUp ? "↑" : "↓";

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      {arrow} {Math.abs(rounded)}%{label && <span style={{ color: "var(--text-muted)" }}>{label}</span>}
    </span>
  );
}
