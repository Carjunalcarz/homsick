import "server-only";
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
// Relative: drizzle-kit reads this file without the `@/` alias.
import { VISIT_STATUSES } from "../../lib/visit-status";
// The foreign key only: the visits code never reads or writes patients (AD-2).
import { patients } from "../patients/schema";

/**
 * Visits (FR-7, Story 3.4), owned by the `visits` module. Only the visits
 * service sets `status`, through the transition table in `state.ts`.
 *
 * - `opd_date` is the Manila OPD day, written once from `opdDate()` when the
 *   Visit opens.
 * - A patient has at most one active (`open` or `in_queue`) Visit per OPD
 *   day: `visits_one_active_unique`.
 * - Timestamps are UTC ISO text; `closed_at` is set on a terminal status.
 */
export const visits = sqliteTable(
  "visits",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    opdDate: text("opd_date").notNull(),
    status: text("status", { enum: VISIT_STATUSES }).notNull(),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("visits_patient_idx").on(table.patientId, table.opdDate),
    index("visits_opd_date_status_idx").on(table.opdDate, table.status),
    uniqueIndex("visits_one_active_unique")
      .on(table.patientId, table.opdDate)
      .where(sql`${table.status} in ('open', 'in_queue')`),
    check(
      "visits_status_check",
      sql`${table.status} in ('open', 'in_queue', 'completed', 'directed_to_er', 'no_show', 'cancelled')`,
    ),
    check("visits_opd_date_check", sql`${table.opdDate} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`),
  ],
);

export type VisitRow = typeof visits.$inferSelect;
export type NewVisitRow = typeof visits.$inferInsert;
