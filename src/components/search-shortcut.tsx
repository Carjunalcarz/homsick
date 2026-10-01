"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isSearchShortcut, searchShortcutTargets } from "@/lib/keyboard-shortcuts";

/** An input that is on the page and shown (the header search is hidden below lg). */
function visibleInput(id: string): HTMLInputElement | null {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement) || element.disabled) return null;
  return element.getClientRects().length > 0 ? element : null;
}

/**
 * Ctrl+K (⌘K on a Mac) focuses the Patient finder on /triage and the header
 * search everywhere else. When neither is shown (the header search is in the
 * menu sheet below lg), the browser keeps the key.
 */
export function SearchShortcut() {
  const pathname = usePathname();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !isSearchShortcut(event)) return;
      for (const id of searchShortcutTargets(pathname)) {
        const input = visibleInput(id);
        if (!input) continue;
        event.preventDefault();
        input.focus();
        input.select();
        return;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pathname]);

  return null;
}
