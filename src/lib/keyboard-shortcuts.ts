// Ctrl+K (UX-DR21): the Patient finder on /triage, the header search elsewhere.

export const PATIENT_FINDER_INPUT_ID = "patient-finder-input";
export const HEADER_SEARCH_ID = "header-search";

/** Whether a key event is Ctrl+K (or ⌘K on a Mac). */
export function isSearchShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">) {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

/** The ids of the inputs Ctrl+K tries on `pathname`, first choice first. */
export function searchShortcutTargets(pathname: string): string[] {
  const onTriage = pathname === "/triage" || pathname.startsWith("/triage/");
  return onTriage ? [PATIENT_FINDER_INPUT_ID, HEADER_SEARCH_ID] : [HEADER_SEARCH_ID];
}
