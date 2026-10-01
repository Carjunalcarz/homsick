import "server-only";
import type { AuditAction } from "@/server/audit/schema";
import type { Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";

/** What a job run gets from the scheduler. */
export type JobContext = {
  db: Db;
  /** The tick's time (injected in tests). */
  now: Date;
  key: string;
  /** The Manila OPD day the key belongs to. */
  opdDate: string;
  runId: string;
  /** 1 for the first try of this key, up to MAX_ATTEMPTS. */
  attempt: number;
  backupDir: string;
};

/**
 * The part of a run that commits: it runs inside the success command's
 * transaction (with the `job_runs` update and the audit row) and returns the
 * fields to audit. Synchronous, like every command.
 */
export type JobCommit = (tx: Tx) => Record<string, unknown>;

export type JobDefinition = {
  /** Stored in `job_runs.job`. */
  name: string;
  /** The `system` actor's name on the audit rows. */
  actorName: string;
  /** When the job is due each OPD day, in minutes after Manila midnight. */
  dueMinutes: number;
  /** The run key for an OPD day (UNIQUE with the job name). */
  key: (opdDate: string) => string;
  successAction: AuditAction;
  failureAction: AuditAction;
  /**
   * Do the work that can't be in a transaction (e.g. `VACUUM INTO`), then
   * return the commit step. Throwing records a failed attempt.
   */
  run: (ctx: JobContext) => JobCommit | Promise<JobCommit>;
};
