"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { SignInFields } from "@/components/sign-in-fields";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  formatCountdown,
  formatDuration,
  keepAliveMoved,
  nextGuardState,
  POLL_INTERVAL_MS,
  shouldAnnounce,
  type GuardPhase,
  type SessionStatus,
} from "@/lib/session-guard";
import { keepAliveAction, reauthAction, signOutAction, type ReauthState } from "@/server/auth/actions";

type Props = {
  /** The signed-in user; a different user signing in gets a fresh page. */
  userId: string;
  userName: string;
  /** The idle session length in seconds (900 in production). */
  sessionSeconds: number;
  /** Seconds before expiry that the warning opens (60 in production). */
  warnSeconds: number;
  /** Activity refreshes the session at most this often (60 in production). */
  keepAliveSeconds: number;
};

const TICK_MS = 1000;

/** The staff shell the guard hides while signed out (set in the staff layout). */
export const SESSION_SHELL_ATTR = "data-session-shell";

const NETWORK_ERROR = "Couldn't reach the server. Try again.";

/**
 * The 15-minute idle timeout on the client (Story 2.3, UX-DR10).
 *
 * - Real activity (keys, pointer, wheel, scrolling, the tab becoming
 *   visible) refreshes the session through keepAliveAction, at most once per
 *   `keepAliveSeconds`. Polling and timers never count as activity.
 * - `/api/auth-status` is polled every 30 s without refreshing the session.
 * - `warnSeconds` before expiry a warning dialog offers **Stay signed in**.
 * - On expiry a sign-in dialog opens over the page, which stays mounted but
 *   hidden (opaque overlay, inert). The same user keeps the page as it was;
 *   a different user gets a fresh page.
 */
