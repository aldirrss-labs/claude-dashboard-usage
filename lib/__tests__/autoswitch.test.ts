import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateAutoSwitch,
  type AutoSwitchCandidate,
  type AutoSwitchOptions,
} from "../autoswitch";
import type { AccountUsage } from "../claude-oauth";

function usage(options: {
  fiveHour?: number;
  sevenDay?: number;
  scoped?: Array<{ label: string; percent: number; resetsAt?: string }>;
  resetsAt?: string;
}): AccountUsage {
  return {
    fiveHour:
      options.fiveHour === undefined
        ? null
        : { utilization: options.fiveHour, resetsAt: options.resetsAt ?? null },
    sevenDay:
      options.sevenDay === undefined
        ? null
        : { utilization: options.sevenDay, resetsAt: options.resetsAt ?? null },
    scoped: (options.scoped ?? []).map((s) => ({
      label: s.label,
      utilization: s.percent,
      resetsAt: s.resetsAt ?? null,
    })),
    spend: null,
    fetchedAt: "2026-09-17T00:00:00.000Z",
  };
}

function candidate(over: Partial<AutoSwitchCandidate> & { id: number }): AutoSwitchCandidate {
  return {
    label: `acct-${over.id}`,
    email: null,
    disabled: false,
    reloginRequired: false,
    active: false,
    usage: null,
    groupName: null,
    hasLiveSession: false,
    ...over,
  };
}

// Hysteresis, cooldown and group restriction each get their own tests below.
// Everything else opts out of them so a single guard cannot silently mask an
// unrelated expectation.
const OPEN: AutoSwitchOptions = {
  hysteresisPercent: 0,
  cooldownSeconds: 0,
  restrictToGroup: false,
};

function evaluate(candidates: AutoSwitchCandidate[], options: AutoSwitchOptions = {}) {
  return evaluateAutoSwitch(candidates, { ...OPEN, ...options });
}

describe("evaluateAutoSwitch", () => {
  it("leaves the active account alone while it is below the threshold", () => {
    const result = evaluate([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 40, sevenDay: 20 }) }),
      candidate({ id: 2, usage: usage({ fiveHour: 5, sevenDay: 5 }) }),
    ]);

    assert.strictEqual(result.shouldSwitch, false);
    assert.strictEqual(result.recommendedId, null);
    assert.strictEqual(result.activePressurePercent, 40);
  });

  it("uses the worst window as pressure, not just the 5h one", () => {
    const result = evaluate([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 10, sevenDay: 95 }) }),
      candidate({ id: 2, usage: usage({ fiveHour: 10, sevenDay: 10 }) }),
    ]);

    assert.strictEqual(result.activePressurePercent, 95);
    assert.strictEqual(result.shouldSwitch, true);
    assert.strictEqual(result.recommendedId, 2);
  });

  it("counts a per-model cap (e.g. Fable) toward pressure", () => {
    const result = evaluate([
      candidate({
        id: 1,
        active: true,
        usage: usage({ fiveHour: 10, sevenDay: 10, scoped: [{ label: "Fable", percent: 97 }] }),
      }),
      candidate({ id: 2, usage: usage({ fiveHour: 20, sevenDay: 20 }) }),
    ]);

    assert.strictEqual(result.activePressurePercent, 97);
    assert.strictEqual(result.recommendedId, 2);
  });

  it("strategy 'best' picks the most headroom", () => {
    const result = evaluate(
      [
        candidate({ id: 1, active: true, usage: usage({ fiveHour: 95 }) }),
        candidate({ id: 2, usage: usage({ fiveHour: 60 }) }),
        candidate({ id: 3, usage: usage({ fiveHour: 10 }) }),
      ],
      { strategy: "best" }
    );

    assert.strictEqual(result.recommendedId, 3);
  });

  it("strategy 'consume-first' picks the soonest reset instead", () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const result = evaluate(
      [
        candidate({ id: 1, active: true, usage: usage({ fiveHour: 95 }) }),
        candidate({ id: 2, usage: usage({ fiveHour: 10, resetsAt: later }) }),
        candidate({ id: 3, usage: usage({ fiveHour: 60, resetsAt: soon }) }),
      ],
      { strategy: "consume-first" }
    );

    // 'best' would have picked 2 (more headroom); consume-first drains 3 first.
    assert.strictEqual(result.recommendedId, 3);
  });

  it("excludes disabled, re-login-needed, dataless and over-threshold accounts", () => {
    const result = evaluate([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 95 }) }),
      candidate({ id: 2, disabled: true, usage: usage({ fiveHour: 1 }) }),
      candidate({ id: 3, reloginRequired: true, usage: usage({ fiveHour: 1 }) }),
      candidate({ id: 4, usage: null }),
      candidate({ id: 5, usage: usage({ fiveHour: 99 }) }),
    ]);

    assert.strictEqual(result.recommendedId, null);
    const byId = new Map(result.candidates.map((c) => [c.id, c]));
    assert.strictEqual(byId.get(2)!.reason, "Disabled");
    assert.strictEqual(byId.get(3)!.reason, "Re-login needed");
    assert.strictEqual(byId.get(4)!.reason, "No usage data");
    assert.strictEqual(byId.get(5)!.reason, "At or over threshold");
  });

  it("never recommends the account that is already active", () => {
    const result = evaluate([candidate({ id: 1, active: true, usage: usage({ fiveHour: 91 }) })]);

    assert.strictEqual(result.shouldSwitch, true);
    assert.strictEqual(result.recommendedId, null);
    assert.match(result.rationale, /no eligible account/i);
  });

  it("honours a custom threshold", () => {
    const candidates = [
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 55 }) }),
      candidate({ id: 2, usage: usage({ fiveHour: 5 }) }),
    ];

    assert.strictEqual(evaluate(candidates, { thresholdPercent: 90 }).shouldSwitch, false);
    assert.strictEqual(evaluate(candidates, { thresholdPercent: 50 }).shouldSwitch, true);
  });
});

