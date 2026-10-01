// Pure state logic for the data-table toolbar, kept apart from React so it
// can be unit tested.

/** How many of the toolbar's own recent searches are remembered. */
export const RECENT_PUSH_LIMIT = 5;

/** What the URL says: the search text and each select filter's value. */
export type ToolbarUrlValues = {
  q: string;
  filters: Readonly<Record<string, string>>;
};

/** What the toolbar shows. */
export type ToolbarState = {
  /** The search box text, possibly still being typed. */
  q: string;
  filters: Readonly<Record<string, string>>;
  /**
   * The search text the URL is known to hold or about to hold: the last one
   * received from the URL or pushed to it. When the box differs from it
   * (after trimming), the debounced search pushes the box's text.
   */
  syncedQ: string;
  /**
   * The toolbar's own recently pushed searches, newest last. Their URLs can
   * land out of order, so each one counts as an own push, not an outside
   * change.
   */
  recentPushes: readonly string[];
};

export function initialToolbarState(url: ToolbarUrlValues): ToolbarState {
  return { q: url.q, filters: { ...url.filters }, syncedQ: url.q, recentPushes: [] };
}

export function sameUrlValues(a: ToolbarUrlValues, b: ToolbarUrlValues) {
  if (a.q !== b.q) return false;
  const keys = new Set([...Object.keys(a.filters), ...Object.keys(b.filters)]);
  for (const key of keys) if (a.filters[key] !== b.filters[key]) return false;
  return true;
}

/** The state after the toolbar itself pushes `text` as the URL's search. */
export function recordPush(state: ToolbarState, text: string): ToolbarState {
  return {
    ...state,
    syncedQ: text,
    recentPushes: [...state.recentPushes, text].slice(-RECENT_PUSH_LIMIT),
  };
}

/**
 * The toolbar state after the URL changed. Selects always follow the URL.
 * The search box follows it too, unless the new search is one the toolbar
 * itself pushed recently: then the box keeps its text, so a debounced push
 * landing mid-typing (even an older one landing late) never overwrites what
 * is being typed. A genuine outside change forgets the recent pushes.
 */
export function syncToolbarState(state: ToolbarState, url: ToolbarUrlValues): ToolbarState {
  const ownPush = url.q === state.syncedQ || state.recentPushes.includes(url.q);
  if (ownPush) return { ...state, filters: { ...url.filters } };
  return { q: url.q, filters: { ...url.filters }, syncedQ: url.q, recentPushes: [] };
}

/** The search text the debounced search should push, or null if none. */
export function pendingSearch(state: ToolbarState): string | null {
  const trimmed = state.q.trim();
  return trimmed === state.syncedQ ? null : trimmed;
}
