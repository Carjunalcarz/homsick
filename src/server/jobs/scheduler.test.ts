import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "@/server/audit/schema";
import { rateLimits } from "@/server/auth/schema";
import { openDatabase, type Db } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { backupJob } from "./backup-job";
import { lastBackupAt, latestRuns } from "./queries";
import { rateLimitPurgeJob } from "./rate-limit-job";
import { claimRun, INTERRUPTED, MAX_ATTEMPTS, RETRY_DELAY_MS, STALE_RUNNING_MS } from "./repo";
import { latestDueOpdDate, runDueJobs, startScheduler, stopScheduler, type JobDeps } from "./scheduler";
import { jobRuns } from "./schema";
import type { JobDefinition } from "./types";

// pruneBackups can be made to fail, to test that the backup still succeeds.
const stubs = vi.hoisted(() => ({ pruneError: null as string | null }));
vi.mock("@/server/db/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db/backup")>();
  return {
    ...actual,
    pruneBackups: (...args: Parameters<typeof actual.pruneBackups>) => {
      if (stubs.pruneError) throw new Error(stubs.pruneError);
      return actual.pruneBackups(...args);
    },
  };
});

/** A Manila wall-clock time as a Date (Manila is UTC+8, no DST). */
const manila = (local: string) => new Date(`${local}+08:00`);

let t: TestDb;
let backupDir: string;
let deps: JobDeps;

beforeEach(() => {
  t = createTestDb();
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-jobs-"));
  deps = { db: t.db, backupDir, jobs: [backupJob], clock: () => new Date("2026-09-27T18:06:00.000Z") };
});

afterEach(() => {
  stubs.pruneError = null;
  stopScheduler();
  t.cleanup();
  fs.rmSync(backupDir, { recursive: true, force: true });
});

const runs = (db: Db = t.db) => db.select().from(jobRuns).all();
const jobAudit = (db: Db = t.db) =>
  db.select().from(auditLog).where(eq(auditLog.entity, "job_run")).all();
const files = () => fs.readdirSync(backupDir).sort();
/** One tick at a Manila time, with runs finishing at that time too. */
const tickAt = (local: string, d: JobDeps = deps) => {
  const now = manila(local);
  return runDueJobs(now, { ...d, clock: () => now });
};
/** Insert a job_runs row as a stopped process would have left it. */
function insertRun(row: Partial<typeof jobRuns.$inferInsert> & { key: string }) {
  t.db.insert(jobRuns)
    .values({ id: crypto.randomUUID(), job: "backup", opdDate: row.key, status: "running", startedAt: "", ...row })
    .run();
}

describe("latestDueOpdDate", () => {
  it("switches to today exactly at 02:00 Manila", () => {
    expect(latestDueOpdDate(manila("2026-09-28T01:59:59"), 120)).toBe("2026-09-27");
    expect(latestDueOpdDate(manila("2026-09-28T02:00:00"), 120)).toBe("2026-09-28");
    // 02:00 Manila is 18:00 UTC the day before.
    expect(latestDueOpdDate(new Date("2026-09-27T18:00:00Z"), 120)).toBe("2026-09-28");
    expect(latestDueOpdDate(new Date("2026-09-27T17:59:00Z"), 120)).toBe("2026-09-27");
  });
});

