import "server-only";
import { nextOpdDate, opdDate } from "@/lib/time";
import { AuditAction } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { getDb, type Db } from "@/server/db/client";
import { DomainError } from "@/server/db/errors";
import { withCommandTx, type Tx } from "@/server/db/tx";
import {
  compareUrgencyLevels,
  effectivePrefix,
  opdThresholds,
  pendingPrefix,
  priorityCategories,
  toClinicalSchedule,
  toFacility,
  toUrgencyLevel,
  urgencyLevels,
  type ClinicalSchedule,
  type Facility,
  type OpdThresholds,
  type PriorityCategory,
  type UrgencyLevel,
} from "./queries";
import {
  insertUrgencyLevelRow,
  selectActiveUrgencyLevels,
  selectAllFacilities,
  selectClinicalSchedule,
  selectFacility,
  selectOpdSettings,
  selectPriorityCategory,
  updateClinicalScheduleRow,
  updateFacilityRow,
  updateOpdSettingsRow,
  updatePriorityCategoryRow,
  updateUrgencyLevelRow,
} from "./repo";
import type { FacilityRow, UrgencyLevelRow } from "./schema";
import {
  LEGALLY_REQUIRED,
  LEVEL_NAME_TAKEN,
  NO_NON_ER_LEVEL,
  RANK_TAKEN,
  type SetPriorityCategoryEnabledInput,
  type UpdateClinicalScheduleInput,
  type UpdateFacilityInput,
  type UpdateOpdThresholdsInput,
  type UpdateUrgencyLevelsInput,
} from "./schemas";

/*
 * Facility commands (FR23). Each runs in one `withCommandTx` and writes one
 * audit row with the old and new values of the fields it changed.
 *
 * Prefix changes: the new prefix is stored as `next_prefix` from tomorrow's
 * OPD date, and `prefix` keeps today's. Reads use `effectivePrefix()`; once
 * the day has come, the next write to that row folds `next_prefix` into
 * `prefix` (lazily, never by a job).
 */

export const FacilityError = {
  NotFound: "facility_not_found",
  Deactivated: "facility_deactivated",
  PrefixTaken: "prefix_taken",
  NameTaken: "name_taken",
} as const;

/** Thrown inside the transaction to roll back a save that changes nothing. */
class Unchanged extends Error {}

export type CommandOutcome = { changed: boolean; facility: Facility };

type Diff = Record<string, { old: unknown; new: unknown }>;

type Editable = Pick<
  FacilityRow,
  "name" | "prefix" | "nextPrefix" | "nextPrefixFrom" | "openDays" | "openTime" | "closeTime" | "isLive" | "deactivatedAt"
>;

const EDITABLE_KEYS = [
  "name",
  "prefix",
  "nextPrefix",
  "nextPrefixFrom",
  "openDays",
  "openTime",
  "closeTime",
  "isLive",
  "deactivatedAt",
] as const satisfies readonly (keyof Editable)[];

/** The fields that differ, with `openDays` shown as arrays rather than JSON text. */
function diff(before: Editable, after: Editable): Diff {
  const changes: Diff = {};
  for (const key of EDITABLE_KEYS) {
    if (before[key] === after[key]) continue;
    const show = (value: unknown) => (key === "openDays" && typeof value === "string" ? JSON.parse(value) : value);
    changes[key] = { old: show(before[key]), new: show(after[key]) };
  }
  return changes;
}

function loadForWrite(tx: Tx, id: string): FacilityRow {
  const row = selectFacility(tx, id);
  if (!row) throw new DomainError(FacilityError.NotFound, "Facility not found.");
  return row;
}

/** The row with a pending prefix change folded in once its OPD day has come. */
function folded(row: FacilityRow, now: Date): Editable {
  const base: Editable = { ...row };
  if (row.nextPrefix && row.nextPrefixFrom && opdDate(now) >= row.nextPrefixFrom) {
    base.prefix = row.nextPrefix;
    base.nextPrefix = null;
    base.nextPrefixFrom = null;
  }
  return base;
}

/** Prefixes held by other Facilities: in use today or pending. Deactivated ones keep theirs. */
function prefixesInUse(tx: Tx, exceptId: string, now: Date): Set<string> {
  const used = new Set<string>();
  for (const other of selectAllFacilities(tx)) {
    if (other.id === exceptId) continue;
    used.add(effectivePrefix(other, now));
    const pending = pendingPrefix(other, now);
    if (pending) used.add(pending.prefix);
  }
  return used;
}

function nameTaken(tx: Tx, exceptId: string, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return selectAllFacilities(tx).some(
    (other) => other.id !== exceptId && other.deactivatedAt === null && other.name.trim().toLowerCase() === wanted,
  );
}

