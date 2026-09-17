import type { AccountUsage } from "./claude-oauth";

// claude-swap's default: start looking for another account once any window on
// the active one crosses this.
export const DEFAULT_THRESHOLD_PERCENT = 90;

export type AutoSwitchStrategy = "best" | "consume-first";

export interface AutoSwitchCandidate {
  id: number;
  label: string;
  email: string | null;
  disabled: boolean;
  reloginRequired: boolean;
  active: boolean;
  usage: AccountUsage | null;
}

export interface EvaluatedCandidate {
  id: number;
  label: string;
  email: string | null;
  active: boolean;
  /** Worst (highest) utilization across every window — what actually limits you. */
  pressurePercent: number | null;
  /** 100 - pressure; how much room is left on the most-constrained window. */
  headroomPercent: number | null;
  /** Soonest reset across all windows, ISO 8601. */
  nextResetAt: string | null;
  eligible: boolean;
  reason: string | null;
}

export interface AutoSwitchEvaluation {
  strategy: AutoSwitchStrategy;
  thresholdPercent: number;
  candidates: EvaluatedCandidate[];
  activeId: number | null;
  activePressurePercent: number | null;
  /** True once the active account crosses the threshold. */
  shouldSwitch: boolean;
  recommendedId: number | null;
  rationale: string;
}

function maxUtilization(usage: AccountUsage | null): number | null {
  if (!usage) return null;
  const values: number[] = [];
  if (usage.fiveHour) values.push(usage.fiveHour.utilization);
  if (usage.sevenDay) values.push(usage.sevenDay.utilization);
  for (const scoped of usage.scoped) values.push(scoped.utilization);
  return values.length ? Math.max(...values) : null;
}

function soonestReset(usage: AccountUsage | null): string | null {
  if (!usage) return null;
  const times: number[] = [];
  const push = (iso: string | null) => {
    if (!iso) return;
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) times.push(parsed);
  };
  push(usage.fiveHour?.resetsAt ?? null);
  push(usage.sevenDay?.resetsAt ?? null);
  for (const scoped of usage.scoped) push(scoped.resetsAt);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

/**
 * Decide whether the active account is running out and which account to move
 * to. Pure — no I/O, no side effects — so the view and any future automatic
 * switcher share exactly one definition of "best".
 */
export function evaluateAutoSwitch(
  candidates: AutoSwitchCandidate[],
  options: { strategy?: AutoSwitchStrategy; thresholdPercent?: number } = {}
): AutoSwitchEvaluation {
  const strategy = options.strategy ?? "best";
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;

  const evaluated: EvaluatedCandidate[] = candidates.map((c) => {
    const pressurePercent = maxUtilization(c.usage);
    let reason: string | null = null;
    if (c.disabled) reason = "Disabled";
    else if (c.reloginRequired) reason = "Re-login needed";
    else if (pressurePercent === null) reason = "No usage data";
    else if (pressurePercent >= thresholdPercent) reason = "At or over threshold";

    return {
      id: c.id,
      label: c.label,
      email: c.email,
      active: c.active,
      pressurePercent,
      headroomPercent: pressurePercent === null ? null : 100 - pressurePercent,
      nextResetAt: soonestReset(c.usage),
      eligible: reason === null,
      reason,
    };
  });

  const active = evaluated.find((c) => c.active) ?? null;
  const activePressurePercent = active?.pressurePercent ?? null;
  const shouldSwitch = activePressurePercent !== null && activePressurePercent >= thresholdPercent;

  const pool = evaluated.filter((c) => c.eligible && !c.active);

  let recommended: EvaluatedCandidate | null = null;
  if (pool.length > 0) {
    if (strategy === "best") {
      // Most room left on the window that would bite first.
      recommended = pool.reduce((a, b) => ((b.headroomPercent ?? 0) > (a.headroomPercent ?? 0) ? b : a));
    } else {
      // consume-first: drain the account whose quota returns soonest, so the
      // longer-lived ones stay in reserve. Accounts with no known reset sort last.
      recommended = pool.reduce((a, b) => {
        const at = a.nextResetAt ? Date.parse(a.nextResetAt) : Number.POSITIVE_INFINITY;
        const bt = b.nextResetAt ? Date.parse(b.nextResetAt) : Number.POSITIVE_INFINITY;
        return bt < at ? b : a;
      });
    }
  }

  let rationale: string;
  if (activePressurePercent === null) {
    rationale = "No usage data for the active account yet.";
  } else if (!shouldSwitch) {
    rationale = `Active account is at ${activePressurePercent.toFixed(0)}%, below the ${thresholdPercent}% threshold.`;
  } else if (!recommended) {
    rationale = `Active account is at ${activePressurePercent.toFixed(0)}%, but no eligible account has room.`;
  } else {
    rationale =
      strategy === "best"
        ? `Active account is at ${activePressurePercent.toFixed(0)}%; ${recommended.label} has the most headroom (${(recommended.headroomPercent ?? 0).toFixed(0)}% free).`
        : `Active account is at ${activePressurePercent.toFixed(0)}%; ${recommended.label} resets soonest, so it is drained first.`;
  }

  return {
    strategy,
    thresholdPercent,
    candidates: evaluated,
    activeId: active?.id ?? null,
    activePressurePercent,
    shouldSwitch,
    recommendedId: shouldSwitch ? (recommended?.id ?? null) : null,
    rationale,
  };
}
