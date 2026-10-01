import "server-only";
import { lt } from "drizzle-orm";
import type { Tx } from "@/server/db/tx";
import { rateLimits } from "./schema";

/**
 * How old a `rate_limits` row must be before cleanup removes it. Every window
 * that uses the table (Better Auth's rateLimit rules and the sign-in action's
 * SIGN_IN_WINDOW_SECONDS) is far shorter, so a removed row no longer limits
 * anything.
 */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Delete the `rate_limits` rows whose `last_request` (integer ms) is before
 * `before`, inside the caller's command transaction. Returns how many went.
 * `auth` owns the table, so the rate-limit cleanup job calls this.
 */
export function purgeRateLimits(tx: Tx, before: number): number {
  return tx.delete(rateLimits).where(lt(rateLimits.lastRequest, before)).run().changes;
}