/**
 * Run a Facility command. `change` gets the current row and returns the new
 * values, or throws Unchanged; the audit row gets exactly the changed fields.
 */
function facilityCommand(
  id: string,
  actor: Actor,
  action: AuditAction,
  now: Date,
  db: Db,
  change: (tx: Tx, row: FacilityRow) => { before: Editable; after: Editable },
): CommandOutcome {
  try {
    return withCommandTx(
      actor,
      action,
      (tx, audit) => {
        const row = loadForWrite(tx, id);
        const { before, after } = change(tx, row);
        // Compared against the folded row, so a save that only re-states the
        // current values changes nothing (and writes no audit row).
        if (Object.keys(diff(before, after)).length === 0) throw new Unchanged();
        const updated = updateFacilityRow(tx, id, { ...after, updatedAt: now.toISOString() });
        audit({ entity: "facility", entityId: id, changes: diff(row, after) });
        return { changed: true, facility: toFacility(updated, now) };
      },
      db,
    );
  } catch (error) {
    if (!(error instanceof Unchanged)) throw error;
    const row = selectFacility(db, id);
    if (!row) throw new DomainError(FacilityError.NotFound, "Facility not found.");
    return { changed: false, facility: toFacility(row, now) };
  }
}

/**
 * Save the Facility form: name, prefix, open days, hours and Live. A new
 * prefix takes effect on the next OPD day; choosing the current prefix again
 * cancels a pending change.
 */
export function updateFacility(
  input: UpdateFacilityInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): CommandOutcome {
  return facilityCommand(input.id, actor, AuditAction.SettingsFacilityUpdated, now, db, (tx, row) => {
    if (row.deactivatedAt) {
      throw new DomainError(FacilityError.Deactivated, "Reactivate this Facility before editing it.");
    }
    const before = folded(row, now);
    const after: Editable = {
      ...before,
      name: input.name,
      openDays: JSON.stringify(input.openDays),
      openTime: input.openTime,
      closeTime: input.closeTime,
      isLive: input.isLive,
    };

    if (input.prefix === before.prefix) {
      after.nextPrefix = null;
      after.nextPrefixFrom = null;
    } else if (input.prefix !== before.nextPrefix) {
      after.nextPrefix = input.prefix;
      after.nextPrefixFrom = nextOpdDate(now);
    }

    if (input.prefix !== before.prefix && prefixesInUse(tx, row.id, now).has(input.prefix)) {
      throw new DomainError(FacilityError.PrefixTaken, "Prefix already in use");
    }
    if (input.name.toLowerCase() !== before.name.toLowerCase() && nameTaken(tx, row.id, input.name)) {
      throw new DomainError(FacilityError.NameTaken, "Name already in use");
    }
    return { before, after };
  });
}

/** Deactivate a Facility: hidden from new assignments, kept for history. */
export function deactivateFacility(
  id: string,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): CommandOutcome {
  return facilityCommand(id, actor, AuditAction.SettingsFacilityDeactivated, now, db, (_tx, row) => {
    const before = folded(row, now);
    return { before, after: { ...before, deactivatedAt: row.deactivatedAt ?? now.toISOString() } };
  });
}

/** Reactivate a Facility, unless an active one has taken its name meanwhile. */
export function reactivateFacility(
  id: string,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): CommandOutcome {
  return facilityCommand(id, actor, AuditAction.SettingsFacilityReactivated, now, db, (tx, row) => {
    const before = folded(row, now);
    if (row.deactivatedAt && nameTaken(tx, row.id, row.name)) {
      throw new DomainError(FacilityError.NameTaken, `An active Facility is already named ${row.name}.`);
    }
    return { before, after: { ...before, deactivatedAt: null } };
  });
}

/* ---------- Clinical settings (FR-24) ----------
 *
 * Each command runs in one `withCommandTx` with its own audit action and
 * writes one audit row with the old and new values; a save that changes
 * nothing rolls back and writes no row. Changes apply to new entries only:
 * nothing stored elsewhere is rewritten.
 */

export const ClinicalError = {
  NoNonErLevel: "no_non_er_level",
  RankTaken: "rank_taken",
  NameTaken: "name_taken",
  ConfirmationRequired: "confirmation_required",
  NotFound: "not_found",
} as const;

/** A DomainError about specific form fields, e.g. `{ "levels.1.rank": "Rank already used" }`. */
export class FieldDomainError extends DomainError {
  readonly fieldErrors: Record<string, string>;

