import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { rateLimits } from "./schema";
import { normalizeUsername } from "./staff-rules";

/**
 * Sign-in rate limit for the server-action path, which calls Better Auth's
 * API directly and so skips its HTTP rate limiter. At most SIGN_IN_MAX failed
 * attempts per SIGN_IN_WINDOW_SECONDS, counted from the last failure (Better
 * Auth's window semantics), in the `rate_limits` table. Successful sign-ins
 * are not counted.
 *
 * Keyed on the client IP (see `requestContext`). Without an IP, the key is
 * the attempted username, so one unknown client can't block everyone.
 */
export const SIGN_IN_WINDOW_SECONDS = 60;
export const SIGN_IN_MAX = 10;
export const SIGN_IN_KEY_PREFIX = "action:sign-in:";

export function signInLimitKey(ip: string | null, username: unknown): string {
  if (ip) return `${SIGN_IN_KEY_PREFIX}${ip}`;
  const name = typeof username === "string" ? normalizeUsername(username).slice(0, 64) : "";
  return `${SIGN_IN_KEY_PREFIX}user:${name}`;
}

/** Whether this key has already used up its failures in the current window. */
export function isSignInLimited(key: string, now: number = Date.now(), db: Db = getDb()): boolean {
  const row = db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
  if (!row) return false;
  return now - row.lastRequest < SIGN_IN_WINDOW_SECONDS * 1000 && row.count >= SIGN_IN_MAX;
}

/**
 * Count one failed attempt for this key, in its own small IMMEDIATE
 * transaction. It is bookkeeping, not an audited command.
 */
export function recordSignInFailure(key: string, now: number = Date.now(), db: Db = getDb()): void {
  const windowMs = SIGN_IN_WINDOW_SECONDS * 1000;
  db.transaction(
    (tx) => {
      const row = tx.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
      if (!row) {
        tx.insert(rateLimits).values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now }).run();
        return;
      }
      const count = now - row.lastRequest >= windowMs ? 1 : row.count + 1;
      tx.update(rateLimits).set({ count, lastRequest: now }).where(eq(rateLimits.id, row.id)).run();
    },
    { behavior: "immediate" },
  );
}
