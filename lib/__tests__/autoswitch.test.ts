import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateAutoSwitch, type AutoSwitchCandidate } from "../autoswitch";
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
    ...over,
  };
}

describe("evaluateAutoSwitch", () => {
  it("leaves the active account alone while it is below the threshold", () => {
    const result = evaluateAutoSwitch([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 40, sevenDay: 20 }) }),
      candidate({ id: 2, usage: usage({ fiveHour: 5, sevenDay: 5 }) }),
    ]);

    assert.strictEqual(result.shouldSwitch, false);
    assert.strictEqual(result.recommendedId, null);
    assert.strictEqual(result.activePressurePercent, 40);
  });

  it("uses the worst window as pressure, not just the 5h one", () => {
    const result = evaluateAutoSwitch([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 10, sevenDay: 95 }) }),
      candidate({ id: 2, usage: usage({ fiveHour: 10, sevenDay: 10 }) }),
    ]);

    assert.strictEqual(result.activePressurePercent, 95);
    assert.strictEqual(result.shouldSwitch, true);
    assert.strictEqual(result.recommendedId, 2);
  });

  it("counts a per-model cap (e.g. Fable) toward pressure", () => {
    const result = evaluateAutoSwitch([
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
    const result = evaluateAutoSwitch(
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

    const result = evaluateAutoSwitch(
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
    const result = evaluateAutoSwitch([
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
    const result = evaluateAutoSwitch([
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 91 }) }),
    ]);

    assert.strictEqual(result.shouldSwitch, true);
    assert.strictEqual(result.recommendedId, null);
    assert.match(result.rationale, /no eligible account/i);
  });

  it("honours a custom threshold", () => {
    const candidates = [
      candidate({ id: 1, active: true, usage: usage({ fiveHour: 55 }) }),
      candidate({ id: 2, usage: usage({ fiveHour: 5 }) }),
    ];

    assert.strictEqual(evaluateAutoSwitch(candidates, { thresholdPercent: 90 }).shouldSwitch, false);
    assert.strictEqual(evaluateAutoSwitch(candidates, { thresholdPercent: 50 }).shouldSwitch, true);
  });
});
