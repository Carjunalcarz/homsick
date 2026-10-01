import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { BACKUP_JOB } from "./names";
import { jobRuns, type JobRunStatus } from "./schema";

/** Whether migration `0007_job_runs` has run (health must work before it). */
export function jobRunsTableExists(db: Db = getDb()): boolean {
  return Boolean(
    db.get<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'job_runs'`),
  );
}

/** When the last successful nightly backup finished (UTC ISO), or null. */
export function lastBackupAt(db: Db = getDb()): string | null {
  if (!jobRunsTableExists(db)) return null;
  const row = db
    .select({ finishedAt: jobRuns.finishedAt })
    .from(jobRuns)
    .where(and(eq(jobRuns.job, BACKUP_JOB), eq(jobRuns.status, "ok")))
    .orderBy(desc(jobRuns.finishedAt))
    .limit(1)
    .get();
  return row?.finishedAt ?? null;
}

/** A nightly backup is overdue when the last good one finished longer ago than this. */
export const BACKUP_STALE_MS = 26 * 60 * 60 * 1000;

/** Whether there is no successful backup, or the last one is older than BACKUP_STALE_MS. */
export function isBackupStale(lastBackup: string | null, now: Date = new Date()): boolean {
  if (!lastBackup) return true;
  return now.getTime() - Date.parse(lastBackup) > BACKUP_STALE_MS;
}

export type LatestRun = { job: string; key: string; status: JobRunStatus; finishedAt: string | null };

/** The latest run (by start time) of each job, sorted by job name. */
export function latestRuns(db: Db = getDb()): LatestRun[] {
  if (!jobRunsTableExists(db)) return [];
  return db.all<LatestRun>(sql`
    select job, key, status, finished_at as finishedAt
    from (
      select job, key, status, finished_at,
        row_number() over (partition by job order by started_at desc, rowid desc) as rn
      from job_runs
    )
    where rn = 1
    order by job
  `);
}
