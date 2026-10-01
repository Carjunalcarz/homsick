import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupBeforeMigrate,
  backupTimestamp,
  backupTo,
  listBackups,
  migrateWithBackup,
  PRE_MIGRATE_KEEP,
  pruneBackups,
  removeStaleTemps,
  STALE_TEMP_MS,
} from "./backup";
import { openDatabase, type Db } from "./client";
import { runMigrations } from "./migrate";
import { createTestDb, type TestDb } from "./test-db";

let t: TestDb;
let dir: string;

beforeEach(() => {
  t = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-backup-"));
});

afterEach(() => {
  t.cleanup();
  fs.rmSync(dir, { recursive: true, force: true });
});

const count = (db: Db, table: string) => db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`))!.n;

function touch(...names: string[]) {
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
}

describe("backupTo", () => {
  it("writes a complete copy with the same rows and leaves no temp file", () => {
    const file = path.join(dir, "nested", "opd-2026-09-28.sqlite");
    const result = backupTo(t.db, file);
    expect(result.file).toBe(path.resolve(file));
    expect(result.bytes).toBeGreaterThan(0);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["opd-2026-09-28.sqlite"]);

    const copy = openDatabase(file);
    try {
      for (const table of ["facilities", "urgency_levels", "audit_log", "__drizzle_migrations"]) {
        expect(count(copy, table)).toBe(count(t.db, table));
      }
    } finally {
      copy.$client.close();
    }
  });

  it("replaces an existing file", () => {
    const file = path.join(dir, "opd-2026-09-28.sqlite");
    fs.writeFileSync(file, "old");
    backupTo(t.db, file);
    expect(fs.statSync(file).size).toBeGreaterThan(3);
  });

  it("removes the temp file when the rename fails", () => {
    // The target is a folder, so VACUUM INTO the temp file works but the rename can't.
    const file = path.join(dir, "opd-2026-09-28.sqlite");
    fs.mkdirSync(file);
    expect(() => backupTo(t.db, file)).toThrow();
    expect(fs.readdirSync(dir)).toEqual(["opd-2026-09-28.sqlite"]);
    expect(fs.statSync(file).isDirectory()).toBe(true);
  });

  it("fails when the folder can't be created", () => {
    fs.writeFileSync(path.join(dir, "not-a-dir"), "x");
    expect(() => backupTo(t.db, path.join(dir, "not-a-dir", "opd-2026-09-28.sqlite"))).toThrow();
    expect(fs.readdirSync(dir)).toEqual(["not-a-dir"]);
  });
});

describe("stale temp files", () => {
  function age(name: string, ms: number) {
    const time = new Date(Date.now() - ms);
    fs.utimesSync(path.join(dir, name), time, time);
  }

  it("removes old temp files with the backup's prefix, keeps fresh ones and everything else", () => {
    const oldTemp = "opd-2026-09-20.sqlite.1111.tmp";
    const freshTemp = "opd-2026-09-27.sqlite.2222.tmp";
    const otherOld = ["pre-migrate-20260101T000000Z.sqlite.3333.tmp", "other.tmp", "opd-2026-09-19.sqlite"];
    touch(oldTemp, freshTemp, ...otherOld);
    for (const name of [oldTemp, ...otherOld]) age(name, STALE_TEMP_MS + 60_000);

    backupTo(t.db, path.join(dir, "opd-2026-09-28.sqlite"), "opd-");

    expect(fs.readdirSync(dir).sort()).toEqual([freshTemp, "opd-2026-09-28.sqlite", ...otherOld].sort());
  });

  it("returns nothing for a missing folder", () => {
    expect(removeStaleTemps(path.join(dir, "missing"), "opd-")).toEqual([]);
  });
});

describe("pruneBackups", () => {
  it("keeps the newest 30 nightly files and never touches anything else", () => {
    const nightly = Array.from({ length: 31 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
      return `opd-${date}.sqlite`;
    });
    const others = [
      "notes.txt",
      "pre-migrate-20260101T000000Z.sqlite",
      "opd-notes.sqlite",
      "opd-2026-01-01.sqlite.bak",
      "opd-2026-01-01.sqlite.1234.tmp",
      "xopd-2026-01-01.sqlite",
    ];
    touch(...nightly, ...others);

    expect(pruneBackups(dir, "opd-", 30)).toEqual([nightly[0]]);

    const left = fs.readdirSync(dir).sort();
    expect(left).toEqual([...nightly.slice(1), ...others].sort());
  });

  it("leaves a folder with fewer files alone, and a missing folder is empty", () => {
    touch("opd-2026-09-27.sqlite", "opd-2026-09-28.sqlite");
    expect(pruneBackups(dir, "opd-", 30)).toEqual([]);
    expect(pruneBackups(path.join(dir, "missing"), "opd-", 30)).toEqual([]);
    expect(listBackups(dir, "opd-")).toEqual(["opd-2026-09-27.sqlite", "opd-2026-09-28.sqlite"]);
  });
});

describe("backupBeforeMigrate", () => {
  const now = new Date("2026-09-27T01:02:03.456Z");

  it("names the file by UTC timestamp", () => {
    expect(backupTimestamp(now)).toBe("20260927T010203Z");
  });

  it("backs up an existing database before migrating", () => {
    const result = backupBeforeMigrate(t.db, dir, now);
    expect(result?.file).toBe(path.join(dir, "pre-migrate-20260927T010203Z.sqlite"));
    expect(fs.readdirSync(dir)).toEqual(["pre-migrate-20260927T010203Z.sqlite"]);
  });

  it("skips a new, empty database", () => {
    const empty = openDatabase(path.join(dir, "db", "new.sqlite"));
    try {
      expect(backupBeforeMigrate(empty, path.join(dir, "backups"), now)).toBeNull();
      expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
    } finally {
      empty.$client.close();
    }
  });

  it("keeps the newest 10 pre-migrate files and leaves nightly files alone", () => {
    const old = Array.from({ length: PRE_MIGRATE_KEEP }, (_, i) => `pre-migrate-2026010${i % 10}T00000${i}Z.sqlite`);
    touch(...old, "opd-2026-09-26.sqlite");
    backupBeforeMigrate(t.db, dir, now);
    const left = listBackups(dir, "pre-migrate-");
    expect(left).toHaveLength(PRE_MIGRATE_KEEP);
    expect(left).toContain("pre-migrate-20260927T010203Z.sqlite");
    expect(left).not.toContain(old.sort()[0]);
    expect(fs.existsSync(path.join(dir, "opd-2026-09-26.sqlite"))).toBe(true);
  });

  it("never prunes the file just written, even when the clock is behind the other names", () => {
    const newer = Array.from({ length: PRE_MIGRATE_KEEP }, (_, i) => `pre-migrate-2027010${i}T000000Z.sqlite`);
    touch(...newer);
    backupBeforeMigrate(t.db, dir, now);
    const left = listBackups(dir, "pre-migrate-");
    expect(left).toHaveLength(PRE_MIGRATE_KEEP);
    expect(left).toContain("pre-migrate-20260927T010203Z.sqlite");
    expect(left).not.toContain(newer[0]);
  });

  it("throws when the backup can't be written, and the database is untouched", () => {
    const blocked = path.join(dir, "blocked");
    fs.writeFileSync(blocked, "x");
    // A database at an older migration: the caller must not migrate it after this throws.
    const before = count(t.db, "__drizzle_migrations");
    expect(() => backupBeforeMigrate(t.db, blocked, now)).toThrow();
    expect(count(t.db, "__drizzle_migrations")).toBe(before);
    // Migrating is still possible afterwards, i.e. the file wasn't damaged.
    runMigrations(t.db);
  });
});

describe("migrateWithBackup", () => {
  const now = new Date("2026-09-27T01:02:03.456Z");
  const tables = (db: Db) =>
    db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`).map((r) => r.name);

  function existingDb() {
    const db = openDatabase(path.join(dir, "db", "existing.sqlite"));
    db.$client.exec("create table legacy (id integer)");
    return db;
  }

  it("writes the pre-migrate backup before migrating", () => {
    const db = existingDb();
    try {
      const backup = migrateWithBackup(db, path.join(dir, "backups"), now);
      expect(backup?.file).toBe(path.join(dir, "backups", "pre-migrate-20260927T010203Z.sqlite"));
      expect(tables(db)).toContain("__drizzle_migrations");
      // The copy was taken before the migrations ran.
      const copy = openDatabase(backup!.file);
      try {
        expect(tables(copy)).toEqual(["legacy"]);
      } finally {
        copy.$client.close();
      }
    } finally {
      db.$client.close();
    }
  });

  it("applies no migration when the backup fails", () => {
    const db = existingDb();
    try {
      const blocked = path.join(dir, "blocked");
      fs.writeFileSync(blocked, "x");
      expect(() => migrateWithBackup(db, blocked, now)).toThrow(/Pre-migration backup .* failed, so nothing was migrated/);
      expect(tables(db)).toEqual(["legacy"]);
    } finally {
      db.$client.close();
    }
  });

  it("migrates a new, empty database without a backup", () => {
    const db = openDatabase(path.join(dir, "db", "new.sqlite"));
    try {
      expect(migrateWithBackup(db, path.join(dir, "backups"), now)).toBeNull();
      expect(tables(db)).toContain("__drizzle_migrations");
      expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
    } finally {
      db.$client.close();
    }
  });
});
