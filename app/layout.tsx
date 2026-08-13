import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { startIngestScheduler } from "@/lib/ingest-scheduler";
import { Sidebar } from "@/components/Sidebar";
import { PageTransition } from "@/components/PageTransition";
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full">
        <Sidebar />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <PageTransition>{children}</PageTransition>
        </div>
      </body>
    </html>
  );
}
