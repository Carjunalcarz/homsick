import "server-only";
import { addOpdDays, manilaMinutes, manilaWeekday, opdDate } from "@/lib/time";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import {
  selectActiveUrgencyLevels,
  selectAllFacilities,
  selectClinicalScheduleByCode,
  selectClinicalSchedules,
  selectFacility,
  selectOpdSettings,
  selectPriorityCategories,
} from "./repo";
import type { ClinicalScheduleRow, FacilityRow, PriorityCategoryRow, UrgencyLevelRow } from "./schema";

/*
 * The settings getters (AD-8). Other modules read OPD policy only through
 * these, never from the tables.
 */

/**
 * A Facility as the app sees it. `prefix` is the stored one; `currentPrefix`
 * is the prefix in use on the OPD day the Facility was read for.
 */
export type Facility = {
  id: string;
  name: string;
  prefix: string;
  /** `effectivePrefix()` at the instant the list was read. */
  currentPrefix: string;
  /** A prefix change waiting for its OPD day, or null. */
  nextPrefix: string | null;
  /** The OPD date (`YYYY-MM-DD`, Manila) `nextPrefix` takes effect. */
  nextPrefixFrom: string | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  openDays: number[];
  /** Manila `HH:MM`; open is `[openTime, closeTime)`. */
  openTime: string;
  closeTime: string;
  isLive: boolean;
  sortOrder: number;
  /** UTC ISO when deactivated, or null while active. */
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Instant = Date | string | number;

function parseDays(value: string): number[] {
  try {
    const days: unknown = JSON.parse(value);
    if (!Array.isArray(days)) return [];
    return days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7);
  } catch {
    return [];
  }
}

export function toFacility(row: FacilityRow, instant: Instant = new Date()): Facility {
  return { ...row, currentPrefix: effectivePrefix(row, instant), openDays: parseDays(row.openDays) };
}

/** Every Facility, deactivated ones included, in display order (Admin view). */
export function listFacilities(instant: Instant = new Date(), db: Db | Tx = getDb()): Facility[] {
  return selectAllFacilities(db).map((row) => toFacility(row, instant));
}

export function getFacility(id: string, instant: Instant = new Date(), db: Db | Tx = getDb()): Facility | null {
  const row = selectFacility(db, id);
  return row ? toFacility(row, instant) : null;
}

/** Active, live Facilities in display order: the ones patients can be queued to. */
export function liveFacilities(instant: Instant = new Date(), db: Db | Tx = getDb()): Facility[] {
  return listFacilities(instant, db).filter((f) => f.isLive && f.deactivatedAt === null);
}

/**
 * The Queue Number prefix on the OPD day `instant` falls on. A pending change
 * applies from its `nextPrefixFrom` day (Manila midnight), so today keeps the
 * old prefix. Stored rows are normalized on their next write (see service).
 */
export function effectivePrefix(
  facility: Pick<Facility, "prefix" | "nextPrefix" | "nextPrefixFrom">,
  instant: Instant = new Date(),
): string {
  if (facility.nextPrefix && facility.nextPrefixFrom && opdDate(instant) >= facility.nextPrefixFrom) {
    return facility.nextPrefix;
  }
  return facility.prefix;
}

/** The prefix change still to come at `instant`, or null. */
export function pendingPrefix(
  facility: Pick<Facility, "prefix" | "nextPrefix" | "nextPrefixFrom">,
  instant: Instant = new Date(),
): { prefix: string; from: string } | null {
  if (!facility.nextPrefix || !facility.nextPrefixFrom) return null;
  if (opdDate(instant) >= facility.nextPrefixFrom) return null;
  return { prefix: facility.nextPrefix, from: facility.nextPrefixFrom };
}

/* ---------- Clinical settings (FR-24) ---------- */

/** An active Urgency Level. ER levels have `rank: null`; lower ranks are served first. */
export type UrgencyLevel = { id: string; name: string; isEr: boolean; rank: number | null };

export function toUrgencyLevel(row: UrgencyLevelRow): UrgencyLevel {
  return { id: row.id, name: row.name, isEr: row.isEr, rank: row.isEr ? null : row.rank };
}

/** Getter order: non-ER levels by rank, then ER levels by name. */
export function compareUrgencyLevels(a: UrgencyLevel, b: UrgencyLevel): number {
  if (a.isEr !== b.isEr) return a.isEr ? 1 : -1;
  if (!a.isEr && a.rank !== b.rank) return (a.rank ?? 0) - (b.rank ?? 0);
  return a.name.localeCompare(b.name);
}

/** The active Urgency Levels: non-ER by rank (lower first), then the ER ones. */
export function urgencyLevels(db: Db | Tx = getDb()): UrgencyLevel[] {
  return selectActiveUrgencyLevels(db).map(toUrgencyLevel).sort(compareUrgencyLevels);
}

