import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { createAccessControl } from "better-auth/plugins/access";
import { admin } from "better-auth/plugins/admin";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { username } from "better-auth/plugins/username";
import { AuditAction } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { ACCOUNT_LOCKED } from "@/lib/auth-messages";
import { getDb } from "@/server/db/client";
import { withCommandTx, type Tx } from "@/server/db/tx";
import { getEnv } from "@/server/env";
import { isLocked, recordFailure, resetFailures } from "./lockout";
import { accounts, rateLimits, sessions, users, verifications } from "./schema";
import { sessionTiming } from "./session-config";
import { SIGN_IN_MAX, SIGN_IN_WINDOW_SECONDS } from "./sign-in-limit";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  type StaffRole,
} from "./staff-rules";

export { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN };

/**
 * Better Auth's access control for the admin() plugin. Admins get the default
 * user and session permissions except impersonation (AD-9). The Role × action
 * map for the app itself lives elsewhere (Story 2.4).
 */
const ac = createAccessControl(defaultStatements);
const roles: Record<StaffRole, ReturnType<typeof ac.newRole>> = {
  admin: ac.newRole({
    user: ["create", "list", "set-role", "ban", "delete", "set-password", "set-email", "get", "update"],
    session: ["list", "revoke", "delete"],
  }),
  triage_nurse: ac.newRole({ user: [], session: [] }),
  facility_staff: ac.newRole({ user: [], session: [] }),
};
export type { StaffRole };

/** The sign-out hook looks up who is signing out before the session is deleted. */
const SIGN_OUT_ACTOR = "opdSignOutActor";

const USER_AGENT_MAX = 256;

/**
 * Where a sign-in attempt came from, for breach investigation and the per-IP
 * sign-in limit. Uses the RIGHTMOST `x-forwarded-for` entry: the hop the
 * trusted reverse proxy appended (leftmost entries are client-supplied and
 * spoofable). Then `x-real-ip`, else null.
 */
export function requestContext(headers: Headers | undefined | null): {
  ip: string | null;
  userAgent: string | null;
} {
  const forwarded = headers
    ?.get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  const realIp = headers?.get("x-real-ip")?.trim();
  const userAgent = headers?.get("user-agent");
  return {
    ip: forwarded || realIp || null,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
  };
}

function writeAuthAudit(
  actor: Actor,
  action: AuditAction,
  entityId: string | null,
  changes?: Record<string, unknown>,
  alsoInTx?: (tx: Tx) => void,
) {
  withCommandTx(actor, action, (tx, audit) => {
    alsoInTx?.(tx);
    audit({ entity: "user", entityId, changes: changes ?? null });
  });
}

/** Only the attempted username is kept for a failed sign-in, never the password. */
export function attemptedUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().slice(0, USERNAME_MAX);
}

/**
 * Audit a failed sign-in: the attempted username and request context only.
 * Used by the Better Auth hook and by the sign-in action when the input is
 * rejected before it reaches Better Auth.
 */
export function auditFailedSignIn(
  username: unknown,
  headers: Headers | undefined | null,
  reason?: SignInFailureReason,
) {
  writeAuthAudit({ type: "staff", id: null, name: null }, AuditAction.AuthSignInFailed, null, {
    username: attemptedUsername(username),
    ...requestContext(headers),
    ...(reason ? { reason } : {}),
  });
}

/** Why a sign-in failed, when it is not simply wrong credentials. */
export type SignInFailureReason = "locked" | "rate_limited";

/** The Better Auth error code for a sign-in refused because the account is locked. */
export const LOCKED_ERROR_CODE = "LOCKED";

/**
 * A failed password check: audit it and count it towards the lockout in one
 * transaction. The 5th consecutive failure also writes `auth.locked`.
 */
function recordFailedSignIn(username: unknown, headers: Headers | undefined | null) {
  const attempted = attemptedUsername(username);
  const context = requestContext(headers);
  writeAuthAudit(
    { type: "staff", id: null, name: null },
    AuditAction.AuthSignInFailed,
    null,
    { username: attempted, ...context },
    (tx) => {
      if (attempted) recordFailure(tx, attempted, context);
    },
  );
}

