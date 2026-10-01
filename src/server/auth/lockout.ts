import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AuditAction } from "@/server/audit/schema";
import { record, type Actor } from "@/server/audit/service";
import { getDb, type Db } from "@/server/db/client";
import { withCommandTx, type Tx } from "@/server/db/tx";
import { users } from "./schema";
import { normalizeUsername } from "./staff-rules";

/**
 * Account lockout (Story 2.3, AD-9): after LOCK_THRESHOLD consecutive failed
 * sign-ins the account locks until an Admin (or the unlock-user CLI) unlocks
 * it. State lives only in `users.failed_attempts` / `users.locked_at`;
 * `banned` means deactivated and is never used for this.
 *
 * The helpers are synchronous and take the caller's command transaction, so
 * the counter change and its audit rows commit (or roll back) together.
 */
export const LOCK_THRESHOLD = 5;

/** The system actor that locks an account on the threshold failure. */
const LOCKOUT_ACTOR: Actor = { type: "system", name: "lockout" };

const normalize = normalizeUsername;

/** Whether the account with this username is locked. Unknown usernames are not. */
export function isLocked(username: string, db: Db | Tx = getDb()): boolean {
  const row = db
    .select({ lockedAt: users.lockedAt })
    .from(users)
    .where(eq(users.username, normalize(username)))
    .get();
  return Boolean(row?.lockedAt);
}

export type FailureResult =
  /** No account has this username: nothing is counted. */
  | { status: "unknown" }
  | { status: "counted"; userId: string; failedAttempts: number }
  /** This failure reached the threshold and locked the account (audited once). */
  | { status: "locked"; userId: string; failedAttempts: number };

/**
 * Count one failed sign-in. At the threshold, set `locked_at` and write one
 * `auth.locked` row in the same transaction. An already-locked account is not
 * re-locked or re-audited. Never stores the attempted password.
 */
export function recordFailure(
  tx: Tx,
  username: string,
  context: Record<string, unknown> = {},
  now: Date = new Date(),
): FailureResult {
  const updated = tx
    .update(users)
    .set({ failedAttempts: sql`${users.failedAttempts} + 1` })
    .where(eq(users.username, normalize(username)))
    .returning({ id: users.id, name: users.name, failedAttempts: users.failedAttempts, lockedAt: users.lockedAt })
    .get();
  if (!updated) return { status: "unknown" };

  if (updated.failedAttempts < LOCK_THRESHOLD || updated.lockedAt) {
    return { status: "counted", userId: updated.id, failedAttempts: updated.failedAttempts };
  }

  const lockedAt = now.toISOString();
  const locked = tx
    .update(users)
    .set({ lockedAt })
    .where(and(eq(users.id, updated.id), isNull(users.lockedAt)))
    .returning({ id: users.id })
    .get();
  if (!locked) return { status: "counted", userId: updated.id, failedAttempts: updated.failedAttempts };

  record(tx, {
    actor: LOCKOUT_ACTOR,
    action: AuditAction.AuthLocked,
    entity: "user",
    entityId: updated.id,
    changes: {
      username: normalize(username),
      failedAttempts: updated.failedAttempts,
      lockedAt: { old: null, new: lockedAt },
      ...context,
    },
    at: now,
  });
  return { status: "locked", userId: updated.id, failedAttempts: updated.failedAttempts };
}

/** A successful sign-in clears the failure count. Not audited on its own. */
export function resetFailures(tx: Tx, userId: string): void {
  tx.update(users)
    .set({ failedAttempts: 0 })
    .where(and(eq(users.id, userId), sql`${users.failedAttempts} <> 0`))
    .run();
}

export type UnlockResult = "unlocked" | "reset" | "not_locked" | "unknown";

/**
 * Unlock an account: clear `failed_attempts` and `locked_at` and write one
 * `auth.unlocked` row. Its own command (Admins in Story 2.5, the unlock-user
 * CLI now). An account that is not locked but has failures has its count
 * reset quietly ("reset", no audit row, like a successful sign-in); one with
 * nothing to clear is left alone ("not_locked").
 */
export function unlock(userId: string, actor: Actor, db: Db = getDb()): UnlockResult {
  const current = db
    .select({ username: users.username, failedAttempts: users.failedAttempts, lockedAt: users.lockedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!current) return "unknown";
  if (!current.lockedAt) {
    if (current.failedAttempts === 0) return "not_locked";
    db.update(users)
      .set({ failedAttempts: 0 })
      .where(and(eq(users.id, userId), isNull(users.lockedAt)))
      .run();
    return "reset";
  }

  return withCommandTx(
    actor,
    AuditAction.AuthUnlocked,
    (tx, audit) => {
      // Re-read inside the IMMEDIATE transaction: the state may have changed.
      const row = tx
        .select({ failedAttempts: users.failedAttempts, lockedAt: users.lockedAt })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      if (!row) throw new Error(`unlock: user ${userId} disappeared`);
      tx.update(users).set({ failedAttempts: 0, lockedAt: null }).where(eq(users.id, userId)).run();
      audit({
        entity: "user",
        entityId: userId,
        changes: {
          username: current.username,
          failedAttempts: { old: row.failedAttempts, new: 0 },
          lockedAt: { old: row.lockedAt, new: null },
        },
      });
      return "unlocked" as const;
    },
    db,
  );
}
