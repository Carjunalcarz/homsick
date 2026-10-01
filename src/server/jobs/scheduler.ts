import "server-only";
import type { Actor } from "@/server/audit/service";
import { getDb, type Db } from "@/server/db/client";
import { withCommandTx } from "@/server/db/tx";
import { getEnv } from "@/server/env";
import { addOpdDays, manilaMinutes, opdDate } from "@/lib/time";
import { jobRunsTableExists } from "./queries";
import { JOBS } from "./registry";
import { claimRun, finishRun, type Claim } from "./repo";
import type { JobDefinition } from "./types";

/**
 * The one in-process scheduler (AD-14). `startScheduler()` is called once from
 * `src/instrumentation.ts`; it ticks every TICK_MS and once right after start
 * (catch-up). Each tick runs `runDueJobs(now)`: for every job, only the
 * latest due key is considered, so after downtime a job catches up once, not
 * once per missed day.
 */
export const TICK_MS = 60_000;

/** The longest error message kept on `job_runs` and the audit row. */
const MAX_ERROR_LENGTH = 500;

export type JobDeps = {
  db: Db;
  backupDir: string;
  jobs?: readonly JobDefinition[];
  /** When runs finish; defaults to the real clock. */
  clock?: () => Date;
};

export type JobResult = {
  job: string;
  key: string;
  outcome: "ok" | "failed" | "skipped";
  attempt?: number;
  error?: string;
};

/**
 * The OPD day of the latest key that is due at `now` for a job due at
 * `dueMinutes` after Manila midnight: today once the time has passed,
 * otherwise yesterday.
 */
export function latestDueOpdDate(now: Date, dueMinutes: number): string {
  const today = opdDate(now);
  return manilaMinutes(now) >= dueMinutes ? today : addOpdDays(today, -1);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

/** Run one job's latest due key if it can be claimed. */
export async function runJob(job: JobDefinition, now: Date, deps: JobDeps): Promise<JobResult> {
  const { db, backupDir } = deps;
  const clock = deps.clock ?? (() => new Date());
  const day = latestDueOpdDate(now, job.dueMinutes);
  const key = job.key(day);
  let claim: Claim | null;
  try {
    claim = claimRun(db, job.name, key, day, now);
  } catch (error) {
    // Nothing was claimed (e.g. SQLITE_BUSY), so there is no run to audit:
    // report it and let the other jobs run this tick.
    return { job: job.name, key, outcome: "failed", error: errorMessage(error) };
  }
  if (!claim) return { job: job.name, key, outcome: "skipped" };

  const actor: Actor = { type: "system", name: job.actorName };
  const base = { job: job.name, key, attempt: claim.attempt };
  try {
    const commit = await job.run({ db, now, key, opdDate: day, runId: claim.runId, attempt: claim.attempt, backupDir });
    withCommandTx(
      actor,
      job.successAction,
      (tx, audit) => {
        const changes = commit(tx);
        const finishedAt = clock();
        finishRun(tx, claim.runId, "ok", finishedAt);
        audit({ entity: "job_run", entityId: claim.runId, changes: { ...base, ...changes }, at: finishedAt });
      },
      db,
    );
    return { ...base, outcome: "ok" };
  } catch (error) {
    // The message only: never the data the job was working on.
    const message = errorMessage(error);
    try {
      withCommandTx(
        actor,
        job.failureAction,
        (tx, audit) => {
          const finishedAt = clock();
          finishRun(tx, claim.runId, "failed", finishedAt, message);
          audit({ entity: "job_run", entityId: claim.runId, changes: { ...base, error: message }, at: finishedAt });
        },
        db,
      );
    } catch (recordError) {
      console.error(`Job ${job.name} ${key}: could not record the failure: ${errorMessage(recordError)}`);
    }
    return { ...base, outcome: "failed", error: message };
  }
}

/**
 * Run every job whose latest due key hasn't succeeded yet (one after another).
 * Does nothing until migration `0007_job_runs` has run.
 */
export async function runDueJobs(now: Date, deps: JobDeps): Promise<JobResult[]> {
  if (!jobRunsTableExists(deps.db)) return [];
  const results: JobResult[] = [];
  for (const job of deps.jobs ?? JOBS) {
    results.push(await runJob(job, now, deps));
  }
  return results;
}

export type SchedulerOptions = {
  /** Resolved on every tick; defaults to the app's database and BACKUP_DIR. */
  deps?: () => JobDeps;
  now?: () => Date;
  intervalMs?: number;
};

export type Scheduler = {
  /** Run one tick now; resolves when it ends. A tick never overlaps another. */
  tick: () => Promise<void>;
  stop: () => void;
};

// On globalThis, so a dev hot reload never starts a second scheduler.
const globalForScheduler = globalThis as unknown as { __opdScheduler?: Scheduler };

/** Start the scheduler, or return the one already running in this process. */
export function startScheduler(options: SchedulerOptions = {}): Scheduler {
  if (globalForScheduler.__opdScheduler) return globalForScheduler.__opdScheduler;

  const resolveDeps = options.deps ?? (() => ({ db: getDb(), backupDir: getEnv().BACKUP_DIR }));
  const now = options.now ?? (() => new Date());
  let running: Promise<void> | null = null;

  const runTick = async () => {
    try {
      for (const result of await runDueJobs(now(), resolveDeps())) {
        if (result.outcome === "ok") console.log(`Job ${result.job} ${result.key}: ok`);
        if (result.outcome === "failed") {
          const attempt = result.attempt ? ` (attempt ${result.attempt})` : " (not claimed)";
          console.error(`Job ${result.job} ${result.key}: failed${attempt}: ${result.error}`);
        }
      }
    } catch (error) {
      console.error(`Scheduler tick failed: ${errorMessage(error)}`);
    }
  };

  const tick = () => {
    if (running) return running;
    running = runTick().finally(() => {
      running = null;
    });
    return running;
  };

  const interval = setInterval(() => void tick(), options.intervalMs ?? TICK_MS);
  interval.unref();
  // Catch-up right after start, without holding up register().
  const first = setTimeout(() => void tick(), 0);
  first.unref();

  const scheduler: Scheduler = {
    tick,
    stop: () => {
      clearInterval(interval);
      clearTimeout(first);
    },
  };
  globalForScheduler.__opdScheduler = scheduler;
  return scheduler;
}

/** Stop the running scheduler (tests). */
export function stopScheduler() {
  globalForScheduler.__opdScheduler?.stop();
  globalForScheduler.__opdScheduler = undefined;
}
