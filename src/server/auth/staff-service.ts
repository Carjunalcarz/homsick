import "server-only";
import { and, eq } from "drizzle-orm";
import { isAPIError } from "better-auth/api";
import { AuditAction } from "@/server/audit/schema";
import { getDb, type Db } from "@/server/db/client";
import { DomainError } from "@/server/db/errors";
import { withCommandTx, type Tx } from "@/server/db/tx";
import { listFacilities } from "@/server/settings/queries";
import { getAuth } from "./auth";
import { unlock } from "./lockout";
import { accounts, sessions, userFacilities, users } from "./schema";
import { countActiveAdmins, getStaffMember, type StaffMember } from "./staff-queries";
import type { CreateStaffInput, SetPasswordInput, UpdateStaffInput } from "./staff-schemas";
import type { StaffRole } from "./staff-rules";

/*
 * Staff commands (Story 2.5, FR2/FR3). Each writes exactly one audit row.
 *
 * Better Auth's admin API writes the user fields it owns (name, role,
 * password, banned) in its own transactions, called with the acting Admin's
 * request headers so its own access control applies too. The app's writes
 * (Facility assignments) and the audit row follow in one `withCommandTx`;
 * when that fails, the Better Auth change is compensated (as create-admin
 * does) and the error is rethrown. Passwords never reach the audit log.
 */

export const StaffError = {
  NotFound: "staff_not_found",
  UsernameTaken: "username_taken",
  UsernameInvalid: "username_invalid",
  LastAdmin: "last_admin",
  SelfAction: "self_action",
  FacilitiesRequired: "facilities_required",
  FacilitiesNotAllowed: "facilities_not_allowed",
  FacilityUnavailable: "facility_unavailable",
} as const;

export const STAFF_MESSAGES = {
  notFound: "That staff account no longer exists.",
  usernameTaken: "Username already in use",
  usernameInvalid: "This username can't be used. Use letters and digits, separated by single dots, dashes or underscores.",
  lastAdmin: "This is the only active Admin. Make another person an Admin first.",
  selfDemote: "You can't remove your own Admin Role. Ask another Admin.",
  selfDeactivate: "You can't deactivate your own account. Ask another Admin.",
  facilitiesRequired: "Facility Staff need at least one active Facility.",
  facilitiesNotAllowed: "Only Facility Staff have Facilities. Triage Nurses and Admins have none.",
  facilityUnavailable: "Choose active Facilities only.",
  reactivateNeedsFacility: "Assign an active Facility (Edit) before reactivating this Facility Staff account.",
} as const;

/** The staff member doing it. Staff commands always have a signed-in actor. */
export type StaffActor = { type: "staff"; id: string; name: string };

export type StaffOutcome = { changed: boolean; member: StaffMember };

/** The Better Auth email for a username: staff sign in by username only. */
export function staffEmail(username: string): string {
  return `${username}@staff.opd.invalid`;
}

const DEACTIVATED_REASON = "Deactivated by an Admin";

function load(id: string, db: Db | Tx, now: Date): StaffMember {
  const member = getStaffMember(id, db, now);
  if (!member) throw new DomainError(StaffError.NotFound, STAFF_MESSAGES.notFound);
  return member;
}

/**
 * The Facility rule: Facility Staff have at least one active Facility;
 * Triage Nurses and Admins have none. A deactivated Facility may stay
 * assigned (it is in `keep`) but can't be newly assigned. Returns the ids in
 * Facility display order.
 */
function checkFacilities(
  role: StaffRole,
  wanted: readonly string[],
  keep: readonly string[],
  db: Db | Tx,
  now: Date,
): string[] {
  const ids = new Set(wanted);
  if (role !== "facility_staff") {
    if (ids.size > 0) throw new DomainError(StaffError.FacilitiesNotAllowed, STAFF_MESSAGES.facilitiesNotAllowed);
    return [];
  }
  const all = listFacilities(now, db);
  const byId = new Map(all.map((f) => [f.id, f]));
  for (const id of ids) {
    const facility = byId.get(id);
    if (!facility || (facility.deactivatedAt !== null && !keep.includes(id))) {
      throw new DomainError(StaffError.FacilityUnavailable, STAFF_MESSAGES.facilityUnavailable);
    }
  }
  if (!all.some((f) => ids.has(f.id) && f.deactivatedAt === null)) {
    throw new DomainError(StaffError.FacilitiesRequired, STAFF_MESSAGES.facilitiesRequired);
  }
  return all.filter((f) => ids.has(f.id)).map((f) => f.id);
}