describe("nightly backup", () => {
  it("writes one file, marks the run ok and writes one audit row (02:05 Manila)", async () => {
    const results = await runDueJobs(manila("2026-09-28T02:05:00"), deps);
    expect(results).toEqual([{ job: "backup", key: "2026-09-28", attempt: 1, outcome: "ok" }]);
    expect(files()).toEqual(["opd-2026-09-28.sqlite"]);

    const [run] = runs();
    expect(run).toMatchObject({
      job: "backup",
      key: "2026-09-28",
      opdDate: "2026-09-28",
      status: "ok",
      attempts: 1,
      finishedAt: "2026-09-27T18:06:00.000Z",
      error: null,
    });
    const rows = jobAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "system",
      actorName: "backup job",
      action: "jobs.backup_completed",
      entity: "job_run",
      entityId: run!.id,
    });
    expect(JSON.parse(rows[0]!.changes!)).toMatchObject({
      job: "backup",
      key: "2026-09-28",
      attempt: 1,
      file: "opd-2026-09-28.sqlite",
      pruned: 0,
    });
    expect(lastBackupAt(t.db)).toBe("2026-09-27T18:06:00.000Z");
  });

  it("does nothing when the key already succeeded (02:06)", async () => {
    await runDueJobs(manila("2026-09-28T02:05:00"), deps);
    const results = await runDueJobs(manila("2026-09-28T02:06:00"), deps);
    expect(results).toEqual([{ job: "backup", key: "2026-09-28", outcome: "skipped" }]);
    expect(runs()).toHaveLength(1);
    expect(jobAudit()).toHaveLength(1);
    expect(files()).toEqual(["opd-2026-09-28.sqlite"]);
  });

  it("catches up today's key once when started at 09:00 after downtime", async () => {
    // Earlier days were missed too; only the latest due key runs.
    await runDueJobs(manila("2026-09-28T09:00:00"), deps);
    await runDueJobs(manila("2026-09-28T09:01:00"), deps);
    expect(runs().map((r) => r.key)).toEqual(["2026-09-28"]);
    expect(files()).toEqual(["opd-2026-09-28.sqlite"]);
  });

  it("runs yesterday's key when started at 01:00", async () => {
    await runDueJobs(manila("2026-09-28T01:00:00"), deps);
    expect(runs().map((r) => r.key)).toEqual(["2026-09-27"]);
    expect(files()).toEqual(["opd-2026-09-27.sqlite"]);
  });

  it("keeps the newest 30 nightly files and leaves other files alone", async () => {
    const old = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
      return `opd-${date}.sqlite`;
    });
    for (const name of [...old, "pre-migrate-20260101T000000Z.sqlite", "readme.txt"]) {
      fs.writeFileSync(path.join(backupDir, name), "x");
    }
    await runDueJobs(manila("2026-09-28T02:05:00"), deps);
    const left = files();
    expect(left).not.toContain(old[0]);
    expect(left).toContain("opd-2026-09-28.sqlite");
    expect(left).toContain("pre-migrate-20260101T000000Z.sqlite");
    expect(left).toContain("readme.txt");
    expect(left.filter((name) => /^opd-.*\.sqlite$/.test(name))).toHaveLength(30);
    expect(JSON.parse(jobAudit()[0]!.changes!)).toMatchObject({ pruned: 1 });
  });

  it("records a failure, retries it 30 minutes later and stops after 3 attempts", async () => {
    const blocked = path.join(backupDir, "blocked");
    fs.writeFileSync(blocked, "x");
    const failing = { ...deps, backupDir: blocked };

    const first = await tickAt("2026-09-28T02:05:00", failing);
    expect(first[0]).toMatchObject({ outcome: "failed", attempt: 1 });
    expect(runs()[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(runs()[0]!.error).toBeTruthy();
    const [failure] = jobAudit();
    expect(failure).toMatchObject({ action: "jobs.backup_failed", actorName: "backup job", entity: "job_run" });
    expect(Object.keys(JSON.parse(failure!.changes!)).sort()).toEqual(["attempt", "error", "job", "key"]);

    // Not before RETRY_DELAY_MS after the failure.
    expect((await tickAt("2026-09-28T02:06:00", failing))[0]).toMatchObject({ outcome: "skipped" });
    expect((await tickAt("2026-09-28T02:34:59", failing))[0]).toMatchObject({ outcome: "skipped" });
    expect(runs()[0]).toMatchObject({ attempts: 1 });
    expect(RETRY_DELAY_MS).toBe(30 * 60 * 1000);

    expect((await tickAt("2026-09-28T02:35:00", failing))[0]).toMatchObject({ outcome: "failed", attempt: 2 });
    expect((await tickAt("2026-09-28T03:05:00", failing))[0]).toMatchObject({ outcome: "failed", attempt: 3 });
    expect(runs()[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    const fourth = await tickAt("2026-09-28T04:00:00", failing);
    expect(fourth[0]).toMatchObject({ outcome: "skipped" });
    expect(runs()).toHaveLength(1);
    expect(jobAudit()).toHaveLength(3);
    expect(jobAudit().every((row) => row.action === "jobs.backup_failed")).toBe(true);
    // No temp file anywhere.
    expect(files()).toEqual(["blocked"]);
    // Only failures: no successful backup yet.
    expect(lastBackupAt(t.db)).toBeNull();
  });

  it("succeeds on a retry after a failure", async () => {
    const blocked = path.join(backupDir, "blocked");
    fs.writeFileSync(blocked, "x");
    await tickAt("2026-09-28T02:05:00", { ...deps, backupDir: blocked });
    const results = await tickAt("2026-09-28T02:40:00");
    expect(results[0]).toMatchObject({ outcome: "ok", attempt: 2 });
    expect(runs()[0]).toMatchObject({ status: "ok", attempts: 2, error: null });
    expect(jobAudit().map((row) => row.action)).toEqual(["jobs.backup_failed", "jobs.backup_completed"]);
  });

  it("still succeeds when pruning fails, and records the prune error", async () => {
    stubs.pruneError = "EPERM: operation not permitted";
    const results = await runDueJobs(manila("2026-09-28T02:05:00"), deps);
    expect(results[0]).toMatchObject({ outcome: "ok" });
    expect(files()).toEqual(["opd-2026-09-28.sqlite"]);
    expect(JSON.parse(jobAudit()[0]!.changes!)).toMatchObject({
      file: "opd-2026-09-28.sqlite",
      pruned: 0,
      pruneError: "EPERM: operation not permitted",
    });
  });

  it("returns the newest of several successful backups", async () => {
    await tickAt("2026-09-27T09:00:00");
    await tickAt("2026-09-28T09:00:00");
    expect(lastBackupAt(t.db)).toBe(manila("2026-09-28T09:00:00").toISOString());
  });

  it("runs a key once when two runs start at the same time", async () => {
    const other = openDatabase(t.filePath);
    try {
      const now = manila("2026-09-28T02:05:00");
      const results = await Promise.all([
        runDueJobs(now, deps),
        runDueJobs(now, { ...deps, db: other }),
      ]);
      const outcomes = results.flat().map((r) => r.outcome).sort();
      expect(outcomes).toEqual(["ok", "skipped"]);
      expect(runs()).toHaveLength(1);
      expect(jobAudit()).toHaveLength(1);
      expect(files()).toEqual(["opd-2026-09-28.sqlite"]);
    } finally {
      other.$client.close();
    }
  });

  it("never claims a key another connection is running, until it goes stale", () => {
    const other = openDatabase(t.filePath);
    try {
      const now = manila("2026-09-28T02:05:00");
      expect(claimRun(t.db, "backup", "2026-09-28", "2026-09-28", now)).toMatchObject({ attempt: 1 });
      expect(claimRun(other, "backup", "2026-09-28", "2026-09-28", now)).toBeNull();
      const later = new Date(now.getTime() + STALE_RUNNING_MS);
      expect(claimRun(other, "backup", "2026-09-28", "2026-09-28", later)).toMatchObject({ attempt: 2 });
    } finally {
      other.$client.close();
    }
  });

  it("marks a run interrupted during its last attempt as failed, without claiming it", () => {
    const now = manila("2026-09-28T09:00:00");
    const startedAt = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
    insertRun({ key: "2026-09-28", attempts: MAX_ATTEMPTS, startedAt });

    expect(claimRun(t.db, "backup", "2026-09-28", "2026-09-28", now)).toBeNull();
    expect(runs()[0]).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
      error: INTERRUPTED,
      finishedAt: now.toISOString(),
    });
    // Bookkeeping only: no audit row.
    expect(jobAudit()).toEqual([]);
    expect(claimRun(t.db, "backup", "2026-09-28", "2026-09-28", now)).toBeNull();
  });

  it("marks an older key's stale running row failed when the next key is claimed", async () => {
    const now = manila("2026-09-29T09:00:00");
    insertRun({ key: "2026-09-27", attempts: 1, startedAt: manila("2026-09-27T02:05:00").toISOString() });
    // Another job's stale row is not this job's business.
    insertRun({ key: "2026-09-27", job: "other", attempts: 1, startedAt: manila("2026-09-27T02:05:00").toISOString() });

    await runDueJobs(now, deps);

    const byKey = (job: string, key: string) => runs().find((r) => r.job === job && r.key === key);
    expect(byKey("backup", "2026-09-27")).toMatchObject({ status: "failed", error: INTERRUPTED });
    expect(byKey("backup", "2026-09-29")).toMatchObject({ status: "ok" });
    expect(byKey("other", "2026-09-27")).toMatchObject({ status: "running" });
    expect(jobAudit()).toHaveLength(1);
  });

  it("leaves a fresh running row of an older key alone", () => {
    const now = manila("2026-09-29T09:00:00");
    insertRun({ key: "2026-09-28", attempts: 1, startedAt: new Date(now.getTime() - 60_000).toISOString() });
    claimRun(t.db, "backup", "2026-09-29", "2026-09-29", now);
    expect(runs().find((r) => r.key === "2026-09-28")).toMatchObject({ status: "running", error: null });
  });

  it("reports a job whose claim throws and still runs the other jobs", async () => {
    t.db.$client.exec(
      "create trigger boom before insert on job_runs when new.job = 'boom' begin select raise(abort, 'database is locked'); end",
    );
    const boom: JobDefinition = { ...backupJob, name: "boom" };
    const results = await runDueJobs(manila("2026-09-28T02:05:00"), { ...deps, jobs: [boom, backupJob] });
    expect(results).toEqual([
      { job: "boom", key: "2026-09-28", outcome: "failed", error: expect.stringContaining("database is locked") },
      { job: "backup", key: "2026-09-28", attempt: 1, outcome: "ok" },
    ]);
    // No run was claimed for it, so nothing to audit.
    expect(jobAudit().map((row) => row.action)).toEqual(["jobs.backup_completed"]);
  });

  it("runs the registered jobs by default", async () => {
    t.db.insert(rateLimits).values({ id: "old", key: "a", count: 1, lastRequest: 0 }).run();
    const results = await runDueJobs(manila("2026-09-28T09:00:00"), { db: t.db, backupDir });
    expect(results.map((r) => [r.job, r.outcome])).toEqual([
      ["backup", "ok"],
      ["rate-limit-purge", "ok"],
    ]);
    expect(runs().map((r) => r.job).sort()).toEqual(["backup", "rate-limit-purge"]);
    expect(files()).toEqual(["opd-2026-09-28.sqlite"]);
    expect(t.db.select().from(rateLimits).all()).toEqual([]);
  });

  it("does nothing before the job_runs migration", async () => {
    const empty = openDatabase(path.join(backupDir, "empty.sqlite"));
    try {
      expect(await runDueJobs(manila("2026-09-28T02:05:00"), { ...deps, db: empty })).toEqual([]);
      expect(lastBackupAt(empty)).toBeNull();
      expect(latestRuns(empty)).toEqual([]);
    } finally {
      empty.$client.close();
    }
  });
});

