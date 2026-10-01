import "server-only";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
// Relative: drizzle-kit reads this file without the `@/` alias.
import { QUEUE_STATUSES } from "../../lib/queue-number";
// Foreign keys only: queue reads Facilities and Urgency Levels through settings, Visits through visits.
import { facilities, urgencyLevels } from "../settings/schema";
import { visits } from "../visits/schema";

/**
 * The last Queue Number sequence issued per Facility per OPD day, owned by
 * `queue`. Only `nextSeq()` (repo.ts) touches it, inside the issuing command.
 */
export const queueCounters = sqliteTable(
  "queue_counters",
  {
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    opdDate: text("opd_date").notNull(),
    lastSeq: integer("last_seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.facilityId, table.opdDate] }),
    check("queue_counters_seq_check", sql`${table.lastSeq} >= 0`),
    check("queue_counters_opd_date_check", sql`${table.opdDate} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`),
  ],
);

/**
 * Queue Entries (FR-8, FR-9, Story 3.5), owned by `queue`. One per queued
 * Visit and Facility. The priority snapshot (AD-6) is copied from the Triage
 * Record, so a later settings change never reorders an entry. The label is
 * always `formatQueueNumber(prefix, seq)`.
 *
 * - `seq` is unique per Facility per OPD day (`queue_entries_seq_unique`).
 * - `prefix` is `effectivePrefix()` at issue time: a pending prefix change
 *   never relabels today's entries.
 * - Ordering: only `liveQueue()` (repo.ts) reads a queue, by
 *   `sort_group, urgency_rank, entered_at, id`.
 */
export const queueEntries = sqliteTable(
  "queue_entries",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    opdDate: text("opd_date").notNull(),
    prefix: text("prefix").notNull(),
    seq: integer("seq").notNull(),
    status: text("status", { enum: QUEUE_STATUSES }).notNull().default("waiting"),
    sortGroup: integer("sort_group").notNull(),
    urgencyRank: integer("urgency_rank").notNull(),
    urgencyLevelId: text("urgency_level_id")
      .notNull()
      .references(() => urgencyLevels.id),
    priorityCategory: text("priority_category"),
    enteredAt: text("entered_at").notNull(),
    callCount: integer("call_count").notNull().default(0),
    isPaper: integer("is_paper", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("queue_entries_seq_unique").on(table.facilityId, table.opdDate, table.seq),
    index("queue_entries_live_idx").on(table.facilityId, table.opdDate, table.status),
    index("queue_entries_visit_idx").on(table.visitId),
    // waitingCounts(opdDate) groups a whole day across Facilities.
    index("queue_entries_day_status_idx").on(table.opdDate, table.status),
    check(
      "queue_entries_status_check",
      sql`${table.status} in ('waiting', 'called', 'serving', 'completed', 'referred', 'no_show', 'cancelled')`,
    ),
    check("queue_entries_sort_group_check", sql`${table.sortGroup} in (1, 2, 3)`),
    check("queue_entries_urgency_rank_check", sql`${table.urgencyRank} >= 1`),
    check("queue_entries_seq_check", sql`${table.seq} >= 1`),
    check("queue_entries_call_count_check", sql`${table.callCount} >= 0`),
    check("queue_entries_prefix_check", sql`${table.prefix} glob '[A-Z][A-Z]' or ${table.prefix} glob '[A-Z][A-Z][A-Z]'`),
    check("queue_entries_opd_date_check", sql`${table.opdDate} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`),
  ],
);

export type QueueEntryRow = typeof queueEntries.$inferSelect;
export type NewQueueEntryRow = typeof queueEntries.$inferInsert;
