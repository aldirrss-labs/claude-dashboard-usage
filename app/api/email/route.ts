import { NextRequest, NextResponse } from "next/server";
import { getEmailSettings, setEmailSettings } from "@/lib/queries";

export async function GET() {
  const settings = getEmailSettings();
  return NextResponse.json({ ...settings, smtpAppPassword: settings.smtpAppPassword ? "••••••••" : null });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const existing = getEmailSettings();

  setEmailSettings({
    smtpUser: typeof body.smtpUser === "string" ? body.smtpUser : existing.smtpUser,
    smtpAppPassword:
      typeof body.smtpAppPassword === "string" && body.smtpAppPassword !== "••••••••"
        ? body.smtpAppPassword
        : existing.smtpAppPassword,
    recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : existing.recipientEmail,
    enabled: Boolean(body.enabled),
  });

  const saved = getEmailSettings();
  return NextResponse.json({ ...saved, smtpAppPassword: saved.smtpAppPassword ? "••••••••" : null });
}
