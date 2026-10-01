import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db/client")>();
  return {
    ...actual,
    getDb: () => {
      if (!state.db) throw new Error("database unavailable");
      return state.db;
    },
  };
});

const { createTestDb } = await import("@/server/db/test-db");
const { openDatabase } = await import("@/server/db/client");
const { backupJob } = await import("@/server/jobs/backup-job");
const { runDueJobs } = await import("@/server/jobs/scheduler");
const { GET } = await import("./route");

let t: ReturnType<typeof createTestDb>;
let backupDir: string;

beforeAll(() => {
  t = createTestDb();
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-health-"));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  t.cleanup();
  fs.rmSync(backupDir, { recursive: true, force: true });
});

/** A database that looks migrated to health's check, plus `extraSql`. */
function fakeMigrated(name: string, extraSql = "") {
  const db = openDatabase(path.join(backupDir, name));
  db.$client.exec(`create table __drizzle_migrations (id integer); create table audit_log (id text); ${extraSql}`);
  return db;
}

describe("GET /api/health", () => {
  it("reports no backup, a stale backup and no jobs on a fresh database", async () => {
    state.db = t.db;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      db: "up",
      lastBackupAt: null,
      backupStale: true,
      jobs: [],
    });
  });

  it("reports the last backup and the latest run of each job, with no other data", async () => {
    state.db = t.db;
    await runDueJobs(new Date("2026-09-28T02:05:00+08:00"), {
      db: t.db,
      backupDir,
      jobs: [backupJob],
      clock: () => new Date("2026-09-27T18:06:00.000Z"),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T01:00:00.000Z"));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["backupStale", "db", "jobs", "lastBackupAt", "ok", "time"]);
    expect(body).toMatchObject({
      ok: true,
      db: "up",
      lastBackupAt: "2026-09-27T18:06:00.000Z",
      backupStale: false,
      jobs: [{ job: "backup", key: "2026-09-28", status: "ok", finishedAt: "2026-09-27T18:06:00.000Z" }],
    });

    // More than 26 hours later: still 200, but the backup is stale.
    vi.setSystemTime(new Date("2026-09-28T20:06:01.000Z"));
    const later = await GET();
    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({ ok: true, backupStale: true });
  });

  it("stays up before the job_runs migration", async () => {
    const db = fakeMigrated("old.sqlite");
    try {
      state.db = db as Db;
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, lastBackupAt: null, backupStale: true, jobs: [] });
    } finally {
      db.$client.close();
    }
  });

  it("stays up when the job state can't be read", async () => {
    const db = fakeMigrated("malformed.sqlite", "create table job_runs (id text);");
    try {
      state.db = db as Db;
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, db: "up", lastBackupAt: null, jobs: [] });
    } finally {
      db.$client.close();
    }
  });

  it("returns 503 when the database is down", async () => {
    state.db = null;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      db: "down",
      lastBackupAt: null,
      backupStale: true,
      jobs: [],
    });
  });

  it("returns 503 for an unmigrated database", async () => {
    const db = openDatabase(path.join(backupDir, "empty.sqlite"));
    try {
      state.db = db as Db;
      const response = await GET();
      expect(response.status).toBe(503);
    } finally {
      db.$client.close();
    }
  });
});