function createAuth() {
  const env = getEnv();
  const timing = sessionTiming();
  return betterAuth({
    appName: "OPD",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      usePlural: true,
      schema: { users, sessions, accounts, verifications, rateLimits },
    }),
    // 15-minute idle timeout (AD-9): a session lasts `expiresIn` from its last
    // refresh, and a read refreshes it at most every `updateAge`. No
    // cookieCache, so every read checks the database. Polling reads pass
    // `disableRefresh` and never extend a session.
    session: {
      expiresIn: timing.expiresIn,
      updateAge: timing.updateAge,
    },
    // Per-IP limit on the HTTP sign-in route. The sign-in server action calls
    // the API directly (no HTTP limiter), so it enforces the same rule itself.
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      customRules: {
        "/sign-in/username": { window: SIGN_IN_WINDOW_SECONDS, max: SIGN_IN_MAX },
      },
    },
    // Email/password is only the credential store behind username sign-in.
    // There is no public sign-up: accounts come from create-admin and Admins.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
    },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
      "/request-password-reset",
      "/reset-password",
    ],
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
    telemetry: { enabled: false },
    plugins: [
      username({
        minUsernameLength: USERNAME_MIN,
        maxUsernameLength: USERNAME_MAX,
        // Usernames are stored lowercase (the default normalizer); sign-in
        // accepts any case, so validate the lowercased form.
        usernameValidator: (value) => USERNAME_PATTERN.test(value.toLowerCase()),
      }),
      admin({
        ac,
        roles,
        adminRoles: ["admin"],
        defaultRole: "facility_staff",
        allowImpersonatingAdmins: false,
      }),
      // Must stay last: it copies Set-Cookie headers into Next's cookies().
      nextCookies(),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/username") {
          // Refuse a locked account before the password is checked, so a
          // locked account can't be probed and the right password doesn't help.
          const username = (ctx.body as { username?: unknown } | undefined)?.username;
          const attempted = attemptedUsername(username);
          if (attempted && isLocked(attempted)) {
            auditFailedSignIn(attempted, ctx.headers ?? ctx.request?.headers, "locked");
            throw APIError.from("FORBIDDEN", { code: LOCKED_ERROR_CODE, message: ACCOUNT_LOCKED });
          }
          return;
        }
        if (ctx.path !== "/sign-out") return;
        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (!token) return;
        const current = await ctx.context.internalAdapter.findSession(token);
        if (!current) return;
        return {
          context: {
            [SIGN_OUT_ACTOR]: { id: current.user.id, name: current.user.name },
          },
        };
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const failed = isAPIError(returned) || returned instanceof Error;

        if (ctx.path === "/sign-in/username") {
          const headers = ctx.headers ?? ctx.request?.headers;
          if (failed) {
            recordFailedSignIn((ctx.body as { username?: unknown } | undefined)?.username, headers);
            return;
          }
          const user = ctx.context.newSession?.user;
          if (user) {
            writeAuthAudit(
              { type: "staff", id: user.id, name: user.name },
              AuditAction.AuthSignIn,
              user.id,
              requestContext(headers),
              (tx) => resetFailures(tx, user.id),
            );
          }
          return;
        }

        if (ctx.path === "/sign-out" && !failed) {
          const actor = (ctx as unknown as Record<string, { id: string; name: string } | undefined>)[
            SIGN_OUT_ACTOR
          ];
          if (actor) {
            writeAuthAudit({ type: "staff", id: actor.id, name: actor.name }, AuditAction.AuthSignOut, actor.id);
          }
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __opdAuth?: Auth };

/** The Better Auth instance, created on first use (never at build time). */
export function getAuth(): Auth {
  globalForAuth.__opdAuth ??= createAuth();
  return globalForAuth.__opdAuth;
}
