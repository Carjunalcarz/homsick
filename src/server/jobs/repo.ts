import "server-only";
import { and, eq, lte, ne } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { jobRuns, type JobRunStatus } from "./schema";

/** A failed key is retried on later ticks, up to this many tries in all. */
export const MAX_ATTEMPTS = 3;

/**
 * A failed key is not tried again until this long after its failure, so a
 * brief problem (a disk hiccup) doesn't use up every attempt in minutes.
 */
export const RETRY_DELAY_MS = 30 * 60 * 1000;

/**
 * A `running` row older than this was left by a process that stopped mid-run
 * (a single `next start` process, AD-1), so it may be claimed again.
 */
export const STALE_RUNNING_MS = 60 * 60 * 1000;

/** The error stored on a run that a stopped process left `running`. */
export const INTERRUPTED = "Interrupted";

export type Claim = { runId: string; attempt: number };

/**
 * Claim `(job, key)` for a run, in its own IMMEDIATE transaction so two
 * callers can never both win. Returns null when the key already succeeded,
 * is running, failed less than RETRY_DELAY_MS ago, or has used up
 * MAX_ATTEMPTS. Stale `running` rows of this job are resolved first: other
 * keys' are marked failed ("Interrupted"); this key's is claimed again, or
 * marked failed when its attempts are used up. Bookkeeping, not an audited
 * command: the run's outcome is audited when it finishes.
 */
export function claimRun(db: Db, job: string, key: string, opdDate: string, now: Date): Claim | null {
  return db.transaction(
    (tx) => {
      const startedAt = now.toISOString();
      const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
      tx.update(jobRuns)
        .set({ status: "failed", finishedAt: startedAt, error: INTERRUPTED })
        .where(
          and(eq(jobRuns.job, job), ne(jobRuns.key, key), eq(jobRuns.status, "running"), lte(jobRuns.startedAt, staleBefore)),
        )
        .run();

      const row = tx
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.job, job), eq(jobRuns.key, key)))
        .get();
      if (!row) {
        const runId = crypto.randomUUID();
        tx.insert(jobRuns).values({ id: runId, job, key, opdDate, status: "running", attempts: 1, startedAt }).run();
        return { runId, attempt: 1 };
      }
      if (row.status === "ok") return null;
      if (row.status === "running") {
        if (row.startedAt > staleBefore) return null;
        if (row.attempts >= MAX_ATTEMPTS) {
          tx.update(jobRuns)
            .set({ status: "failed", finishedAt: startedAt, error: INTERRUPTED })
            .where(eq(jobRuns.id, row.id))
            .run();
          return null;
        }
      } else {
        if (row.attempts >= MAX_ATTEMPTS) return null;
        if (row.finishedAt && now.getTime() - Date.parse(row.finishedAt) < RETRY_DELAY_MS) return null;
      }
      const attempt = row.attempts + 1;
      tx.update(jobRuns)
        .set({ status: "running", attempts: attempt, startedAt, finishedAt: null, error: null })
        .where(eq(jobRuns.id, row.id))
        .run();
      return { runId: row.id, attempt };
    },
    { behavior: "immediate" },
  );
}

/** Record how a claimed run ended, inside the outcome command's transaction. */
export function finishRun(
  tx: Tx,
  runId: string,
  status: Exclude<JobRunStatus, "running">,
  finishedAt: Date,
  error: string | null = null,
): void {
  tx.update(jobRuns).set({ status, finishedAt: finishedAt.toISOString(), error }).where(eq(jobRuns.id, runId)).run();
}
