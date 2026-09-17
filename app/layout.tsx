import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { PageTransition } from "@/components/PageTransition";
import "./globals.css";

// The scheduler now starts from instrumentation.ts, which runs at server boot.
// Starting it here meant it waited for the first request to a dynamic route.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Rooms",
  description: "Usage, projects, MCP servers and accounts for Claude Code on this machine",
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
