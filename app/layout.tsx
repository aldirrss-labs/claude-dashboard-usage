import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
      <body className="min-h-full flex flex-col">
        <nav className="border-b border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-8 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Claude Usage
            </Link>
            <Link href="/projects" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              Projects
            </Link>
            <Link href="/settings" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              Settings
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