describe("rate-limit purge", () => {
  const now = manila("2026-09-28T03:00:00");
  const day = 24 * 60 * 60 * 1000;

  it("deletes only rows older than 24 hours and writes one audit row", async () => {
    t.db.insert(rateLimits)
      .values([
        { id: "old-1", key: "a", count: 1, lastRequest: now.getTime() - day - 1 },
        { id: "old-2", key: "b", count: 3, lastRequest: now.getTime() - 3 * day },
        { id: "edge", key: "c", count: 1, lastRequest: now.getTime() - day },
        { id: "new", key: "d", count: 1, lastRequest: now.getTime() - 60_000 },
      ])
      .run();

    const results = await runDueJobs(now, { ...deps, jobs: [rateLimitPurgeJob] });
    expect(results).toEqual([{ job: "rate-limit-purge", key: "2026-09-28", attempt: 1, outcome: "ok" }]);
    expect(t.db.select({ id: rateLimits.id }).from(rateLimits).all().map((r) => r.id).sort()).toEqual(["edge", "new"]);
    const rows = jobAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "system",
      actorName: "rate-limit cleanup",
      action: "jobs.rate_limits_purged",
    });
    expect(JSON.parse(rows[0]!.changes!)).toMatchObject({ deleted: 2 });
  });

  it("is not due before 03:00 today, so it runs yesterday's key", async () => {
    await runDueJobs(manila("2026-09-28T02:59:00"), { ...deps, jobs: [rateLimitPurgeJob] });
    expect(runs().map((r) => r.key)).toEqual(["2026-09-27"]);
  });
});

