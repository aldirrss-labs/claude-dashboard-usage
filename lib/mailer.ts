import nodemailer from "nodemailer";
import type { DailyReport, EmailSettings } from "./queries";

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function renderReportHtml(report: DailyReport): string {
  const changeLine =
    report.costChangePct === null
      ? "No comparable data for the previous day."
      : `${report.costChangePct >= 0 ? "Up" : "Down"} ${Math.abs(report.costChangePct).toFixed(1)}% vs. yesterday (${formatUsd(report.previousDayCostUsd)}).`;

  const projectRows = report.byProject
    .map(
      (p) =>
        `<tr><td style="padding:4px 12px 4px 0;">${p.displayName}</td><td style="padding:4px 0;text-align:right;">${p.totalTokens.toLocaleString()}</td><td style="padding:4px 0 4px 12px;text-align:right;">${formatUsd(p.costUsd)}</td></tr>`
    )
    .join("");

  const modelRows = report.byModel
    .map(
      (m) =>
        `<tr><td style="padding:4px 12px 4px 0;">${m.model}</td><td style="padding:4px 0;text-align:right;">${m.totalTokens.toLocaleString()}</td><td style="padding:4px 0 4px 12px;text-align:right;">${formatUsd(m.costUsd)}</td></tr>`
    )
    .join("");

  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
    <h2 style="margin-bottom: 4px;">Claude Usage — Daily Report</h2>
    <p style="color: #6b7280; margin-top: 0;">${report.date}</p>

    <div style="background: #f7f8fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <div style="font-size: 13px; color: #6b7280; text-transform: uppercase;">Total cost</div>
      <div style="font-size: 28px; font-weight: 600;">${formatUsd(report.totalCostUsd)}</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">${changeLine}</div>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="padding: 4px 0; color: #6b7280;">Total tokens</td>
        <td style="padding: 4px 0; text-align: right; font-weight: 600;">${report.totalTokens.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; color: #6b7280;">Cache efficiency</td>
        <td style="padding: 4px 0; text-align: right; font-weight: 600;">${report.cacheEfficiencyPct.toFixed(1)}%</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; color: #6b7280;">Cache savings</td>
        <td style="padding: 4px 0; text-align: right; font-weight: 600;">${formatUsd(report.cacheSavingsUsd)}</td>
      </tr>
    </table>

    <h3 style="margin-bottom: 8px; font-size: 14px; text-transform: uppercase; color: #6b7280;">By project</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px;">
      ${projectRows || `<tr><td style="padding:4px 0;color:#6b7280;">No project activity.</td></tr>`}
    </table>

    <h3 style="margin-bottom: 8px; font-size: 14px; text-transform: uppercase; color: #6b7280;">By model</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${modelRows || `<tr><td style="padding:4px 0;color:#6b7280;">No model activity.</td></tr>`}
    </table>
  </div>`;
}

export async function sendDailyReportEmail(settings: EmailSettings, report: DailyReport): Promise<void> {
  if (!settings.smtpUser || !settings.smtpAppPassword || !settings.recipientEmail) {
    throw new Error("Email settings are incomplete");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.smtpUser, pass: settings.smtpAppPassword },
  });

  await transporter.sendMail({
    from: settings.smtpUser,
    to: settings.recipientEmail,
    subject: `Claude Usage — Daily Report (${report.date})`,
    html: renderReportHtml(report),
  });
}
