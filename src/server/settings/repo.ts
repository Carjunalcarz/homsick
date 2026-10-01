import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import {
  clinicalSchedules,
  facilities,
  opdSettings,
  priorityCategories,
  urgencyLevels,
  type ClinicalScheduleRow,
  type FacilityRow,
  type OpdSettingsRow,
  type PriorityCategoryRow,
  type UrgencyLevelRow,
} from "./schema";

/** Raw access to the settings tables. Only the settings module calls these. */
type Reader = Db | Tx;

export function selectAllFacilities(db: Reader): FacilityRow[] {
  return db.select().from(facilities).orderBy(asc(facilities.sortOrder), asc(facilities.name)).all();
}

export function selectFacility(db: Reader, id: string): FacilityRow | undefined {
  return db.select().from(facilities).where(eq(facilities.id, id)).get();
}

export function updateFacilityRow(
  tx: Tx,
  id: string,
  values: Partial<Omit<FacilityRow, "id" | "createdAt">>,
): FacilityRow {
  const row = tx.update(facilities).set(values).where(eq(facilities.id, id)).returning().get();
  if (!row) throw new Error(`updateFacilityRow: Facility ${id} disappeared`);
  return row;
}

/* Clinical settings (Story 2.6). */

export function selectActiveUrgencyLevels(db: Reader): UrgencyLevelRow[] {
  return db.select().from(urgencyLevels).where(isNull(urgencyLevels.deactivatedAt)).all();
}

export function updateUrgencyLevelRow(
  tx: Tx,
  id: string,
  values: Partial<Omit<UrgencyLevelRow, "id" | "createdAt">>,
): void {
  tx.update(urgencyLevels).set(values).where(eq(urgencyLevels.id, id)).run();
}

export function insertUrgencyLevelRow(tx: Tx, row: UrgencyLevelRow): void {
  tx.insert(urgencyLevels).values(row).run();
}

export function selectPriorityCategories(db: Reader): PriorityCategoryRow[] {
  return db.select().from(priorityCategories).orderBy(asc(priorityCategories.sortOrder)).all();
}

export function selectPriorityCategory(db: Reader, id: string): PriorityCategoryRow | undefined {
  return db.select().from(priorityCategories).where(eq(priorityCategories.id, id)).get();
}

export function updatePriorityCategoryRow(
  tx: Tx,
  id: string,
  values: Partial<Pick<PriorityCategoryRow, "enabled" | "updatedAt">>,
): PriorityCategoryRow {
  const row = tx.update(priorityCategories).set(values).where(eq(priorityCategories.id, id)).returning().get();
  if (!row) throw new Error(`updatePriorityCategoryRow: ${id} disappeared`);
  return row;
}

export function selectClinicalSchedules(db: Reader): ClinicalScheduleRow[] {
  return db.select().from(clinicalSchedules).orderBy(asc(clinicalSchedules.sortOrder)).all();
}

export function selectClinicalSchedule(db: Reader, id: string): ClinicalScheduleRow | undefined {
  return db.select().from(clinicalSchedules).where(eq(clinicalSchedules.id, id)).get();
}

export function selectClinicalScheduleByCode(db: Reader, code: string): ClinicalScheduleRow | undefined {
  return db.select().from(clinicalSchedules).where(eq(clinicalSchedules.code, code)).get();
}

export function updateClinicalScheduleRow(
  tx: Tx,
  id: string,
  values: Pick<ClinicalScheduleRow, "days" | "updatedAt">,
): ClinicalScheduleRow {
  const row = tx.update(clinicalSchedules).set(values).where(eq(clinicalSchedules.id, id)).returning().get();
  if (!row) throw new Error(`updateClinicalScheduleRow: ${id} disappeared`);
  return row;
}

export function selectOpdSettings(db: Reader): OpdSettingsRow | undefined {
  return db.select().from(opdSettings).where(eq(opdSettings.id, 1)).get();
}

export function updateOpdSettingsRow(tx: Tx, values: Omit<OpdSettingsRow, "id">): OpdSettingsRow {
  const row = tx.update(opdSettings).set(values).where(eq(opdSettings.id, 1)).returning().get();
  if (!row) throw new Error("updateOpdSettingsRow: the opd_settings row is missing");
  return row;
}
