import { describe, it } from "node:test";
import assert from "node:assert";
import {
  OAUTH_EXPIRY_BUFFER_MS,
  isAccessTokenStale,
  isLoginLapsed,
  parseUsageResponse,
} from "../claude-oauth";
import { formatCents, formatRelativeTime, formatReset } from "../format-usage";

describe("parseUsageResponse", () => {
  it("parses the windows, per-model caps and credit spend", () => {
    const usage = parseUsageResponse({
      five_hour: { utilization: 19, resets_at: "2026-09-17T12:20:00Z" },
      seven_day: { utilization: 22, resets_at: "2026-09-21T12:00:00Z" },
      limits: [
        {
          scope: { model: { display_name: "Fable" } },
          percent: 7,
          resets_at: "2026-09-21T12:00:00Z",
        },
      ],
      extra_usage: {
        is_enabled: true,
        used_credits: 1542,
        monthly_limit: 20000,
        utilization: 8,
        currency: "USD",
      },
    });

    assert.strictEqual(usage.fiveHour?.utilization, 19);
    assert.strictEqual(usage.sevenDay?.utilization, 22);
    assert.strictEqual(usage.scoped.length, 1);
    assert.strictEqual(usage.scoped[0].label, "Fable");
    assert.strictEqual(usage.scoped[0].utilization, 7);
    assert.strictEqual(usage.spend?.usedCents, 1542);
    assert.strictEqual(usage.spend?.limitCents, 20000);
    // Matches the $15.42 / $200.00 row in claude-swap's dashboard.
    assert.strictEqual(formatCents(1542), "$15.42");
    assert.strictEqual(formatCents(20000), "$200.00");
  });

  it("omits pay-as-you-go spend when it is not enabled", () => {
    const usage = parseUsageResponse({
      five_hour: { utilization: 1 },
      extra_usage: { is_enabled: false, used_credits: 999, monthly_limit: 1000 },
    });
    assert.strictEqual(usage.spend, null);
  });

  it("derives spend utilization when the field is missing", () => {
    const usage = parseUsageResponse({
      extra_usage: { is_enabled: true, used_credits: 500, monthly_limit: 2000 },
    });
    assert.strictEqual(usage.spend?.utilization, 25);
  });

  it("survives an empty or unexpected payload instead of throwing", () => {
    const usage = parseUsageResponse({});
    assert.strictEqual(usage.fiveHour, null);
    assert.strictEqual(usage.sevenDay, null);
    assert.deepStrictEqual(usage.scoped, []);
    assert.strictEqual(usage.spend, null);

    const junk = parseUsageResponse({ five_hour: "nope", limits: "nope" });
    assert.strictEqual(junk.fiveHour, null);
    assert.deepStrictEqual(junk.scoped, []);
  });

  it("clamps out-of-range utilization and drops entries with no percent", () => {
    const usage = parseUsageResponse({
      five_hour: { utilization: 140 },
      limits: [
        { scope: { model: { display_name: "Fable" } } },
        { scope: { model: { display_name: "Opus" } }, percent: -5 },
      ],
    });
    assert.strictEqual(usage.fiveHour?.utilization, 100);
    assert.strictEqual(usage.scoped.length, 1);
    assert.strictEqual(usage.scoped[0].utilization, 0);
  });
});

describe("token staleness", () => {
  const now = Date.parse("2026-09-17T00:00:00Z");

  it("treats a token inside the expiry buffer as stale", () => {
    assert.strictEqual(isAccessTokenStale(now + OAUTH_EXPIRY_BUFFER_MS + 60_000, now), false);
    assert.strictEqual(isAccessTokenStale(now + OAUTH_EXPIRY_BUFFER_MS - 60_000, now), true);
    assert.strictEqual(isAccessTokenStale(null, now), true);
  });

  it("detects a lapsed login separately from a stale access token", () => {
    assert.strictEqual(isLoginLapsed(now + 1000, now), false);
    assert.strictEqual(isLoginLapsed(now - 1000, now), true);
    assert.strictEqual(isLoginLapsed(null, now), false);
  });
});

describe("formatters", () => {
  const now = Date.parse("2026-09-17T10:00:00Z");

  it("formats reset countdowns the way the TUI does", () => {
    // The wall-clock half is rendered in the viewer's local zone, so the
    // expectation is derived rather than hard-coded to one offset.
    const localHhMm = (iso: string) =>
      new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

    assert.strictEqual(
      formatReset("2026-09-17T12:31:00Z", now),
      `resets 2h 31m · ${localHhMm("2026-09-17T12:31:00Z")}`
    );
    assert.match(formatReset("2026-09-21T12:00:00Z", now)!, /^resets 4d 2h · /);
    assert.strictEqual(formatReset("2026-09-17T09:00:00Z", now), "resetting…");
    assert.strictEqual(formatReset(null, now), null);
  });

  it("formats relative times, including SQLite's zoneless stamps", () => {
    assert.strictEqual(formatRelativeTime("2026-09-17 09:57:00", now), "3m ago");
    assert.strictEqual(formatRelativeTime("2026-09-17T08:00:00Z", now), "2h ago");
    assert.strictEqual(formatRelativeTime("2026-09-17T09:59:50Z", now), "just now");
    assert.strictEqual(formatRelativeTime(null, now), null);
  });
});
