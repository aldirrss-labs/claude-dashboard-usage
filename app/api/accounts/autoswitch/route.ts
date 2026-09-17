import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/account-queries";
import { readLiveClaudeState } from "@/lib/account-swap";
import { getAllAccountUsage } from "@/lib/account-usage";
import {
  DEFAULT_THRESHOLD_PERCENT,
  type AutoSwitchStrategy,
  evaluateAutoSwitch,
} from "@/lib/autoswitch";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const strategyParam = params.get("strategy");
  const strategy: AutoSwitchStrategy = strategyParam === "consume-first" ? "consume-first" : "best";

  const thresholdParam = Number(params.get("threshold"));
  const thresholdPercent =
    Number.isFinite(thresholdParam) && thresholdParam > 0 && thresholdParam <= 100
      ? thresholdParam
      : DEFAULT_THRESHOLD_PERCENT;

  const live = readLiveClaudeState();
  const liveOrg = live.oauthAccount?.organizationUuid;
  const liveAccount = live.oauthAccount?.accountUuid;

  const usageById = await getAllAccountUsage({ force: params.get("refresh") === "1" });

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
      };
    }),
    { strategy, thresholdPercent }
  );

  return NextResponse.json({ evaluation });
}