  constructor(code: string, message: string, fieldErrors: Record<string, string>) {
    super(code, message);
    this.name = "FieldDomainError";
    this.fieldErrors = fieldErrors;
  }
}

/** Run a command; when it throws `Unchanged`, return `current()` with `changed: false`. */
function unlessUnchanged<T extends object>(command: () => T, current: () => T): T & { changed: boolean } {
  try {
    return { ...command(), changed: true };
  } catch (error) {
    if (!(error instanceof Unchanged)) throw error;
    return { ...current(), changed: false };
  }
}

/** Temporary ranks while a whole-list save moves levels past each other (real ranks stop at 99). */
const TEMP_RANK_BASE = 1_000_000;

function sameLevel(a: UrgencyLevel, b: UrgencyLevel): boolean {
  return a.name === b.name && a.isEr === b.isEr && a.rank === b.rank;
}

/**
 * Save the whole Urgency Levels list: rename, re-rank, add, and remove
 * (levels left out are deactivated). Ids stay stable. Rules: at least one
 * non-ER level; names unique (ignoring case) and ranks unique among the list.
 * Errors on a row name the later of the two clashing rows.
 */
export function updateUrgencyLevels(
  input: UpdateUrgencyLevelsInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): { changed: boolean; levels: UrgencyLevel[] } {
  const at = now.toISOString();
  return unlessUnchanged(
    () =>
      withCommandTx(
        actor,
        AuditAction.SettingsUrgencyLevelsUpdated,
        (tx, audit) => {
          const current = selectActiveUrgencyLevels(tx);
          const byId = new Map(current.map((row) => [row.id, row]));

          for (const level of input.levels) {
            if (level.id !== undefined && !byId.has(level.id)) {
              throw new DomainError(
                ClinicalError.NotFound,
                "An Urgency Level in this list was removed meanwhile. Reload the page and try again.",
              );
            }
          }
          if (!input.levels.some((level) => !level.isEr)) {
            throw new DomainError(ClinicalError.NoNonErLevel, NO_NON_ER_LEVEL);
          }

          const fieldErrors: Record<string, string> = {};
          let firstCode: string | null = null;
          const names = new Set<string>();
          const ranks = new Set<number>();
          input.levels.forEach((level, i) => {
            const name = level.name.toLowerCase();
            if (names.has(name)) {
              fieldErrors[`levels.${i}.name`] = LEVEL_NAME_TAKEN;
              firstCode ??= ClinicalError.NameTaken;
            }
            names.add(name);
            if (level.rank !== null) {
              if (ranks.has(level.rank)) {
                fieldErrors[`levels.${i}.rank`] = RANK_TAKEN;
                firstCode ??= ClinicalError.RankTaken;
              }
              ranks.add(level.rank);
            }
          });
          if (firstCode) {
            const message = firstCode === ClinicalError.RankTaken ? RANK_TAKEN : LEVEL_NAME_TAKEN;
            throw new FieldDomainError(firstCode, message, fieldErrors);
          }

          const before = current.map(toUrgencyLevel).sort(compareUrgencyLevels);
          const keptIds = new Set(input.levels.map((level) => level.id).filter(Boolean));
          const removed = current.filter((row) => !keptIds.has(row.id));
          const edited: { row: UrgencyLevelRow; next: UrgencyLevel }[] = [];
          const added: UrgencyLevel[] = [];
          for (const level of input.levels) {
            const next: UrgencyLevel = {
              id: level.id ?? crypto.randomUUID(),
              name: level.name,
              isEr: level.isEr,
              rank: level.rank,
            };
            const row = level.id ? byId.get(level.id) : undefined;
            if (!row) added.push(next);
            else if (!sameLevel(toUrgencyLevel(row), next)) edited.push({ row, next });
          }
          if (removed.length === 0 && edited.length === 0 && added.length === 0) throw new Unchanged();

          // 1. Move every changing level out of the way of the unique active
          //    name and rank indexes, so levels can swap names or ranks.
          [...removed, ...edited.map((e) => e.row)].forEach((row, i) => {
            updateUrgencyLevelRow(tx, row.id, { name: `~${row.id}`, rank: row.isEr ? null : TEMP_RANK_BASE + i });
          });
          // 2. Removed levels leave the indexes; they keep their last values.
          for (const row of removed) {
            updateUrgencyLevelRow(tx, row.id, { name: row.name, rank: row.rank, deactivatedAt: at, updatedAt: at });
          }
          // 3. Final values, then the new levels.
          for (const { row, next } of edited) {
            updateUrgencyLevelRow(tx, row.id, { name: next.name, isEr: next.isEr, rank: next.rank, updatedAt: at });
          }
          for (const level of added) {
            insertUrgencyLevelRow(tx, { ...level, deactivatedAt: null, createdAt: at, updatedAt: at });
          }

          const after = urgencyLevels(tx);
          audit({ entity: "urgency_levels", entityId: null, changes: { levels: { old: before, new: after } } });
          return { levels: after };
        },
        db,
      ),
    () => ({ levels: urgencyLevels(db) }),
  );
}

