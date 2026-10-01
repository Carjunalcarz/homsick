import "server-only";
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
// Foreign keys only: triage reads patients, Visits and settings through their owners.
import { patients } from "../patients/schema";
import { facilities, urgencyLevels } from "../settings/schema";
import { visits } from "../visits/schema";

/** Kept in step with `PRIORITY_ID_STATUSES` in `src/lib/triage.ts` (drizzle-kit reads this file without the `@/` alias). */
export const priorityIdStatuses = ["on_file", "entered", "not_presented"] as const;
/** Kept in step with `URGENCY_TONES` in `src/lib/triage.ts`. */
export const urgencyTones = ["urgent", "abnormal", "routine"] as const;

/**
 * Triage Records (FR-7, Story 3.4), owned by the `triage` module: one per
 * Visit, never edited. The Urgency Level and Priority Category are a
 * snapshot taken at save time (AD-6), so a later settings change never
 * reorders or relabels an entry.
 *
 * - `sort_group`: 1 more urgent than the lowest non-ER rank, 2 lowest rank
 *   with an enabled Priority Category, 3 everyone else; null for an ER level.
 * - `abnormal_fields`: a JSON array of the Vital Sign keys flagged abnormal.
 * - `priority_id_status`: for Senior Citizen and PWD only; null otherwise.
 */
export const triageRecords = sqliteTable(
  "triage_records",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    chiefComplaint: text("chief_complaint").notNull(),
    temperatureC: real("temperature_c").notNull(),
    bpSystolic: integer("bp_systolic").notNull(),
    bpDiastolic: integer("bp_diastolic").notNull(),
    pulse: integer("pulse").notNull(),
    respiratoryRate: integer("respiratory_rate").notNull(),
    spo2: integer("spo2"),
    weightKg: real("weight_kg"),
    abnormalFields: text("abnormal_fields").notNull().default("[]"),
    urgencyLevelId: text("urgency_level_id")
      .notNull()
      .references(() => urgencyLevels.id),
    urgencyName: text("urgency_name").notNull(),
    urgencyRank: integer("urgency_rank"),
    urgencyIsEr: integer("urgency_is_er", { mode: "boolean" }).notNull(),
    /** The badge tone at save time (`urgencyTone()`), so a later settings change never recolours the Visit. */
    urgencyTone: text("urgency_tone", { enum: urgencyTones }).notNull().default("routine"),
    sortGroup: integer("sort_group"),
    priorityCategory: text("priority_category"),
    priorityIdStatus: text("priority_id_status", { enum: priorityIdStatuses }),
    /** The not-live Facility the patient was given a paper number for (Story 3.5), or null. */
    paperFacilityId: text("paper_facility_id").references(() => facilities.id),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    uniqueIndex("triage_records_visit_unique").on(table.visitId),
    index("triage_records_patient_idx").on(table.patientId),
    check(
      "triage_records_complaint_check",
      sql`length(trim(${table.chiefComplaint})) between 1 and 500`,
    ),
    check(
      "triage_records_abnormal_fields_check",
      sql`json_valid(${table.abnormalFields}) and json_type(${table.abnormalFields}) = 'array'`,
    ),
    check(
      "triage_records_snapshot_check",
      sql`(${table.urgencyIsEr} = 1 and ${table.urgencyRank} is null and ${table.sortGroup} is null) or (${table.urgencyIsEr} = 0 and ${table.urgencyRank} is not null and ${table.sortGroup} in (1, 2, 3))`,
    ),
    check("triage_records_urgency_tone_check", sql`${table.urgencyTone} in ('urgent', 'abnormal', 'routine')`),
    check(
      "triage_records_priority_id_status_check",
      sql`${table.priorityIdStatus} is null or ${table.priorityIdStatus} in ('on_file', 'entered', 'not_presented')`,
    ),
  ],
);

export type TriageRecordRow = typeof triageRecords.$inferSelect;
export type NewTriageRecordRow = typeof triageRecords.$inferInsert;
