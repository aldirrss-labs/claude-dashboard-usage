"use client";

import { useCallback, useSyncExternalStore } from "react";

// Subscribers in this tab. The `storage` event only fires in *other* tabs, so
// a local write has to notify them explicitly.
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * A boolean that survives a page reload and stays in sync across tabs.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: this page is
 * prerendered, so reading localStorage during render would make the server and
 * client HTML disagree. The server snapshot is always the fallback, and React
 * swaps in the stored value after hydration — no mismatch, and no setState in
 * an effect.
 */
export function usePersistentToggle(
  key: string,
  fallback = false
): [boolean, (next: boolean) => void] {
  const getSnapshot = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === "1";
    } catch {
      // Private mode / storage blocked — fall back rather than crash the page.
      return fallback;
    }
  }, [key, fallback]);

  const getServerSnapshot = useCallback((): boolean => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: boolean): void => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Unwritable storage: the toggle still flips for this render pass via
        // emit(), it just will not survive a reload.
      }
      emit();
    },
    [key]
  );

  return [value, setValue];
}
