"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { usePersistentToggle } from "@/lib/use-persistent-toggle";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: GaugeIcon },
  { href: "/projects", label: "Projects", icon: StackIcon },
  { href: "/accounts", label: "Accounts", icon: SwapIcon },
  { href: "/settings", label: "Settings", icon: SlidersIcon },
];

// Same key and same "1"/"0" encoding the old inline implementation used, so an
// existing collapsed preference carries over.
const STORAGE_KEY = "claude-dashboard:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  // Was a useState + useEffect pair that read localStorage after mount, which
  // set state inside an effect and tripped react-hooks/set-state-in-effect.
  const [collapsed, setCollapsed] = usePersistentToggle(STORAGE_KEY);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="relative flex h-screen flex-shrink-0 flex-col overflow-hidden"
      style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
    >
      <div
        className="flex h-14 flex-shrink-0 items-center gap-2.5 px-4"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <div
          className="font-data flex h-7 w-7 flex-shrink-0 items-center justify-center text-xs font-bold"
          style={{ background: "var(--accent-500)", color: "#0a0a0b" }}
        >
          C
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="font-data whitespace-nowrap text-xs font-semibold"
              style={{ color: "var(--text-primary)", letterSpacing: "0.14em" }}
            >
              CLAUDE/USAGE
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <nav className="flex flex-1 flex-col pt-2">
        {NAV_ITEMS.map((item, index) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex items-center gap-3 px-4 py-2.5 transition-colors"
              style={{ color: active ? "var(--sidebar-text-active)" : "var(--sidebar-text)" }}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0"
                  style={{ background: "var(--sidebar-active-bg)" }}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {active && (
                <motion.div
                  layoutId="sidebar-active-bar"
                  className="absolute left-0 top-0 bottom-0 w-[3px]"
                  style={{ background: "var(--accent-500)" }}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <item.icon className="relative z-10 h-4 w-4 flex-shrink-0" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="font-data relative z-10 flex flex-1 items-baseline justify-between whitespace-nowrap text-xs"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    <span>{item.label.toUpperCase()}</span>
                    <span
                      className="index-mono text-[10px]"
                      style={{ color: active ? "var(--accent-500)" : "var(--line-strong)" }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="label-mono flex flex-shrink-0 items-center gap-3 px-4 py-3 transition-colors"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        <ChevronIcon className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        <AnimatePresence>
          {!collapsed && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              Collapse
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.aside>
  );
}

function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3a9 9 0 1 0 9 9M12 3v3m9 6h-3M12 12l4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 6h9m4 0h3M4 12h13m4 0h-1M4 18h5m4 0h11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="15" cy="6" r="2" fill="var(--sidebar-bg)" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="19" cy="12" r="2" fill="var(--sidebar-bg)" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="11" cy="18" r="2" fill="var(--sidebar-bg)" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SwapIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
