/**
 * The idle-timeout guard's timing rules (Story 2.3, UX-DR10), kept pure so
 * they can be tested at the boundaries. All times are epoch milliseconds.
 */

/** What `/api/auth-status` answers. `now` is the server clock, for skew. */
export type SessionStatus =
  | { signedIn: true; userId: string; expiresAt: string; now: string }
  | { signedIn: false; userId: null; expiresAt: null; now: string };

/** Real activity refreshes the session at most this often. */
export const KEEP_ALIVE_INTERVAL_MS = 60_000;

/** How often the guard asks the server for the session's expiry. */
export const POLL_INTERVAL_MS = 30_000;

export type GuardPhase = "active" | "warning" | "expired";

export type GuardState = {
  phase: GuardPhase;
  /** Whole seconds until expiry, never below 0. */
  secondsLeft: number;
  /** Call keepAliveAction now: there was real activity since the last one. */
  shouldKeepAlive: boolean;
};

export type GuardOptions = {
  /** Seconds before expiry that the warning opens (default 60). */
  warnSeconds?: number;
  /** Better Auth `updateAge`: a read refreshes the session only once it is this old. */
  keepAliveIntervalMs?: number;
  /**
   * The session lifetime. When given, a keep-alive waits until the session
   * itself (last refreshed at `expiresAt - sessionSeconds`) is old enough to
   * be refreshed, instead of trusting the client's own clock of refreshes.
   */
  sessionSeconds?: number;
  /** When the last keep-alive was attempted, whatever its outcome. */
  lastAttempt?: number;
  /** Minimum spacing between attempts, so a no-op keep-alive isn't hammered. */
  retryMs?: number;
};

/**
 * Where the guard stands at `now`:
 * - `expired` once `expiresAt` is reached (0 s left);
 * - `warning` from `warnSeconds` left (60 s by default; 61 s is still active);
 * - otherwise `active`.
 *
 * While active, activity newer than the last successful keep-alive asks for
 * another keep-alive, but at most once per interval, and (with
 * `sessionSeconds`) not before the session is old enough to be refreshed.
 * During the warning, only **Stay signed in** extends the session, so
 * activity asks for nothing.
 *
 * `lastKeepAlive` is the last keep-alive that actually moved `expiresAt`
 * (see `keepAliveMoved`): a no-op one leaves the activity pending.
 */
export function nextGuardState(
  now: number,
  expiresAt: number,
  lastActivity: number,
  lastKeepAlive: number,
  {
    warnSeconds = 60,
    keepAliveIntervalMs = KEEP_ALIVE_INTERVAL_MS,
    sessionSeconds,
    lastAttempt = 0,
    retryMs = 5000,
  }: GuardOptions = {},
): GuardState {
  const secondsLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (secondsLeft <= 0) return { phase: "expired", secondsLeft: 0, shouldKeepAlive: false };
  if (secondsLeft <= warnSeconds) return { phase: "warning", secondsLeft, shouldKeepAlive: false };
  const refreshableAt =
    sessionSeconds === undefined ? Number.NEGATIVE_INFINITY : expiresAt - sessionSeconds * 1000 + keepAliveIntervalMs;
  const shouldKeepAlive =
    lastActivity > lastKeepAlive &&
    now - lastKeepAlive >= keepAliveIntervalMs &&
    now >= refreshableAt &&
    now - lastAttempt >= retryMs;
  return { phase: "active", secondsLeft, shouldKeepAlive };
}

/** Whether a keep-alive really refreshed the session (its expiry moved later). */
export function keepAliveMoved(previousExpiresAt: number | null, returnedExpiresAt: number): boolean {
  return previousExpiresAt === null || returnedExpiresAt > previousExpiresAt;
}

/** "15 minutes", "1 minute", "90 seconds", "1 second". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds >= 60 && totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${totalSeconds} ${totalSeconds === 1 ? "second" : "seconds"}`;
}

/**
 * Whether a countdown value is announced to screen readers. Announcing every
 * second would drown out everything else, so the live region speaks at these
 * points only.
 */
export function shouldAnnounce(secondsLeft: number, warnSeconds = 60): boolean {
  return secondsLeft === warnSeconds || [30, 15, 10, 5].includes(secondsLeft);
}

/** "0:42" */
export function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, secondsLeft);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
