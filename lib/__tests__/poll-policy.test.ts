import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ACTIVE_MAX_INTERVAL_S,
  EXHAUSTED_INTERVAL_S,
  IDLE_MAX_INTERVAL_S,
  MIN_INTERVAL_S,
  POST_429_MAX_INTERVAL_S,
  POST_429_MIN_INTERVAL_S,
  URGENT_INTERVAL_S,
  planNextPoll,
  type PollPlanInput,
} from "../poll-policy";

const NOW = Date.parse("2026-09-17T12:00:00Z");

function plan(over: Partial<PollPlanInput> = {}) {
  return planNextPoll({
    isActive: false,
    bindingPercent: 40,
    previousBindingPercent: 40,
    previousIntervalS: null,
    last429AtMs: null,
    nextResetAtMs: null,
    nowMs: NOW,
    ...over,
  });
}

describe("planNextPoll", () => {
  it("backs off toward the idle ceiling when nothing moves", () => {
    const first = plan({ previousIntervalS: MIN_INTERVAL_S });
    assert.strictEqual(first.intervalS, MIN_INTERVAL_S * 1.5);

    // Repeated quiet ticks keep widening, but stop at the ceiling.
    let interval = MIN_INTERVAL_S;
    for (let i = 0; i < 12; i++) interval = plan({ previousIntervalS: interval }).intervalS;
    assert.strictEqual(interval, IDLE_MAX_INTERVAL_S);
  });

  it("uses a lower ceiling for the active account", () => {
    let interval = MIN_INTERVAL_S;
    for (let i = 0; i < 12; i++) {
      interval = plan({ isActive: true, previousIntervalS: interval }).intervalS;
    }
    assert.strictEqual(interval, ACTIVE_MAX_INTERVAL_S);
  });

  it("tightens when the binding window moves, never below the floor", () => {
    const moved = plan({ previousIntervalS: 600, bindingPercent: 45, previousBindingPercent: 40 });
    assert.strictEqual(moved.intervalS, 300);

    const clamped = plan({ previousIntervalS: 200, bindingPercent: 45, previousBindingPercent: 40 });
    assert.strictEqual(clamped.intervalS, MIN_INTERVAL_S);
  });

  it("ignores movement below one percentage point", () => {
    const result = plan({ previousIntervalS: 300, bindingPercent: 40.4, previousBindingPercent: 40 });
    assert.match(result.reason, /idle/);
  });

  it("drops to the urgent interval only when active and near the limit", () => {
    const urgent = plan({
      isActive: true,
      previousIntervalS: 300,
      bindingPercent: 92,
      previousBindingPercent: 88,
    });
    assert.strictEqual(urgent.intervalS, URGENT_INTERVAL_S);

    // Same numbers on an idle account do not earn the urgent rate.
    const idle = plan({
      isActive: false,
      previousIntervalS: 300,
      bindingPercent: 92,
      previousBindingPercent: 88,
    });
    assert.strictEqual(idle.intervalS, MIN_INTERVAL_S);
  });

  it("keeps a slow heartbeat on an exhausted account", () => {
    const result = plan({ isActive: true, bindingPercent: 100, previousBindingPercent: 95 });
    assert.strictEqual(result.intervalS, EXHAUSTED_INTERVAL_S);
    assert.match(result.reason, /exhausted/);
  });

  it("retreats after a 429 and outranks every reason to poll sooner", () => {
    const justNow = plan({
      isActive: true,
      previousIntervalS: MIN_INTERVAL_S,
      bindingPercent: 95,
      previousBindingPercent: 80,
      last429AtMs: NOW - 1000,
    });
    // Would otherwise be the 60s urgent rate.
    assert.ok(justNow.intervalS >= POST_429_MIN_INTERVAL_S);
    assert.match(justNow.reason, /429/);

    let interval = POST_429_MIN_INTERVAL_S;
    for (let i = 0; i < 10; i++) {
      interval = plan({ previousIntervalS: interval, last429AtMs: NOW - 1000 }).intervalS;
    }
    assert.strictEqual(interval, POST_429_MAX_INTERVAL_S);
  });

  it("stops honouring a 429 once its window has passed", () => {
    const stale429 = plan({
      previousIntervalS: 600,
      last429AtMs: NOW - 2 * 60 * 60 * 1000,
      bindingPercent: 45,
      previousBindingPercent: 40,
    });
    assert.ok(!/429/.test(stale429.reason));
    assert.strictEqual(stale429.intervalS, 300);
  });

  it("never sleeps past a window reset", () => {
    const resetAt = NOW + 90 * 1000;
    const result = plan({ previousIntervalS: 600, nextResetAtMs: resetAt });
    assert.ok(result.nextPollAtMs <= resetAt + 60 * 1000);
    assert.match(result.reason, /reset/);
  });

  it("ignores a reset that is further away than the planned interval", () => {
    const result = plan({ previousIntervalS: MIN_INTERVAL_S, nextResetAtMs: NOW + 86_400_000 });
    assert.ok(!/reset/.test(result.reason));
  });

  it("treats a first-ever poll (no history) as idle backoff from the floor", () => {
    const result = plan({ previousIntervalS: null, previousBindingPercent: null });
    assert.strictEqual(result.intervalS, MIN_INTERVAL_S * 1.5);
  });
});
