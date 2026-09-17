// Adaptive polling for /api/oauth/usage, ported from claude-swap's
// poll_policy.py. The shape is TCP-style congestion control: react to what the
// endpoint and the numbers tell us, so several machines sharing one token each
// back off until their combined rate fits the budget — no shared coordination
// state and no machine count to configure.

/** Normal floor between polls for one account. */
export const MIN_INTERVAL_S = 180;
/** Floor when the active account is near its limit and actually moving. */
export const URGENT_INTERVAL_S = 60;
/** Ceiling for the account currently in use. */
export const ACTIVE_MAX_INTERVAL_S = 300;
/** Ceiling for accounts sitting idle in the background. */
export const IDLE_MAX_INTERVAL_S = 600;
/** An exhausted account is still polled this often, to catch quota returning. */
export const EXHAUSTED_INTERVAL_S = 600;
/** Floor for an hour after a 429. */
export const POST_429_MIN_INTERVAL_S = 360;
/** Ceiling while backing off from a 429. */
export const POST_429_MAX_INTERVAL_S = 1800;
/** How long a 429 keeps influencing the interval. */
export const POST_429_WINDOW_MS = 60 * 60 * 1000;
/** A binding-window change at or above this counts as real movement. */
export const MOVEMENT_THRESHOLD_PCT = 1;
/** Never sleep past a window reset by more than this. */
export const RESET_SLACK_S = 60;
/** "Near threshold" for the urgent interval. */
export const NEAR_LIMIT_PCT = 85;

export interface PollPlanInput {
  isActive: boolean;
  /** Highest utilization across this account's windows, 0-100. */
  bindingPercent: number | null;
  /** Same figure from the previous poll, for movement detection. */
  previousBindingPercent: number | null;
  previousIntervalS: number | null;
  /** Epoch ms of the most recent 429, if any. */
  last429AtMs: number | null;
  /** Epoch ms of the soonest window reset, if known. */
  nextResetAtMs: number | null;
  nowMs: number;
}

export interface PollPlan {
  intervalS: number;
  nextPollAtMs: number;
  reason: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Decide when this account should next be polled, given what the last poll
 * returned. Pure, so the whole policy is testable without network or clock.
 */
export function planNextPoll(input: PollPlanInput): PollPlan {
  const {
    isActive,
    bindingPercent,
    previousBindingPercent,
    previousIntervalS,
    last429AtMs,
    nextResetAtMs,
    nowMs,
  } = input;

  const ceiling = isActive ? ACTIVE_MAX_INTERVAL_S : IDLE_MAX_INTERVAL_S;
  const base = previousIntervalS ?? MIN_INTERVAL_S;

  let intervalS: number;
  let reason: string;

  const recently429 = last429AtMs !== null && nowMs - last429AtMs < POST_429_WINDOW_MS;

  if (recently429) {
    // Multiplicative retreat toward the wider ceiling. Deliberately checked
    // before everything else: when the endpoint is pushing back, that outranks
    // any reason we might have to poll sooner.
    intervalS = clamp(Math.max(base * 1.5, POST_429_MIN_INTERVAL_S), POST_429_MIN_INTERVAL_S, POST_429_MAX_INTERVAL_S);
    reason = "backing off after a 429";
  } else if (bindingPercent !== null && bindingPercent >= 100) {
    // No quota left, but keep a slow heartbeat so a provider-side grant or an
    // early reset is noticed.
    intervalS = EXHAUSTED_INTERVAL_S;
    reason = "exhausted — slow heartbeat";
  } else {
    const moved =
      bindingPercent !== null &&
      previousBindingPercent !== null &&
      Math.abs(bindingPercent - previousBindingPercent) >= MOVEMENT_THRESHOLD_PCT;

    if (moved) {
      const nearLimit = bindingPercent !== null && bindingPercent >= NEAR_LIMIT_PCT;
      if (isActive && nearLimit) {
        intervalS = URGENT_INTERVAL_S;
        reason = "active and close to the limit";
      } else {
        // Consumption is happening somewhere — tighten up.
        intervalS = clamp(base / 2, MIN_INTERVAL_S, ceiling);
        reason = "usage moving";
      }
    } else {
      // Quiet: drift toward the ceiling.
      intervalS = clamp(base * 1.5, MIN_INTERVAL_S, ceiling);
      reason = "idle — backing off";
    }
  }

  let nextPollAtMs = nowMs + intervalS * 1000;

  // Never sleep past a reset: the moment quota returns is the most interesting
  // sample there is.
  if (nextResetAtMs !== null && nextResetAtMs > nowMs) {
    const atReset = nextResetAtMs + RESET_SLACK_S * 1000;
    if (atReset < nextPollAtMs) {
      nextPollAtMs = atReset;
      intervalS = Math.round((nextPollAtMs - nowMs) / 1000);
      reason = "waiting for window reset";
    }
  }

  return { intervalS, nextPollAtMs, reason };
}
