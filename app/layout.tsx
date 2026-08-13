import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { startIngestScheduler } from "@/lib/ingest-scheduler";
import "./globals.css";

startIngestScheduler();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Code Usage Dashboard",
  description: "Track Claude Code token usage across all local projects",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
