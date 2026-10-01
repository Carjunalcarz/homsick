import "server-only";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * OPD Facilities (FR23), owned by the `settings` module (AD-2). Other modules
 * read them only through `settings/queries.ts`. The defaults are seeded by the
 * `0003_facilities` migration; there is no Facility list anywhere else.
 *
 * - `prefix` is today's Queue Number prefix. A change is stored as
 *   `next_prefix` + `next_prefix_from` (an OPD date) and takes effect that day
 *   (see `effectivePrefix`).
 * - `open_days` is a JSON array of ISO weekdays (1 = Monday … 7 = Sunday).
 * - `open_time` / `close_time` are Manila `HH:MM`; open is `[open, close)`.
 * - Nothing is deleted: `deactivated_at` (UTC ISO) marks a deactivated one.
 */
export const facilities = sqliteTable(
  "facilities",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    nextPrefix: text("next_prefix"),
    nextPrefixFrom: text("next_prefix_from"),
    openDays: text("open_days").notNull(),
    openTime: text("open_time").notNull(),
    closeTime: text("close_time").notNull(),
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    deactivatedAt: text("deactivated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // Case-insensitive, like the service's check (0004).
    uniqueIndex("facilities_active_name_unique")
      .on(sql`${table.name} collate nocase`)
      .where(sql`${table.deactivatedAt} is null`),
    check("facilities_prefix_check", sql`${table.prefix} glob '[A-Z][A-Z]' or ${table.prefix} glob '[A-Z][A-Z][A-Z]'`),
    check(
      "facilities_next_prefix_check",
      sql`(${table.nextPrefix} is null and ${table.nextPrefixFrom} is null) or (${table.nextPrefix} is not null and ${table.nextPrefixFrom} is not null)`,
    ),
    check(
      "facilities_next_prefix_shape_check",
      sql`${table.nextPrefix} is null or ${table.nextPrefix} glob '[A-Z][A-Z]' or ${table.nextPrefix} glob '[A-Z][A-Z][A-Z]'`,
    ),
    check(
      "facilities_next_prefix_from_check",
      sql`${table.nextPrefixFrom} is null or ${table.nextPrefixFrom} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`,
    ),
    check("facilities_open_days_check", sql`json_valid(${table.openDays})`),
    check(
      "facilities_times_check",
      sql`${table.openTime} glob '[0-2][0-9]:[0-5][0-9]' and ${table.closeTime} glob '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check("facilities_hours_check", sql`${table.closeTime} > ${table.openTime}`),
  ],
);

export type FacilityRow = typeof facilities.$inferSelect;

/*
 * Clinical settings (FR-24), seeded by `0006_clinical_settings` with the PRD
 * defaults. Read them only through the getters in `settings/queries.ts`.
 * Changes apply to new entries only: nothing stored elsewhere is rewritten.
 */

/**
 * Urgency Levels. ER levels have no rank (they are seen first, at the ER);
 * the others have a unique rank of 1 or more, lower served first. Removing a
 * level sets `deactivated_at`; ids never change, so snapshots (AD-6) keep
 * pointing at the same level.
 */
export const urgencyLevels = sqliteTable(
  "urgency_levels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    isEr: integer("is_er", { mode: "boolean" }).notNull().default(false),
    rank: integer("rank"),
    deactivatedAt: text("deactivated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("urgency_levels_active_rank_unique")
      .on(table.rank)
      .where(sql`${table.deactivatedAt} is null`),
    uniqueIndex("urgency_levels_active_name_unique")
      .on(sql`${table.name} collate nocase`)
      .where(sql`${table.deactivatedAt} is null`),
    check(
      "urgency_levels_rank_check",
      sql`(${table.isEr} = 1 and ${table.rank} is null) or (${table.isEr} = 0 and ${table.rank} is not null and ${table.rank} >= 1)`,
    ),
  ],
);

export type UrgencyLevelRow = typeof urgencyLevels.$inferSelect;

/**
 * Priority Categories: a fixed set (Senior Citizen RA 9994, PWD RA 10754,
 * Pregnant hospital policy). Only `enabled` is editable.
 */
export const priorityCategories = sqliteTable(
  "priority_categories",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    legalBasis: text("legal_basis").notNull(),
    legallyRequired: integer("legally_required", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("priority_categories_code_unique").on(table.code)],
);

export type PriorityCategoryRow = typeof priorityCategories.$inferSelect;

/**
 * Dose schedules. Only the Animal Bite Center's two exist (new patient,
 * previously immunized). `days` is a JSON array of whole days from Day 0.
 */
export const clinicalSchedules = sqliteTable(
  "clinical_schedules",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    days: text("days").notNull(),
    sortOrder: integer("sort_order").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("clinical_schedules_code_unique").on(table.code),
    check("clinical_schedules_days_check", sql`json_valid(${table.days}) and json_type(${table.days}) = 'array'`),
  ],
);

export type ClinicalScheduleRow = typeof clinicalSchedules.$inferSelect;

/** The single row of OPD thresholds. */
export const opdSettings = sqliteTable(
  "opd_settings",
  {
    id: integer("id").primaryKey(),
    prenatalTarget: integer("prenatal_target").notNull(),
    noShowThreshold: integer("no_show_threshold").notNull(),
    preCloseWarningMinutes: integer("pre_close_warning_minutes").notNull(),
    /** Printed at the top of each queue slip (Story 3.6); 2–80 characters. */
    hospitalName: text("hospital_name").notNull().default("Hospital OPD"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("opd_settings_single_row_check", sql`${table.id} = 1`),
    check("opd_settings_hospital_name_check", sql`length(trim(${table.hospitalName})) between 2 and 80`),
    check("opd_settings_prenatal_target_check", sql`${table.prenatalTarget} between 1 and 20`),
    check("opd_settings_no_show_threshold_check", sql`${table.noShowThreshold} between 1 and 10`),
    check("opd_settings_pre_close_warning_check", sql`${table.preCloseWarningMinutes} between 0 and 120`),
  ],
);

export type OpdSettingsRow = typeof opdSettings.$inferSelect;
