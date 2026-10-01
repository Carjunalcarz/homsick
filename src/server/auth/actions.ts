"use server";
import "server-only";
import { isAPIError } from "better-auth/api";
import { getSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACCOUNT_LOCKED, TOO_MANY_ATTEMPTS, WRONG_CREDENTIALS } from "@/lib/auth-messages";
import { safeNextPath } from "@/lib/safe-next";
import { getDb } from "@/server/db/client";
import { auditFailedSignIn, getAuth, LOCKED_ERROR_CODE, requestContext } from "./auth";
import { sessions, users } from "./schema";
import { isSignInLimited, recordSignInFailure, signInLimitKey } from "./sign-in-limit";
import { isStaffRole, PASSWORD_MAX, USERNAME_MAX } from "./staff-rules";

export type SignInState = {
  error: string | null;
  username: string;
};

/** The re-auth dialog's state: on success, who signed in (to compare users). */
export type ReauthState = SignInState & { userId: string | null };

const signInSchema = z.object({
  username: z.string().trim().min(1).max(USERNAME_MAX),
  password: z.string().min(1).max(PASSWORD_MAX),
  next: z.string().optional(),
});

type Attempt = { ok: true; userId: string; next: string | undefined } | { ok: false; error: string };

/**
 * One sign-in attempt, shared by the sign-in page and the re-auth dialog.
 * Order: per-IP rate limit (before any password check), input validation,
 * then Better Auth, which refuses locked accounts, checks the password, sets
 * the session cookie (nextCookies) and audits from its hooks.
 */
async function attemptSignIn(formData: FormData): Promise<Attempt> {
  const raw = {
    username: formData.get("username"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  };
  const requestHeaders = await headers();

  // Server actions call Better Auth's API directly and skip its HTTP rate
  // limiter, so the limit is enforced here: refuse when already over it,
  // and count only failed attempts.
  const limitKey = signInLimitKey(requestContext(requestHeaders).ip, raw.username);
  if (isSignInLimited(limitKey)) {
    auditFailedSignIn(raw.username, requestHeaders, "rate_limited");
    return { ok: false, error: TOO_MANY_ATTEMPTS };
  }
  const fail = (error: string): Attempt => {
    recordSignInFailure(limitKey);
    return { ok: false, error };
  };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    // Rejected before Better Auth, so its hook won't see it: audit here.
    auditFailedSignIn(raw.username, requestHeaders);
    return fail(WRONG_CREDENTIALS);
  }

  try {
    const { user } = await getAuth().api.signInUsername({
      body: { username: parsed.data.username, password: parsed.data.password },
      headers: requestHeaders,
    });
    return { ok: true, userId: user.id, next: parsed.data.next };
  } catch (error) {
    // Only a locked account gets its own message (UX-DR18). Unknown user,
    // wrong password, bad format: all look the same.
    if (isAPIError(error) && (error.body as { code?: string } | undefined)?.code === LOCKED_ERROR_CODE) {
      return fail(ACCOUNT_LOCKED);
    }
    return fail(WRONG_CREDENTIALS);
  }
}

function typedUsername(formData: FormData): string {
  const value = formData.get("username");
  return typeof value === "string" ? value : "";
}

/** Sign in from the sign-in page, then go to a safe `next`. */
export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const result = await attemptSignIn(formData);
  if (!result.ok) return { error: result.error, username: typedUsername(formData) };
  redirect(safeNextPath(result.next));
}

/**
 * Sign in again from the dialog that opens over the page after idle expiry.
 * No redirect: the client keeps the page when the same user signs back in
 * and reloads it for anyone else.
 */
export async function reauthAction(_prev: ReauthState, formData: FormData): Promise<ReauthState> {
  const result = await attemptSignIn(formData);
  if (!result.ok) return { error: result.error, username: typedUsername(formData), userId: null };
  return { error: null, username: typedUsername(formData), userId: result.userId };
}

/**
 * A side-effect-free check that the request's session exists, is unexpired
 * and belongs to a staff Role. Reads the table directly: Better Auth's
 * getSession, even with `disableRefresh`, deletes the cookie of a missing or
 * expired session, which in a Server Action re-renders the page signed out
 * (a redirect to sign-in that loses the page). The signature is checked by
 * the real getSession that follows.
 */
function hasLiveStaffSession(requestHeaders: Headers): boolean {
  const raw = getSessionCookie(requestHeaders);
  if (!raw) return false;
  let token: string;
  try {
    token = decodeURIComponent(raw).split(".")[0] ?? "";
  } catch {
    return false;
  }
  if (!token) return false;
  const row = getDb()
    .select({ expiresAt: sessions.expiresAt, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, token))
    .get();
  return Boolean(row && row.expiresAt.getTime() > Date.now() && isStaffRole(row.role));
}

export type KeepAliveResult = { signedIn: true; userId: string; expiresAt: string } | { signedIn: false };

/**
 * Real user activity (or **Stay signed in**): a normal session read, which
 * refreshes the session once it is older than `updateAge` and re-sets the
 * cookie. The client calls this at most once per `updateAge`.
 *
 * Checks first without refreshing: when the session is already gone, a
 * refreshing read would delete the cookie inside the action, and the page
 * re-render would redirect to sign-in instead of showing the re-auth dialog.
 */
export async function keepAliveAction(): Promise<KeepAliveResult> {
  const requestHeaders = await headers();
  if (!hasLiveStaffSession(requestHeaders)) return { signedIn: false };
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || !isStaffRole(session.user.role)) return { signedIn: false };
  return {
    signedIn: true,
    userId: session.user.id,
    expiresAt: new Date(session.session.expiresAt).toISOString(),
  };
}

/** Better Auth's cookies, with or without the __Secure- prefix. */
const AUTH_COOKIE = /^(__Secure-)?better-auth[.-]/;

/** Sign out (audited from the Better Auth hooks) and return to the sign-in page. */
export async function signOutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (error) {
    // Never leave a live cookie behind: /sign-in would send the user back in.
    console.error(`Sign-out failed: ${error instanceof Error ? error.message : String(error)}`);
    const jar = await cookies();
    for (const { name } of jar.getAll()) {
      // __Secure- cookies can only be overwritten by a Secure cookie.
      if (AUTH_COOKIE.test(name)) {
        jar.set(name, "", { maxAge: 0, path: "/", secure: name.startsWith("__Secure-") });
      }
    }
  }
  redirect("/sign-in");
}
