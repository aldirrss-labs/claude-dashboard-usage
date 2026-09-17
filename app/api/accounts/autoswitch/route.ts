import { NextRequest, NextResponse } from "next/server";
import {
  type AutoSwitchSettings,
  evaluateNow,
  getAutoSwitchSettings,
  runAutoSwitchTick,
  saveAutoSwitchSettings,
} from "@/lib/autoswitch-runner";
import type { AutoSwitchStrategy } from "@/lib/autoswitch";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Preview overrides let the page show the effect of a setting before saving.
  // Read via a helper that distinguishes "absent" from a real value: Number(null)
  // is 0, not NaN, so a bare `Number(params.get(...))` silently turns a missing
  // parameter into a legitimate-looking 0 — which for hysteresis means quietly
  // switching the anti-flap guard off.
  const numberParam = (name: string, min: number, max: number): number | undefined => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
  };

  const overrides: Partial<AutoSwitchSettings> = {};
  const strategy = params.get("strategy");
  if (strategy === "best" || strategy === "consume-first") {
    overrides.strategy = strategy as AutoSwitchStrategy;
  }
  const threshold = numberParam("threshold", 1, 100);
  if (threshold !== undefined) overrides.thresholdPercent = threshold;

  const hysteresis = numberParam("hysteresis", 0, 100);
  if (hysteresis !== undefined) overrides.hysteresisPercent = hysteresis;

  const { evaluation, settings } = await evaluateNow(overrides, {
    force: params.get("refresh") === "1",
  });
  return NextResponse.json({ evaluation, settings });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const current = getAutoSwitchSettings();

  const next: AutoSwitchSettings = {
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    strategy:
      body.strategy === "best" || body.strategy === "consume-first" ? body.strategy : current.strategy,
    thresholdPercent:
      Number.isFinite(body.thresholdPercent) && body.thresholdPercent > 0 && body.thresholdPercent <= 100
        ? body.thresholdPercent
        : current.thresholdPercent,
    hysteresisPercent:
      Number.isFinite(body.hysteresisPercent) && body.hysteresisPercent >= 0 && body.hysteresisPercent <= 100
        ? body.hysteresisPercent
        : current.hysteresisPercent,
    cooldownSeconds:
      Number.isInteger(body.cooldownSeconds) && body.cooldownSeconds >= 0
        ? body.cooldownSeconds
        : current.cooldownSeconds,
    restrictToGroup:
      typeof body.restrictToGroup === "boolean" ? body.restrictToGroup : current.restrictToGroup,
  };

  saveAutoSwitchSettings(next);
  return NextResponse.json({ settings: next });
}

/** Run one tick immediately, rather than waiting for the 5-minute scheduler. */
export async function POST() {
  try {
    return NextResponse.json(await runAutoSwitchTick());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Auto-switch tick failed." },
      { status: 500 }
    );
  }
}
