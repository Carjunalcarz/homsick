import "server-only";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const jobRunStatuses = ["running", "ok", "failed"] as const;
export type JobRunStatus = (typeof jobRunStatuses)[number];

/**
 * One row per scheduled job run key (Story 2.8, AD-14), owned by `jobs`.
 * UNIQUE(job, key) makes each key run at most once successfully; a failed key
 * is retried in place (`attempts` counts the tries). Timestamps are UTC
 * ISO-8601 text; `opd_date` is the Manila OPD day the key belongs to.
 */
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    job: text("job").notNull(),
    key: text("key").notNull(),
    opdDate: text("opd_date").notNull(),
    status: text("status", { enum: jobRunStatuses }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    error: text("error"),
  },
  (table) => [
    unique("job_runs_job_key_unique").on(table.job, table.key),
    check("job_runs_status_check", sql`${table.status} in ('running', 'ok', 'failed')`),
    index("job_runs_job_started_at_idx").on(table.job, table.startedAt),
  ],
);

export type JobRun = typeof jobRuns.$inferSelect;