/** Facility ids with names, for audit rows. */
function facilitiesForAudit(ids: readonly string[], db: Db | Tx, now: Date) {
  const byId = new Map(listFacilities(now, db).map((f) => [f.id, f.name]));
  return ids.map((id) => ({ id, name: byId.get(id) ?? null }));
}

function replaceFacilities(tx: Tx, userId: string, facilityIds: readonly string[]) {
  tx.delete(userFacilities).where(eq(userFacilities.userId, userId)).run();
  if (facilityIds.length > 0) {
    tx.insert(userFacilities)
      .values(facilityIds.map((facilityId) => ({ userId, facilityId })))
      .run();
  }
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

/** Refuse a change that would leave no active Admin (`userId` is losing Admin or being deactivated). */
function assertAnotherActiveAdmin(db: Db | Tx, userId: string) {
  if (countActiveAdmins(db, userId) === 0) throw new DomainError(StaffError.LastAdmin, STAFF_MESSAGES.lastAdmin);
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}

function apiErrorCode(error: unknown): string | null {
  if (!isAPIError(error)) return null;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : null;
}

function isUserExistsError(error: unknown): boolean {
  return apiErrorCode(error)?.includes("ALREADY_EXISTS") ?? false;
}

/** Better Auth refused the synthetic email built from the username. */
function isInvalidEmailError(error: unknown): boolean {
  return apiErrorCode(error) === "INVALID_EMAIL";
}

/** The lockout fields cleared (the unlock half of reactivation and a new password). Returns whether a lock was set. */
function clearLockout(tx: Tx, userId: string): boolean {
  const row = tx.select({ lockedAt: users.lockedAt }).from(users).where(eq(users.id, userId)).get();
  tx.update(users).set({ failedAttempts: 0, lockedAt: null }).where(eq(users.id, userId)).run();
  return Boolean(row?.lockedAt);
}

/** Best effort: the original error matters more than a failed compensation. */
async function compensate(what: string, undo: () => unknown) {
  try {
    await undo();
  } catch (error) {
    console.error(`staff: compensation failed (${what})`, error instanceof Error ? error.message : error);
  }
}

/**
 * Create a staff account with a temporary password. Audited as
 * `staff.created` with the name, username, Role and Facilities.
 */
export async function createStaff(
  input: CreateStaffInput,
  actor: StaffActor,
  headers: Headers,
  now: Date = new Date(),
): Promise<StaffOutcome> {
  const db = getDb();
  const facilityIds = checkFacilities(input.role, input.facilityIds, [], db, now);
  const taken = db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get();
  if (taken) throw new DomainError(StaffError.UsernameTaken, STAFF_MESSAGES.usernameTaken);

  let userId: string;
  try {
    const { user } = await getAuth().api.createUser({
      headers,
      body: {
        name: input.name,
        email: staffEmail(input.username),
        password: input.password,
        role: input.role,
        data: { username: input.username, displayUsername: input.username },
      },
    });
    userId = user.id;
  } catch (error) {
    if (isUniqueViolation(error) || isUserExistsError(error)) {
      throw new DomainError(StaffError.UsernameTaken, STAFF_MESSAGES.usernameTaken);
    }
    if (isInvalidEmailError(error)) {
      throw new DomainError(StaffError.UsernameInvalid, STAFF_MESSAGES.usernameInvalid);
    }
    throw error;
  }

  try {
    withCommandTx(actor, AuditAction.StaffCreated, (tx, audit) => {
      // Re-checked inside the transaction: a Facility may have changed meanwhile.
      const ids = checkFacilities(input.role, facilityIds, [], tx, now);
      replaceFacilities(tx, userId, ids);
      audit({
        entity: "user",
        entityId: userId,
        changes: {
          name: input.name,
          username: input.username,
          role: input.role,
          facilities: facilitiesForAudit(ids, tx, now),
        },
      });
    });
  } catch (error) {
    // Better Auth wrote the account in its own transaction; without its
    // audit row the account must not exist.
    await compensate("remove created account", () =>
      db.transaction((tx) => {
        tx.delete(userFacilities).where(eq(userFacilities.userId, userId)).run();
        tx.delete(sessions).where(eq(sessions.userId, userId)).run();
        tx.delete(accounts).where(eq(accounts.userId, userId)).run();
        tx.delete(users).where(eq(users.id, userId)).run();
      }),
    );
    throw error;
  }
  return { changed: true, member: load(userId, db, now) };
}

/**
 * Change a staff member's name, Role and Facilities. Audited as
 * `staff.updated` with the old and new value of each changed field. An Admin
 * can't demote themself, and the last active Admin can't be demoted.
 */
export async function updateStaff(
  input: UpdateStaffInput,
  actor: StaffActor,
  headers: Headers,
  now: Date = new Date(),
): Promise<StaffOutcome> {
  const db = getDb();
  const before = load(input.id, db, now);
  const beforeIds = before.facilities.map((f) => f.id);
  const demoting = before.role === "admin" && input.role !== "admin";
  if (demoting && before.id === actor.id) {
    throw new DomainError(StaffError.SelfAction, STAFF_MESSAGES.selfDemote);
  }
  if (demoting && before.status !== "deactivated") assertAnotherActiveAdmin(db, before.id);
  const facilityIds = checkFacilities(input.role, input.facilityIds, beforeIds, db, now);

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (input.name !== before.name) changes.name = { old: before.name, new: input.name };
  if (input.role !== before.role) changes.role = { old: before.role, new: input.role };
  if (!sameIds(facilityIds, beforeIds)) {
    changes.facilities = {
      old: facilitiesForAudit(beforeIds, db, now),
      new: facilitiesForAudit(facilityIds, db, now),
    };
  }
  if (Object.keys(changes).length === 0) return { changed: false, member: before };

  const authData: Record<string, string> = {};
  if (changes.name) authData.name = input.name;
  if (changes.role) authData.role = input.role;
  if (Object.keys(authData).length > 0) {
    await getAuth().api.adminUpdateUser({ headers, body: { userId: before.id, data: authData } });
  }

  try {
    withCommandTx(actor, AuditAction.StaffUpdated, (tx, audit) => {
      if (demoting && before.status !== "deactivated") assertAnotherActiveAdmin(tx, before.id);
      if (changes.facilities) {
        replaceFacilities(tx, before.id, checkFacilities(input.role, facilityIds, beforeIds, tx, now));
      }
      audit({ entity: "user", entityId: before.id, changes: { username: before.username, ...changes } });
    });
  } catch (error) {
    if (Object.keys(authData).length > 0) {
      const undo: Record<string, string> = {};
      if (authData.name !== undefined) undo.name = before.name;
      if (authData.role !== undefined) undo.role = before.role;
      await compensate("restore name and Role", () =>
        getAuth().api.adminUpdateUser({ headers, body: { userId: before.id, data: undo } }),
      );
    }
    throw error;
  }
  return { changed: true, member: load(before.id, db, now) };
}

/**
 * Set a new temporary password (there is no self-service reset). It also
 * clears a lockout and signs the person out everywhere, so only the new
 * password works from now on. Audited as `staff.password_set` with
 * `lockCleared` and `sessionsRevoked`, never the password.
 */
export async function setTemporaryPassword(
  input: SetPasswordInput,
  actor: StaffActor,
  headers: Headers,
  now: Date = new Date(),
): Promise<StaffOutcome> {
  const db = getDb();
  const member = load(input.id, db, now);
  const credential = () => and(eq(accounts.userId, member.id), eq(accounts.providerId, "credential"));
  const previous = db.select({ id: accounts.id, password: accounts.password }).from(accounts).where(credential()).get();

  await getAuth().api.setUserPassword({ headers, body: { userId: member.id, newPassword: input.password } });

  try {
    // Lock and sessions change in the audit's transaction, so a failure rolls them back too.
    withCommandTx(actor, AuditAction.StaffPasswordSet, (tx, audit) => {
      const lockCleared = clearLockout(tx, member.id);
      tx.delete(sessions).where(eq(sessions.userId, member.id)).run();
      audit({
        entity: "user",
        entityId: member.id,
        changes: { username: member.username, lockCleared, sessionsRevoked: true },
      });
    });
  } catch (error) {
    await compensate("restore previous password", () => {
      if (previous) {
        db.update(accounts).set({ password: previous.password }).where(eq(accounts.id, previous.id)).run();
      } else {
        db.delete(accounts).where(credential()).run();
      }
    });
    throw error;
  }
  return { changed: true, member };
}

/**
 * Deactivate an account: Better Auth `banned` plus revoking every session
 * (not the lockout). Past audit rows keep the person's name. An Admin can't
 * deactivate themself, and the last active Admin can't be deactivated.
 */
export async function deactivateStaff(
  id: string,
  actor: StaffActor,
  headers: Headers,
  now: Date = new Date(),
): Promise<StaffOutcome> {
  const db = getDb();
  const member = load(id, db, now);
  if (member.status === "deactivated") return { changed: false, member };
  if (member.id === actor.id) throw new DomainError(StaffError.SelfAction, STAFF_MESSAGES.selfDeactivate);
  if (member.role === "admin") assertAnotherActiveAdmin(db, member.id);

  await getAuth().api.banUser({ headers, body: { userId: member.id, banReason: DEACTIVATED_REASON } });

  try {
    // banUser already deletes the sessions; this makes the revoke explicit.
    await getAuth().api.revokeUserSessions({ headers, body: { userId: member.id } });
    withCommandTx(actor, AuditAction.StaffDeactivated, (tx, audit) => {
      if (member.role === "admin") assertAnotherActiveAdmin(tx, member.id);
      audit({
        entity: "user",
        entityId: member.id,
        changes: { username: member.username, name: member.name, banned: { old: false, new: true } },
      });
    });
  } catch (error) {
    await compensate("unban", () => getAuth().api.unbanUser({ headers, body: { userId: member.id } }));
    throw error;
  }
  return { changed: true, member: load(member.id, db, now) };
}

/**
 * Reactivate a deactivated account. A lockout left from before deactivation
 * is cleared too (Unlock isn't offered on deactivated accounts). Audited as
 * `staff.reactivated` with `lockCleared`.
 */
export async function reactivateStaff(
  id: string,
  actor: StaffActor,
  headers: Headers,
  now: Date = new Date(),
): Promise<StaffOutcome> {
  const db = getDb();
  const member = load(id, db, now);
  if (member.status !== "deactivated") return { changed: false, member };
  if (member.role === "facility_staff" && !member.facilities.some((f) => f.active)) {
    throw new DomainError(StaffError.FacilitiesRequired, STAFF_MESSAGES.reactivateNeedsFacility);
  }

  await getAuth().api.unbanUser({ headers, body: { userId: member.id } });

  try {
    withCommandTx(actor, AuditAction.StaffReactivated, (tx, audit) => {
      const lockCleared = clearLockout(tx, member.id);
      audit({
        entity: "user",
        entityId: member.id,
        changes: { username: member.username, name: member.name, banned: { old: true, new: false }, lockCleared },
      });
    });
  } catch (error) {
    await compensate("ban again", () =>
      getAuth().api.banUser({ headers, body: { userId: member.id, banReason: DEACTIVATED_REASON } }),
    );
    throw error;
  }
  return { changed: true, member: load(member.id, db, now) };
}

/**
 * Unlock an account locked after failed sign-ins (`lockout.unlock`, audited
 * as `auth.unlocked`). An account with failures but no lock has its count
 * reset without an audit row, as a successful sign-in does.
 */
export function unlockStaff(id: string, actor: StaffActor, now: Date = new Date()): StaffOutcome {
  const db = getDb();
  load(id, db, now);
  const result = unlock(id, actor, db);
  if (result === "unknown") throw new DomainError(StaffError.NotFound, STAFF_MESSAGES.notFound);
  return { changed: result !== "not_locked", member: load(id, db, now) };
}
