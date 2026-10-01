import "server-only";
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { listFacilities, type Facility } from "@/server/settings/queries";
import { userFacilities, users } from "./schema";
import { STAFF_ROLES, type StaffRole } from "./staff-rules";

/*
 * Staff reads (Story 2.5). `auth` owns `users` and `user_facilities`;
 * Facilities are read only through the settings getters.
 */

/** Account status on the staff list. Deactivated (banned) wins over locked. */
export const STAFF_STATUSES = ["active", "locked", "deactivated"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export type StaffFacility = {
  id: string;
  name: string;
  /** The prefix in use today. */
  prefix: string;
  /** False when the Facility has been deactivated since it was assigned. */
  active: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  status: StaffStatus;
  failedAttempts: number;
  lockedAt: string | null;
  /** Assigned Facilities in display order, deactivated ones included. */
  facilities: StaffFacility[];
};

export type ListStaffInput = {
  q?: string;
  role?: StaffRole | "all";
  status?: StaffStatus | "all";
  page?: number;
  pageSize?: number;
};

export type StaffPage = {
  rows: StaffMember[];
  total: number;
  /** The page shown, clamped to 1..pageCount. */
  page: number;
  pageCount: number;
  pageSize: number;
};

const notBanned = () => or(isNull(users.banned), eq(users.banned, false))!;

function statusCondition(status: StaffStatus): SQL {
  switch (status) {
    case "deactivated":
      return eq(users.banned, true);
    case "locked":
      return and(notBanned(), isNotNull(users.lockedAt))!;
    case "active":
      return and(notBanned(), isNull(users.lockedAt))!;
  }
}

function statusOf(row: { banned: boolean | null; lockedAt: string | null }): StaffStatus {
  if (row.banned) return "deactivated";
  if (row.lockedAt) return "locked";
  return "active";
}

function toStaffFacility(f: Facility): StaffFacility {
  return { id: f.id, name: f.name, prefix: f.currentPrefix, active: f.deactivatedAt === null };
}

/** Facility assignments for the given users, in Facility display order. */
function facilitiesOf(userIds: string[], db: Db | Tx, now: Date): Map<string, StaffFacility[]> {
  const result = new Map<string, StaffFacility[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return result;
  const links = db
    .select({ userId: userFacilities.userId, facilityId: userFacilities.facilityId })
    .from(userFacilities)
    .where(inArray(userFacilities.userId, userIds))
    .all();
  const byFacility = new Map<string, string[]>();
  for (const link of links) {
    byFacility.set(link.facilityId, [...(byFacility.get(link.facilityId) ?? []), link.userId]);
  }
  for (const facility of listFacilities(now, db)) {
    for (const userId of byFacility.get(facility.id) ?? []) {
      result.get(userId)?.push(toStaffFacility(facility));
    }
  }
  return result;
}

const staffColumns = {
  id: users.id,
  name: users.name,
  username: users.username,
  role: users.role,
  banned: users.banned,
  lockedAt: users.lockedAt,
  failedAttempts: users.failedAttempts,
};

type StaffRow = {
  id: string;
  name: string;
  username: string | null;
  role: string | null;
  banned: boolean | null;
  lockedAt: string | null;
  failedAttempts: number;
};

function toMember(row: StaffRow, facilities: StaffFacility[]): StaffMember {
  return {
    id: row.id,
    name: row.name,
    username: row.username ?? "",
    role: row.role as StaffRole,
    status: statusOf(row),
    failedAttempts: row.failedAttempts,
    lockedAt: row.lockedAt,
    facilities,
  };
}

/**
 * The staff list: `q` matches name or username (case-insensitive, anywhere),
 * filtered by Role and status, sorted by name, one page at a time.
 */
export function listStaff(input: ListStaffInput = {}, db: Db | Tx = getDb(), now: Date = new Date()): StaffPage {
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? 25));
  const conditions: SQL[] = [inArray(users.role, [...STAFF_ROLES])];
  const q = (input.q ?? "").trim().toLowerCase();
  if (q) {
    conditions.push(
      // unicode_lower (registered in db/client.ts): SQLite's lower() is ASCII-only.
      or(
        sql`instr(unicode_lower(${users.name}), ${q}) > 0`,
        sql`instr(unicode_lower(coalesce(${users.username}, '')), ${q}) > 0`,
      )!,
    );
  }
  if (input.role && input.role !== "all") conditions.push(eq(users.role, input.role));
  if (input.status && input.status !== "all") conditions.push(statusCondition(input.status));
  const where = and(...conditions);

  const total = db.select({ n: count() }).from(users).where(where).get()?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(input.page ?? 1)), pageCount);

  const rows = db
    .select(staffColumns)
    .from(users)
    .where(where)
    .orderBy(asc(sql`${users.name} collate nocase`), asc(users.username))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const facilities = facilitiesOf(
    rows.map((r) => r.id),
    db,
    now,
  );
  return {
    rows: rows.map((row) => toMember(row, facilities.get(row.id) ?? [])),
    total,
    page,
    pageCount,
    pageSize,
  };
}

/** One staff member (any status), or null when there is no staff account with this id. */
export function getStaffMember(id: string, db: Db | Tx = getDb(), now: Date = new Date()): StaffMember | null {
  const row = db
    .select(staffColumns)
    .from(users)
    .where(and(eq(users.id, id), inArray(users.role, [...STAFF_ROLES])))
    .get();
  if (!row) return null;
  return toMember(row, facilitiesOf([row.id], db, now).get(row.id) ?? []);
}

/**
 * The ids of the active Facilities a user is assigned to: the Facility scope
 * of `can()` (deactivated Facilities grant nothing).
 */
export function activeFacilityIdsOf(userId: string, db: Db | Tx = getDb(), now: Date = new Date()): string[] {
  return (facilitiesOf([userId], db, now).get(userId) ?? []).filter((f) => f.active).map((f) => f.id);
}

/** Active (not deactivated) Admins, optionally leaving one user out. */
export function countActiveAdmins(db: Db | Tx = getDb(), exceptUserId?: string): number {
  const conditions: SQL[] = [eq(users.role, "admin"), notBanned()];
  if (exceptUserId) conditions.push(sql`${users.id} <> ${exceptUserId}`);
  return db.select({ n: count() }).from(users).where(and(...conditions)).get()?.n ?? 0;
}
