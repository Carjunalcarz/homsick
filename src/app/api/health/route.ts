import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { isBackupStale, lastBackupAt, latestRuns, type LatestRun } from "@/server/jobs/queries";

/**
 * Liveness for monitoring: is the database answering, when did the last
 * nightly backup finish, and how did each scheduled job last run? Carries no
 * user or patient data. Reachable signed out (excluded in proxy.ts).
 */
export async function GET() {
  await connection();
  const time = new Date().toISOString();
  let up = false;
  let lastBackup: string | null = null;
  let jobs: LatestRun[] = [];
  try {
    const db = getDb();
    // Opening a missing file creates an empty database, so "select 1" alone
    // isn't enough: the migrations must have run.
    const tables = db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name in ('__drizzle_migrations', 'audit_log')`,
      )
      .map((row) => row.name);
    up = tables.includes("__drizzle_migrations") && tables.includes("audit_log");
    if (up) {
      // Job state is extra: a problem reading it never marks the database down.
      try {
        lastBackup = lastBackupAt(db);
        jobs = latestRuns(db);
      } catch {
        lastBackup = null;
        jobs = [];
      }
    }
  } catch {
    up = false;
  }
  // Reported, not a failure: the status code only says whether the database answers.
  const backupStale = isBackupStale(lastBackup, new Date(time));
  return Response.json(
    { ok: up, db: up ? "up" : "down", time, lastBackupAt: lastBackup, backupStale, jobs },
    { status: up ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