export function SessionGuard({ userId, userName, sessionSeconds, warnSeconds, keepAliveSeconds }: Props) {
  const [phase, setPhase] = useState<GuardPhase>("active");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [staying, setStaying] = useState(false);
  const [stayError, setStayError] = useState<string | null>(null);

  /** Server expiry in server-clock ms, and server minus client clock. */
  const expiresAtRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const lastActivityRef = useRef(0);
  /** The last keep-alive that actually moved the expiry. */
  const lastKeepAliveRef = useRef(0);
  /** The last keep-alive attempt, whatever its outcome. */
  const lastAttemptRef = useRef(0);
  const keepAliveInFlightRef = useRef<Promise<boolean> | null>(null);
  const pollInFlightRef = useRef<Promise<void> | null>(null);
  const phaseRef = useRef<GuardPhase>("active");
  const expiredRef = useRef(false);
  /**
   * Whose page this is. Fixed at mount: after someone else signs in through
   * the dialog, the refreshed layout passes their id as `userId` before the
   * reload, and comparing against that would keep the old user's page.
   */
  const pageUserIdRef = useRef(userId);

  const markExpired = useCallback(() => {
    expiredRef.current = true;
    phaseRef.current = "expired";
    setExpired(true);
    setPhase("expired");
  }, []);

  /** Recompute the phase from the known expiry. */
  const recompute = useCallback((): ReturnType<typeof nextGuardState> | null => {
    const expiresAt = expiresAtRef.current;
    if (expiresAt === null || expiredRef.current) return null;
    const offset = offsetRef.current;
    const state = nextGuardState(
      Date.now() + offset,
      expiresAt,
      lastActivityRef.current + offset,
      lastKeepAliveRef.current + offset,
      {
        warnSeconds,
        keepAliveIntervalMs: keepAliveSeconds * 1000,
        sessionSeconds,
        lastAttempt: lastAttemptRef.current + offset,
      },
    );
    const previous = phaseRef.current;
    phaseRef.current = state.phase;
    setPhase(state.phase);
    setSecondsLeft(state.secondsLeft);
    if (state.phase === "warning") {
      if (previous !== "warning" || shouldAnnounce(state.secondsLeft, warnSeconds)) {
        setAnnouncement(`${state.secondsLeft} seconds until you are signed out.`);
      }
    } else if (previous === "warning") {
      setAnnouncement("");
      setStayError(null);
    }
    return state;
  }, [keepAliveSeconds, sessionSeconds, warnSeconds]);

  const applySession = useCallback(
    (signedIn: boolean, sessionUserId: string | null, expiresAt: string | null) => {
      if (!signedIn || !expiresAt) {
        markExpired();
        return;
      }
      if (sessionUserId !== pageUserIdRef.current) {
        // Someone else signed in (another tab): this page belongs to the old user.
        window.location.reload();
        return;
      }
      expiresAtRef.current = Date.parse(expiresAt);
      const state = recompute();
      if (state?.phase === "expired" && !expiredRef.current) markExpired();
    },
    [markExpired, recompute],
  );

  /** Read the session without extending it. */
  const poll = useCallback((): Promise<void> => {
    if (expiredRef.current) return Promise.resolve();
    // One request at a time; callers share the one in flight.
    pollInFlightRef.current ??= (async () => {
      try {
        const response = await fetch("/api/auth-status", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const status = (await response.json()) as SessionStatus;
        offsetRef.current = Date.parse(status.now) - Date.now();
        applySession(status.signedIn, status.userId, status.expiresAt);
      } catch {
        // Offline or the server is restarting: try again on the next poll.
      } finally {
        pollInFlightRef.current = null;
      }
    })();
    return pollInFlightRef.current;
  }, [applySession]);

  /**
   * Refresh the session (real activity or Stay signed in). Resolves false
   * when the server couldn't be reached. Callers share the one in flight.
   */
  const keepAlive = useCallback((): Promise<boolean> => {
    if (expiredRef.current) return Promise.resolve(true);
    keepAliveInFlightRef.current ??= (async () => {
      const attemptedAt = Date.now();
      lastAttemptRef.current = attemptedAt;
      const before = expiresAtRef.current;
      try {
        const result = await keepAliveAction();
        if (!result.signedIn) {
          applySession(false, null, null);
          return true;
        }
        // A keep-alive on a session younger than updateAge changes nothing:
        // leave the activity pending so a later tick tries again.
        if (keepAliveMoved(before, Date.parse(result.expiresAt))) lastKeepAliveRef.current = attemptedAt;
        applySession(true, result.userId, result.expiresAt);
        return true;
      } catch {
        return false;
      } finally {
        keepAliveInFlightRef.current = null;
      }
    })();
    return keepAliveInFlightRef.current;
  }, [applySession]);

  // The clock: recompute every second, keep alive when due, and confirm with
  // the server when the warning opens or the session looks expired.
  useEffect(() => {
    const tick = () => {
      if (expiredRef.current) return;
      const before = phaseRef.current;
      const state = recompute();
      if (!state) return;
      if (state.shouldKeepAlive) void keepAlive();
      if (state.phase === before) return;
      if (state.phase === "warning") void poll();
      if (state.phase === "expired") {
        // Confirm first: another tab may have extended the session. If the
        // server can't be reached, the expiry time still stands.
        void poll().then(() => {
          if (phaseRef.current === "expired" && !expiredRef.current) markExpired();
        });
      }
    };
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [keepAlive, markExpired, poll, recompute]);

  // The poll: every 30 s, plus once on mount and whenever the tab shows again.
  useEffect(() => {
    lastKeepAliveRef.current = Date.now();
    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  // Real activity only. Ignored during the warning (only Stay signed in
  // extends the session then) and after expiry.
  useEffect(() => {
    const onActivity = () => {
      if (phaseRef.current === "active" && !expiredRef.current) lastActivityRef.current = Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      onActivity();
      void poll();
    };
    const options = { capture: true, passive: true } as const;
    const events = ["keydown", "pointerdown", "wheel", "scroll"] as const;
    for (const type of events) window.addEventListener(type, onActivity, options);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const type of events) window.removeEventListener(type, onActivity, options);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // While signed out, the page stays mounted (to keep its state for the same
  // user) but is hidden from everyone: inert and aria-hidden, behind an
  // opaque overlay, so patient data can't be read or reached.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(`[${SESSION_SHELL_ATTR}]`);
    if (!shell || !expired) return;
    shell.inert = true;
    shell.setAttribute("aria-hidden", "true");
    return () => {
      shell.inert = false;
      shell.removeAttribute("aria-hidden");
    };
  }, [expired]);

  const stayRef = useRef<HTMLButtonElement>(null);

  const stay = useCallback(async () => {
    setStaying(true);
    setStayError(null);
    try {
      // If an activity keep-alive is already running, this waits for it.
      const reached = await keepAlive();
      if (!reached) setStayError(NETWORK_ERROR);
    } finally {
      setStaying(false);
    }
  }, [keepAlive]);

  const onSignedInAgain = useCallback(
    (signedInUserId: string) => {
      if (signedInUserId !== pageUserIdRef.current) {
        window.location.reload();
        return;
      }
      // Forget the old session's expiry so no tick judges the new session by it.
      expiresAtRef.current = null;
      expiredRef.current = false;
      phaseRef.current = "active";
      lastActivityRef.current = 0;
      lastKeepAliveRef.current = Date.now();
      setExpired(false);
      setPhase("active");
      setSecondsLeft(null);
      setAnnouncement("");
      void poll();
    },
    [poll],
  );

  const remaining = secondsLeft ?? warnSeconds;

  return (
    <>
      <AlertDialog open={phase === "warning" && !expired}>
        <AlertDialogContent
          onEscapeKeyDown={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            stayRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>You&apos;ll be signed out in {formatDuration(remaining)}.</AlertDialogTitle>
            <AlertDialogDescription>
              {userName}, you have been inactive. Choose Stay signed in to keep working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="queue-number text-center tabular-nums" aria-hidden="true">
            {formatCountdown(remaining)}
          </p>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {stayError ?? announcement}
          </p>
          {stayError && (
            <p className="text-center text-sm font-medium text-destructive" aria-hidden="true">
              {stayError}
            </p>
          )}
          <AlertDialogFooter>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="h-11 w-full sm:w-auto">
                Sign out
              </Button>
            </form>
            <Button
              ref={stayRef}
              type="button"
              className="h-11 font-bold uppercase"
              aria-busy={staying || undefined}
              onClick={() => void stay()}
            >
              Stay signed in
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={expired}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-background supports-backdrop-filter:backdrop-blur-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Signed out after {formatDuration(sessionSeconds)} of inactivity.</DialogTitle>
            <DialogDescription>Sign in to continue.</DialogDescription>
          </DialogHeader>
          <ReauthForm onSignedIn={onSignedInAgain} />
        </DialogContent>
      </Dialog>
    </>
  );
}

const reauthInitial: ReauthState = { error: null, username: "", userId: null };

function ReauthForm({ onSignedIn }: { onSignedIn: (userId: string) => void }) {
  const [state, formAction, pending] = useActionState(reauthAction, reauthInitial);

  useEffect(() => {
    if (state.userId) onSignedIn(state.userId);
  }, [state, onSignedIn]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <SignInFields state={state} pending={pending} idPrefix="reauth-" />
    </form>
  );
}