describe("hysteresis", () => {
  it("rejects a candidate that is only marginally better", () => {
    // Active at 92% (8 free); candidate at 89% (11 free) — only 3 points better.
    const result = evaluate(
      [
        candidate({ id: 1, active: true, usage: usage({ fiveHour: 92 }) }),
        candidate({ id: 2, usage: usage({ fiveHour: 89 }) }),
      ],
      { hysteresisPercent: 5 }
    );

    assert.strictEqual(result.recommendedId, null);
    const other = result.candidates.find((c) => c.id === 2)!;
    assert.match(other.reason!, /5pt more headroom/);
  });

  it("accepts a candidate that clears the margin", () => {
    const result = evaluate(
      [
        candidate({ id: 1, active: true, usage: usage({ fiveHour: 99 }) }),
        candidate({ id: 2, usage: usage({ fiveHour: 89 }) }),
      ],
      { hysteresisPercent: 5 }
    );

    assert.strictEqual(result.recommendedId, 2);
  });
});

describe("cooldown", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");

  const pair = () => [
    candidate({ id: 1, active: true, usage: usage({ fiveHour: 95 }) }),
    candidate({ id: 2, usage: usage({ fiveHour: 5 }) }),
  ];

  it("blocks a second switch inside the cooldown window", () => {
    const result = evaluate(pair(), {
      cooldownSeconds: 900,
      nowMs: now,
      state: { lastSwitchFrom: 3, lastSwitchTo: 1, lastSwitchAtMs: now - 60_000 },
    });

    assert.strictEqual(result.shouldSwitch, true);
    assert.strictEqual(result.recommendedId, 2, "still names a target");
    assert.strictEqual(result.canSwitchNow, false, "but refuses to act on it");
    assert.strictEqual(result.cooldownRemainingSeconds, 840);
    assert.match(result.rationale, /cooldown/);
  });

  it("allows the switch once the cooldown has elapsed", () => {
    const result = evaluate(pair(), {
      cooldownSeconds: 900,
      nowMs: now,
      state: { lastSwitchFrom: 3, lastSwitchTo: 1, lastSwitchAtMs: now - 1_000_000 },
    });

    assert.strictEqual(result.canSwitchNow, true);
    assert.strictEqual(result.cooldownRemainingSeconds, null);
  });

  it("overrides the cooldown when the active account is fully exhausted", () => {
    const result = evaluate(
      [
        candidate({ id: 1, active: true, usage: usage({ fiveHour: 100 }) }),
        candidate({ id: 2, usage: usage({ fiveHour: 5 }) }),
      ],
      {
        cooldownSeconds: 900,
        nowMs: now,
        state: { lastSwitchFrom: 3, lastSwitchTo: 1, lastSwitchAtMs: now - 60_000 },
      }
    );

    // Waiting out a cooldown while unable to work at all helps nobody.
    assert.strictEqual(result.canSwitchNow, true);
  });
});

describe("anti-flap and guards", () => {
  it("never bounces straight back to the account just left", () => {
    const result = evaluate(
      [
        candidate({ id: 1, active: true, usage: usage({ fiveHour: 95 }) }),
        candidate({ id: 2, usage: usage({ fiveHour: 1 }) }),
      ],
      { state: { lastSwitchFrom: 2, lastSwitchTo: 1, lastSwitchAtMs: null } }
    );

    assert.strictEqual(result.recommendedId, null);
  });

  it("skips an account with a live Claude Code session", () => {
    const result = evaluate([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 95 }) }),
      candidate({ id: 2, hasLiveSession: true, usage: usage({ fiveHour: 1 }) }),
    ]);

    assert.strictEqual(result.recommendedId, null);
    assert.strictEqual(result.candidates.find((c) => c.id === 2)!.reason, "Live session running");
  });

  it("confines switching to the active account's group when asked", () => {
    const candidates = [
      candidate({ id: 1, active: true, groupName: "work", usage: usage({ fiveHour: 95 }) }),
      candidate({ id: 2, groupName: "personal", usage: usage({ fiveHour: 1 }) }),
      candidate({ id: 3, groupName: "work", usage: usage({ fiveHour: 20 }) }),
    ];

    const confined = evaluate(candidates, { restrictToGroup: true });
    assert.strictEqual(confined.recommendedId, 3, "personal account is off limits");
    assert.strictEqual(
      confined.candidates.find((c) => c.id === 2)!.reason,
      "Different group"
    );

    const open = evaluate(candidates, { restrictToGroup: false });
    assert.strictEqual(open.recommendedId, 2, "without the restriction, most headroom wins");
  });
});