/**
 * Turn a Priority Category on or off. Turning off a legally required one
 * (Senior Citizen, PWD) needs `confirmLegal: true`.
 */
export function setPriorityCategoryEnabled(
  input: SetPriorityCategoryEnabledInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): { changed: boolean; category: PriorityCategory } {
  const current = () => {
    const category = priorityCategories(db).find((c) => c.id === input.id);
    if (!category) throw new DomainError(ClinicalError.NotFound, "Priority Category not found.");
    return { category };
  };
  return unlessUnchanged(
    () =>
      withCommandTx(
        actor,
        AuditAction.SettingsPriorityCategoryUpdated,
        (tx, audit) => {
          const row = selectPriorityCategory(tx, input.id);
          if (!row) throw new DomainError(ClinicalError.NotFound, "Priority Category not found.");
          if (row.enabled === input.enabled) throw new Unchanged();
          if (row.legallyRequired && !input.enabled && input.confirmLegal !== true) {
            throw new DomainError(ClinicalError.ConfirmationRequired, LEGALLY_REQUIRED);
          }
          updatePriorityCategoryRow(tx, row.id, { enabled: input.enabled, updatedAt: now.toISOString() });
          audit({
            entity: "priority_category",
            entityId: row.id,
            changes: { enabled: { old: row.enabled, new: input.enabled } },
          });
          const category = priorityCategories(tx).find((c) => c.id === row.id)!;
          return { category };
        },
        db,
      ),
    current,
  );
}

/** Save an Animal Bite Center dose schedule (already validated: Day 0 first, increasing). */
export function updateClinicalSchedule(
  input: UpdateClinicalScheduleInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): { changed: boolean; schedule: ClinicalSchedule } {
  const current = () => {
    const row = selectClinicalSchedule(db, input.id);
    if (!row) throw new DomainError(ClinicalError.NotFound, "Schedule not found.");
    return { schedule: toClinicalSchedule(row) };
  };
  return unlessUnchanged(
    () =>
      withCommandTx(
        actor,
        AuditAction.SettingsScheduleUpdated,
        (tx, audit) => {
          const row = selectClinicalSchedule(tx, input.id);
          if (!row) throw new DomainError(ClinicalError.NotFound, "Schedule not found.");
          const old = toClinicalSchedule(row).days;
          if (JSON.stringify(old) === JSON.stringify(input.days)) throw new Unchanged();
          const updated = updateClinicalScheduleRow(tx, row.id, {
            days: JSON.stringify(input.days),
            updatedAt: now.toISOString(),
          });
          audit({ entity: "clinical_schedule", entityId: row.id, changes: { days: { old, new: input.days } } });
          return { schedule: toClinicalSchedule(updated) };
        },
        db,
      ),
    current,
  );
}

const THRESHOLD_KEYS = ["prenatalTarget", "noShowThreshold", "preCloseWarningMinutes", "hospitalName"] as const;

/**
 * Save the prenatal target, the No-show call threshold, the pre-close warning
 * and the hospital name printed on slips (kept when the input leaves it out).
 */
export function updateOpdThresholds(
  input: UpdateOpdThresholdsInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): { changed: boolean; thresholds: OpdThresholds } {
  return unlessUnchanged(
    () =>
      withCommandTx(
        actor,
        AuditAction.SettingsOpdThresholdsUpdated,
        (tx, audit) => {
          if (!selectOpdSettings(tx)) throw new DomainError(ClinicalError.NotFound, "OPD settings not found.");
          const old = opdThresholds(tx);
          const next: OpdThresholds = { ...input, hospitalName: input.hospitalName ?? old.hospitalName };
          const changes: Diff = {};
          for (const key of THRESHOLD_KEYS) {
            if (old[key] !== next[key]) changes[key] = { old: old[key], new: next[key] };
          }
          if (Object.keys(changes).length === 0) throw new Unchanged();
          updateOpdSettingsRow(tx, { ...next, updatedAt: now.toISOString() });
          audit({ entity: "opd_settings", entityId: "1", changes });
          return { thresholds: opdThresholds(tx) };
        },
        db,
      ),
    () => ({ thresholds: opdThresholds(db) }),
  );
}
