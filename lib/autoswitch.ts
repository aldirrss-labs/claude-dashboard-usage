import type { AccountUsage } from "./claude-oauth";

// claude-swap's default: start looking for another account once any window on
// the active one crosses this.
export const DEFAULT_THRESHOLD_PERCENT = 90;
/** A candidate must beat the active account by this many points to be worth a move. */
export const DEFAULT_HYSTERESIS_PERCENT = 5;
/** Minimum gap between switches, so a busy account cannot cause a flap storm. */
export const DEFAULT_COOLDOWN_SECONDS = 900;

export type AutoSwitchStrategy = "best" | "consume-first";

export interface AutoSwitchCandidate {
  id: number;
  label: string;
  email: string | null;
  disabled: boolean;
  reloginRequired: boolean;
  active: boolean;
  usage: AccountUsage | null;
  groupName: string | null;
  /** Claude Code is running against this account right now. */
  hasLiveSession: boolean;
}

export interface AutoSwitchState {
  lastSwitchFrom: number | null;
  lastSwitchTo: number | null;
  lastSwitchAtMs: number | null;
}

export interface AutoSwitchOptions {
  strategy?: AutoSwitchStrategy;
  thresholdPercent?: number;
  hysteresisPercent?: number;
  cooldownSeconds?: number;
  /** Only consider candidates sharing the active account's group. */
  restrictToGroup?: boolean;
  state?: AutoSwitchState;
  nowMs?: number;
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
  hysteresisPercent: number;
  candidates: EvaluatedCandidate[];
  activeId: number | null;
  activePressurePercent: number | null;
  /** True once the active account crosses the threshold. */
  shouldSwitch: boolean;
  recommendedId: number | null;
  rationale: string;
  /** Set while a recent switch still blocks another one. */
  cooldownRemainingSeconds: number | null;
  /** True when a switch is both warranted and permitted right now. */
  canSwitchNow: boolean;
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
  options: AutoSwitchOptions = {}
): AutoSwitchEvaluation {
  const strategy = options.strategy ?? "best";
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
  const hysteresisPercent = options.hysteresisPercent ?? DEFAULT_HYSTERESIS_PERCENT;
  const cooldownSeconds = options.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
  const restrictToGroup = options.restrictToGroup ?? true;
  const nowMs = options.nowMs ?? Date.now();

  const activeInput = candidates.find((c) => c.active) ?? null;
  const activePressure = maxUtilization(activeInput?.usage ?? null);
  const activeHeadroom = activePressure === null ? null : 100 - activePressure;

  const evaluated: EvaluatedCandidate[] = candidates.map((c) => {
    const pressurePercent = maxUtilization(c.usage);
    const headroomPercent = pressurePercent === null ? null : 100 - pressurePercent;

    let reason: string | null = null;
    if (c.disabled) reason = "Disabled";
    else if (c.reloginRequired) reason = "Re-login needed";
    else if (pressurePercent === null) reason = "No usage data";
    else if (pressurePercent >= thresholdPercent) reason = "At or over threshold";
    // A live Claude Code session owns this account's token in its own profile.
    // Making it the default login too would put one rotating refresh token in
    // two config dirs, and the loser of that race is locked out.
    else if (c.hasLiveSession && !c.active) reason = "Live session running";
    else if (
      restrictToGroup &&
      !c.active &&
      activeInput &&
      (c.groupName ?? null) !== (activeInput.groupName ?? null)
    ) {
      reason = "Different group";
    } else if (
      !c.active &&
      activeHeadroom !== null &&
      headroomPercent !== null &&
      headroomPercent - activeHeadroom < hysteresisPercent
    ) {
      // Hysteresis: a candidate must be meaningfully better, not marginally.
      // Without this, two accounts either side of the line trade places on
      // every tick.
      reason = `Needs ${hysteresisPercent}pt more headroom`;
    }

    return {
      id: c.id,
      label: c.label,
      email: c.email,
      active: c.active,
      pressurePercent,
      headroomPercent,
      nextResetAt: soonestReset(c.usage),
      eligible: reason === null,
      reason,
    };
  });

  const active = evaluated.find((c) => c.active) ?? null;
  const activePressurePercent = active?.pressurePercent ?? null;
  const shouldSwitch = activePressurePercent !== null && activePressurePercent >= thresholdPercent;

  // Anti-flap: never bounce straight back to the account just left.
  const justLeft = options.state?.lastSwitchFrom ?? null;
  const pool = evaluated.filter((c) => c.eligible && !c.active && c.id !== justLeft);

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

  const lastSwitchAtMs = options.state?.lastSwitchAtMs ?? null;
  const elapsedS = lastSwitchAtMs === null ? null : (nowMs - lastSwitchAtMs) / 1000;
  const cooldownRemainingSeconds =
    elapsedS !== null && elapsedS < cooldownSeconds ? Math.ceil(cooldownSeconds - elapsedS) : null;

  // The active account being *fully* exhausted is an escape hatch: waiting out
  // a cooldown while unable to work at all helps nobody.
  const atLimit = activePressurePercent !== null && activePressurePercent >= 100;
  const blockedByCooldown = cooldownRemainingSeconds !== null && !atLimit;

  const recommendedId = shouldSwitch ? (recommended?.id ?? null) : null;
  const canSwitchNow = recommendedId !== null && !blockedByCooldown;

  let rationale: string;
  if (activePressurePercent === null) {
    rationale = "No usage data for the active account yet.";
  } else if (!shouldSwitch) {
    rationale = `Active account is at ${activePressurePercent.toFixed(0)}%, below the ${thresholdPercent}% threshold.`;
  } else if (!recommended) {
    rationale = `Active account is at ${activePressurePercent.toFixed(0)}%, but no eligible account has room.`;
  } else if (blockedByCooldown) {
    rationale = `${recommended.label} is ready, but a switch happened ${Math.round((elapsedS ?? 0) / 60)}m ago — waiting out the cooldown (${cooldownRemainingSeconds}s left).`;
  } else {
    rationale =
      strategy === "best"
        ? `Active account is at ${activePressurePercent.toFixed(0)}%; ${recommended.label} has the most headroom (${(recommended.headroomPercent ?? 0).toFixed(0)}% free).`
        : `Active account is at ${activePressurePercent.toFixed(0)}%; ${recommended.label} resets soonest, so it is drained first.`;
  }

  return {
    strategy,
    thresholdPercent,
    hysteresisPercent,
    candidates: evaluated,
    activeId: active?.id ?? null,
    activePressurePercent,
    shouldSwitch,
    recommendedId,
    rationale,
    cooldownRemainingSeconds,
    canSwitchNow,
  };
}
