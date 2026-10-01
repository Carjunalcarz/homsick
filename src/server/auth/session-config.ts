import "server-only";

/**
 * Idle-session timing (Story 2.3, AD-9, UX-DR10). A session lasts 15 minutes
 * from the last refresh, is refreshed at most once a minute, and the client
 * warns 60 seconds before it ends.
 *
 * Outside production only, `OPD_SESSION_SECONDS` can shorten the session and
 * `OPD_WARN_SECONDS` can change the warning lead time, for manual testing.
 * Both are ignored in production.
 */
export const SESSION_SECONDS = 900;
export const UPDATE_AGE_SECONDS = 60;
export const WARN_SECONDS = 60;

export type SessionTiming = {
  /** Session lifetime from its last refresh (Better Auth `expiresIn`). */
  expiresIn: number;
  /**
   * Minimum age before a read refreshes the session (Better Auth `updateAge`).
   * The client keeps alive at most this often.
   */
  updateAge: number;
  /** How long before expiry the client shows the warning dialog. */
  warnSeconds: number;
};

const warned = new Set<string>();

/** A positive integer override, or null. Warns once about an invalid value. */
function positiveInt(name: string, value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`${name} must be a positive whole number of seconds; ignoring "${value}".`);
  }
  return null;
}

export function sessionTiming(source: Record<string, string | undefined> = process.env): SessionTiming {
  if (source.NODE_ENV === "production") {
    return { expiresIn: SESSION_SECONDS, updateAge: UPDATE_AGE_SECONDS, warnSeconds: WARN_SECONDS };
  }
  // Only ever shorter than the real rule, and long enough to be usable.
  const override = positiveInt("OPD_SESSION_SECONDS", source.OPD_SESSION_SECONDS);
  const expiresIn = override ? Math.min(SESSION_SECONDS, Math.max(30, override)) : SESSION_SECONDS;
  const warnOverride = positiveInt("OPD_WARN_SECONDS", source.OPD_WARN_SECONDS);
  const warnSeconds = Math.min(warnOverride ?? WARN_SECONDS, expiresIn - 10);
  // Activity must be able to refresh the session well before the warning
  // opens, so allow at least two refreshes in the time before it.
  const updateAge = Math.max(1, Math.min(UPDATE_AGE_SECONDS, Math.floor((expiresIn - warnSeconds) / 2)));
  return { expiresIn, updateAge, warnSeconds };
}