describe("latestRuns", () => {
  it("lists the latest run of each job", async () => {
    await runDueJobs(manila("2026-09-27T09:00:00"), { ...deps, jobs: [backupJob, rateLimitPurgeJob] });
    await runDueJobs(manila("2026-09-28T09:00:00"), { ...deps, jobs: [backupJob] });
    expect(latestRuns(t.db)).toEqual([
      { job: "backup", key: "2026-09-28", status: "ok", finishedAt: "2026-09-27T18:06:00.000Z" },
      { job: "rate-limit-purge", key: "2026-09-27", status: "ok", finishedAt: "2026-09-27T18:06:00.000Z" },
    ]);
  });
});

describe("startScheduler", () => {
  it("starts one scheduler per process and catches up right after start", async () => {
    const now = manila("2026-09-28T09:00:00");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const first = startScheduler({ deps: () => deps, now: () => now });
      const second = startScheduler({ deps: () => ({ ...deps, backupDir: path.join(backupDir, "other") }) });
      expect(second).toBe(first);

      await vi.waitFor(() => expect(runs().map((r) => r.status)).toEqual(["ok"]));
      // A tick while one runs joins it instead of starting another.
      await Promise.all([first.tick(), first.tick()]);
      expect(files()).toEqual(["opd-2026-09-28.sqlite"]);
      expect(jobAudit()).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it("survives a tick that throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const scheduler = startScheduler({
        deps: () => {
          throw new Error("no database");
        },
      });
      await scheduler.tick();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("no database"));
    } finally {
      error.mockRestore();
    }
  });
});

describe("job_runs", () => {
  it("rejects an unknown status and a duplicate key", () => {
    expect(() =>
      t.db.$client.exec(
        "insert into job_runs (id, job, key, opd_date, status, started_at) values ('x', 'backup', 'k', '2026-09-28', 'done', 'now')",
      ),
    ).toThrow(/CHECK constraint failed/);
    t.db.run(
      sql`insert into job_runs (id, job, key, opd_date, status, started_at) values ('a', 'backup', 'k', '2026-09-28', 'ok', 'now')`,
    );
    expect(() =>
      t.db.$client.exec(
        "insert into job_runs (id, job, key, opd_date, status, started_at) values ('b', 'backup', 'k', '2026-09-28', 'ok', 'now')",
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
