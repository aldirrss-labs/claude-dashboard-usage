import { getDb } from "./db";
import { listAccounts, markAccountUsed } from "./account-queries";
import { readLiveClaudeState, switchToAccount } from "./account-swap";
import { getAllAccountUsage } from "./account-usage";
import { scanLiveSessions } from "./claude-sessions";
import { sessionProfileDir } from "./session-profiles";
import {
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_HYSTERESIS_PERCENT,
  DEFAULT_THRESHOLD_PERCENT,
  type AutoSwitchEvaluation,
  type AutoSwitchState,
  type AutoSwitchStrategy,
  evaluateAutoSwitch,
} from "./autoswitch";

export interface AutoSwitchSettings {
  enabled: boolean;
  strategy: AutoSwitchStrategy;
  thresholdPercent: number;
  hysteresisPercent: number;
  cooldownSeconds: number;
  restrictToGroup: boolean;
}

export const DEFAULT_SETTINGS: AutoSwitchSettings = {
  // Off by default: automatic switching rewrites the live credentials that
  // Claude Code is reading, so it is never something to opt a user into.
  enabled: false,
  strategy: "best",
  thresholdPercent: DEFAULT_THRESHOLD_PERCENT,
  hysteresisPercent: DEFAULT_HYSTERESIS_PERCENT,
  cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
  restrictToGroup: true,
};

export function getAutoSwitchSettings(): AutoSwitchSettings {
  const row = getDb().prepare(`SELECT * FROM autoswitch_settings WHERE id = 1`).get() as
    | {
        enabled: number;
        strategy: string;
        threshold_percent: number;
        hysteresis_percent: number;
        cooldown_seconds: number;
        restrict_to_group: number;
      }
    | undefined;
  if (!row) return DEFAULT_SETTINGS;

  return {
    enabled: row.enabled === 1,
    strategy: row.strategy === "consume-first" ? "consume-first" : "best",
    thresholdPercent: row.threshold_percent,
    hysteresisPercent: row.hysteresis_percent,
    cooldownSeconds: row.cooldown_seconds,
    restrictToGroup: row.restrict_to_group === 1,
  };
}

export function saveAutoSwitchSettings(settings: AutoSwitchSettings): void {
  getDb()
    .prepare(
      `INSERT INTO autoswitch_settings
         (id, enabled, strategy, threshold_percent, hysteresis_percent, cooldown_seconds, restrict_to_group)
       VALUES (1, @enabled, @strategy, @thresholdPercent, @hysteresisPercent, @cooldownSeconds, @restrictToGroup)
       ON CONFLICT(id) DO UPDATE SET
         enabled = @enabled, strategy = @strategy, threshold_percent = @thresholdPercent,
         hysteresis_percent = @hysteresisPercent, cooldown_seconds = @cooldownSeconds,
         restrict_to_group = @restrictToGroup`
    )
    .run({
      ...settings,
      enabled: settings.enabled ? 1 : 0,
      restrictToGroup: settings.restrictToGroup ? 1 : 0,
    });
}

export function getAutoSwitchState(): AutoSwitchState {
  const row = getDb().prepare(`SELECT * FROM autoswitch_state WHERE id = 1`).get() as
    | { last_switch_from: number | null; last_switch_to: number | null; last_switch_at: string | null }
    | undefined;
  if (!row) return { lastSwitchFrom: null, lastSwitchTo: null, lastSwitchAtMs: null };

  const parsed = row.last_switch_at ? Date.parse(`${row.last_switch_at.replace(" ", "T")}Z`) : NaN;
  return {
    lastSwitchFrom: row.last_switch_from,
    lastSwitchTo: row.last_switch_to,
    lastSwitchAtMs: Number.isNaN(parsed) ? null : parsed,
  };
}

function recordSwitch(fromId: number | null, toId: number, trigger: string): void {
  getDb()
    .prepare(
      `INSERT INTO autoswitch_state (id, last_switch_from, last_switch_to, last_switch_at, last_trigger)
       VALUES (1, ?, ?, datetime('now'), ?)
       ON CONFLICT(id) DO UPDATE SET
         last_switch_from = excluded.last_switch_from,
         last_switch_to = excluded.last_switch_to,
         last_switch_at = excluded.last_switch_at,
         last_trigger = excluded.last_trigger`
    )
    .run(fromId, toId, trigger);
}

/**
 * Evaluate every saved account against the current settings.
 * Read-only — this is what both the dashboard view and the runner consult, so
 * what the page shows is exactly what the runner would do.
 */
export async function evaluateNow(
  overrides: Partial<AutoSwitchSettings> = {},
  options: { force?: boolean } = {}
): Promise<{ evaluation: AutoSwitchEvaluation; settings: AutoSwitchSettings }> {
  const settings = { ...getAutoSwitchSettings(), ...overrides };
  const live = readLiveClaudeState();
  const liveOrg = live.oauthAccount?.organizationUuid;
  const liveAccount = live.oauthAccount?.accountUuid;

  const usageById = await getAllAccountUsage({ force: options.force });

  const evaluation = evaluateAutoSwitch(
    listAccounts().map((row) => {
      const state = usageById.get(row.id);
      return {
        id: row.id,
        label: row.label,
        email: row.email,
        disabled: row.disabled,
        reloginRequired: state?.reloginRequired ?? row.reloginRequired,
        active: row.organizationUuid === liveOrg && row.accountUuid === liveAccount,
        usage: state?.usage ?? null,
        groupName: row.groupName,
        hasLiveSession: scanLiveSessions(sessionProfileDir(row.id)).length > 0,
      };
    }),
    {
      strategy: settings.strategy,
      thresholdPercent: settings.thresholdPercent,
      hysteresisPercent: settings.hysteresisPercent,
      cooldownSeconds: settings.cooldownSeconds,
      restrictToGroup: settings.restrictToGroup,
      state: getAutoSwitchState(),
    }
  );

  return { evaluation, settings };
}

export interface AutoSwitchTickResult {
  acted: boolean;
  reason: string;
  switchedToId?: number;
}

/**
 * One automatic-switch tick, called from the ingest scheduler.
 *
 * Refuses to act while Claude Code is running against the default config
 * directory: swapping the credentials underneath a live session is how you
 * break someone's work mid-turn. It waits for the session to end instead.
 */
export async function runAutoSwitchTick(): Promise<AutoSwitchTickResult> {
  const settings = getAutoSwitchSettings();
  if (!settings.enabled) return { acted: false, reason: "disabled" };

  const liveHere = scanLiveSessions();
  if (liveHere.length > 0) {
    return { acted: false, reason: `Claude Code is running (pid ${liveHere.map((s) => s.pid).join(", ")})` };
  }

  const { evaluation } = await evaluateNow();
  if (!evaluation.canSwitchNow || evaluation.recommendedId === null) {
    return { acted: false, reason: evaluation.rationale };
  }

  await switchToAccount(evaluation.recommendedId);
  recordSwitch(evaluation.activeId, evaluation.recommendedId, "auto");
  markAccountUsed(evaluation.recommendedId);

  const target = evaluation.candidates.find((c) => c.id === evaluation.recommendedId);
  return {
    acted: true,
    reason: `Switched to ${target?.label ?? evaluation.recommendedId}: ${evaluation.rationale}`,
    switchedToId: evaluation.recommendedId,
  };
}

/** Record a manual switch too, so cooldown and anti-flap see the full picture. */
export function noteManualSwitch(fromId: number | null, toId: number): void {
  recordSwitch(fromId, toId, "manual");
}