export type PriorityCategory = {
  id: string;
  /** Stable key: `senior_citizen`, `pwd` or `pregnant`. */
  code: string;
  name: string;
  /** "RA 9994", "RA 10754" or "Hospital policy". */
  legalBasis: string;
  legallyRequired: boolean;
  enabled: boolean;
  sortOrder: number;
};

function toPriorityCategory(row: PriorityCategoryRow): PriorityCategory {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalBasis: row.legalBasis,
    legallyRequired: row.legallyRequired,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
  };
}

/** Every Priority Category, enabled or not, in display order. */
export function priorityCategories(db: Db | Tx = getDb()): PriorityCategory[] {
  return selectPriorityCategories(db).map(toPriorityCategory);
}

/** The Priority Categories triage may assign to new entries. */
export function enabledPriorityCategories(db: Db | Tx = getDb()): PriorityCategory[] {
  return priorityCategories(db).filter((c) => c.enabled);
}

export type ClinicalSchedule = { id: string; code: string; name: string; days: number[] };

export type AbcScheduleKind = "new" | "previously_immunized";

/** The `clinical_schedules.code` of each Animal Bite Center schedule. */
export const ABC_SCHEDULE_CODES: Record<AbcScheduleKind, string> = {
  new: "abc_new",
  previously_immunized: "abc_previously_immunized",
};

function parseScheduleDays(value: string): number[] {
  try {
    const days: unknown = JSON.parse(value);
    return Array.isArray(days) ? days.filter((d): d is number => Number.isInteger(d)) : [];
  } catch {
    return [];
  }
}

export function toClinicalSchedule(row: ClinicalScheduleRow): ClinicalSchedule {
  return { id: row.id, code: row.code, name: row.name, days: parseScheduleDays(row.days) };
}

/** Every dose schedule (the Animal Bite Center's two), in display order. */
export function clinicalSchedules(db: Db | Tx = getDb()): ClinicalSchedule[] {
  return selectClinicalSchedules(db).map(toClinicalSchedule);
}

/** An Animal Bite Center dose schedule: the dose days counted from Day 0. */
export function abcSchedule(kind: AbcScheduleKind, db: Db | Tx = getDb()): ClinicalSchedule {
  const row = selectClinicalScheduleByCode(db, ABC_SCHEDULE_CODES[kind]);
  if (!row) throw new Error(`abcSchedule: the ${kind} schedule is missing (migration 0006)`);
  return toClinicalSchedule(row);
}

export type OpdThresholds = {
  /** Prenatal visits to aim for per pregnancy. */
  prenatalTarget: number;
  /** Calls without an answer before a patient is marked No-show. */
  noShowThreshold: number;
  /** Minutes before closing to warn; 0 = off. */
  preCloseWarningMinutes: number;
  /** Printed at the top of each queue slip (Story 3.6). */
  hospitalName: string;
};

export function opdThresholds(db: Db | Tx = getDb()): OpdThresholds {
  const row = selectOpdSettings(db);
  if (!row) throw new Error("opdThresholds: the opd_settings row is missing (migration 0006)");
  return {
    prenatalTarget: row.prenatalTarget,
    noShowThreshold: row.noShowThreshold,
    preCloseWarningMinutes: row.preCloseWarningMinutes,
    hospitalName: row.hospitalName,
  };
}

/** The hospital name printed on queue slips (Admin setting, default "Hospital OPD"). */
export function hospitalName(db: Db | Tx = getDb()): string {
  return opdThresholds(db).hospitalName;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Whether the Facility's hours cover `instant`: the Manila weekday is an open
 * day and the Manila time is in `[openTime, closeTime)`. Live and active are
 * separate checks.
 */
export function isOpen(facility: Pick<Facility, "openDays" | "openTime" | "closeTime">, instant: Instant): boolean {
  if (!facility.openDays.includes(manilaWeekday(instant))) return false;
  const now = manilaMinutes(instant);
  return now >= toMinutes(facility.openTime) && now < toMinutes(facility.closeTime);
}

/** When a Facility next opens: the Manila OPD date, its ISO weekday and the Manila `HH:MM`. */
export type FacilityOpening = { opdDate: string; weekday: number; time: string };

/**
 * The Facility's next opening strictly after `instant` (Manila time): later
 * today when `instant` is before today's opening time on an open day,
 * otherwise the next open day. Null when it has no open days.
 */
export function nextOpening(
  facility: Pick<Facility, "openDays" | "openTime">,
  instant: Instant,
): FacilityOpening | null {
  if (facility.openDays.length === 0) return null;
  const today = opdDate(instant);
  const weekday = manilaWeekday(instant);
  const beforeOpening = manilaMinutes(instant) < toMinutes(facility.openTime);
  // Up to 7 days ahead: the same weekday next week when today's opening has passed.
  for (let offset = 0; offset <= 7; offset++) {
    const day = ((weekday - 1 + offset) % 7) + 1;
    if (!facility.openDays.includes(day)) continue;
    if (offset === 0 && !beforeOpening) continue;
    return { opdDate: addOpdDays(today, offset), weekday: day, time: facility.openTime };
  }
  return null;
}
