import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/server/db/client";
import { MIGRATIONS_FOLDER, runMigrations } from "@/server/db/migrate";

/** A copy of drizzle/ holding only the migrations up to and including `lastTag`. */
function migrationsUpTo(dir: string, lastTag: string): string {
  const folder = path.join(dir, "migrations");
  fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"));
  const last = journal.entries.findIndex((e: { tag: string }) => e.tag === lastTag);
  if (last < 0) throw new Error(`no migration ${lastTag}`);
  journal.entries = journal.entries.slice(0, last + 1);
  for (const entry of journal.entries as { tag: string }[]) {
    fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  fs.writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  return folder;
}

let dir: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-migrate-"));
  db = openDatabase(path.join(dir, "test.sqlite"));
});

afterEach(() => {
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const rows = () => db.all(sql`select * from facilities order by sort_order`);

describe("0004_facilities_checks", () => {
  it("applies on a database already at 0003 and keeps its Facility rows", () => {
    runMigrations(db, migrationsUpTo(dir, "0003_facilities"));
    // State an existing database may have: an edit, a pending prefix, a deactivation.
    db.run(sql`update facilities set name = 'Prenatal Care', next_prefix = 'PR', next_prefix_from = '2026-10-01' where prefix = 'PN'`);
    db.run(sql`update facilities set deactivated_at = '2026-09-27T01:00:00.000Z', is_live = 0 where prefix = 'AB'`);
    const before = rows();

    runMigrations(db);

    expect(rows()).toEqual(before);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("makes the active-name index case-insensitive", () => {
    runMigrations(db);
    expect(() => db.$client.exec("update facilities set name = 'TREATMENT' where prefix = 'CN'")).toThrow(
      /UNIQUE constraint failed/,
    );
    // A deactivated Facility may share a name.
    db.run(sql`update facilities set deactivated_at = '2026-09-27T01:00:00.000Z' where prefix = 'CN'`);
    db.run(sql`update facilities set name = 'TREATMENT' where prefix = 'CN'`);
  });

  it.each([
    ["next_prefix lowercase", "update facilities set next_prefix = 'tx', next_prefix_from = '2026-10-01' where prefix = 'TR'"],
    ["next_prefix too long", "update facilities set next_prefix = 'TXYZ', next_prefix_from = '2026-10-01' where prefix = 'TR'"],
    ["next_prefix_from not a date", "update facilities set next_prefix = 'TX', next_prefix_from = 'tomorrow' where prefix = 'TR'"],
    ["open_days not JSON", "update facilities set open_days = '1,2,3' where prefix = 'TR'"],
    ["open_time not HH:MM", "update facilities set open_time = '7:00' where prefix = 'TR'"],
    ["close_time not HH:MM", "update facilities set close_time = '5pm' where prefix = 'TR'"],
  ])("rejects %s", (_label, statement) => {
    runMigrations(db);
    // Raw client: drizzle wraps errors, the SQLite message is what matters here.
    expect(() => db.$client.exec(statement)).toThrow(/CHECK constraint failed/);
  });
});

describe("0006_clinical_settings", () => {
  it("applies on a database already at 0005, keeps its Facility rows and seeds the defaults", () => {
    runMigrations(db, migrationsUpTo(dir, "0005_user_facilities"));
    db.run(sql`update facilities set name = 'Prenatal Care', next_prefix = 'PR', next_prefix_from = '2026-10-01' where prefix = 'PN'`);
    db.run(sql`update facilities set deactivated_at = '2026-09-27T01:00:00.000Z' where prefix = 'AB'`);
    const before = rows();

    runMigrations(db);

    expect(rows()).toEqual(before);
    expect(db.all(sql`select name, is_er, rank from urgency_levels order by name`)).toEqual([
      { name: "Emergency", is_er: 1, rank: null },
      { name: "Routine", is_er: 0, rank: 2 },
      { name: "Urgent", is_er: 0, rank: 1 },
    ]);
    expect(db.all(sql`select code, legally_required, enabled from priority_categories order by sort_order`)).toEqual([
      { code: "senior_citizen", legally_required: 1, enabled: 1 },
      { code: "pwd", legally_required: 1, enabled: 1 },
      { code: "pregnant", legally_required: 0, enabled: 1 },
    ]);
    expect(db.all(sql`select code, days from clinical_schedules order by sort_order`)).toEqual([
      { code: "abc_new", days: "[0,3,7]" },
      { code: "abc_previously_immunized", days: "[0,3]" },
    ]);
    expect(db.all(sql`select id, prenatal_target, no_show_threshold, pre_close_warning_minutes from opd_settings`)).toEqual([
      { id: 1, prenatal_target: 8, no_show_threshold: 3, pre_close_warning_minutes: 30 },
    ]);
  });

  it.each([
    ["an ER level with a rank", "update urgency_levels set rank = 5 where name = 'Emergency'"],
    ["a non-ER level without a rank", "update urgency_levels set rank = null where name = 'Urgent'"],
    ["a rank of 0", "update urgency_levels set rank = 0 where name = 'Urgent'"],
    ["schedule days not JSON", "update clinical_schedules set days = '0,3,7' where code = 'abc_new'"],
    ["schedule days not an array", "update clinical_schedules set days = '{\"a\":1}' where code = 'abc_new'"],
    ["a second opd_settings row", "insert into opd_settings (id, prenatal_target, no_show_threshold, pre_close_warning_minutes, updated_at) values (2, 8, 3, 30, 'x')"],
    ["prenatal target 0", "update opd_settings set prenatal_target = 0"],
    ["prenatal target 21", "update opd_settings set prenatal_target = 21"],
    ["no-show threshold 11", "update opd_settings set no_show_threshold = 11"],
    ["pre-close warning 121", "update opd_settings set pre_close_warning_minutes = 121"],
    ["pre-close warning -1", "update opd_settings set pre_close_warning_minutes = -1"],
  ])("rejects %s", (_label, statement) => {
    runMigrations(db);
    expect(() => db.$client.exec(statement)).toThrow(/CHECK constraint failed/);
  });

  it("keeps active ranks and names unique, but not for removed levels", () => {
    runMigrations(db);
    expect(() => db.$client.exec("update urgency_levels set rank = 1 where name = 'Routine'")).toThrow(/UNIQUE/);
    expect(() => db.$client.exec("update urgency_levels set name = 'URGENT' where name = 'Routine'")).toThrow(/UNIQUE/);
    db.$client.exec("update urgency_levels set deactivated_at = '2026-09-27T01:00:00.000Z' where name = 'Routine'");
    db.$client.exec("update urgency_levels set rank = 1, name = 'URGENT' where name = 'Routine'");
  });
});

describe("0014_hospital_name", () => {
  it("applies on a database already at 0013, keeps the thresholds and defaults the hospital name", () => {
    runMigrations(db, migrationsUpTo(dir, "0013_paper_number"));
    db.run(sql`update opd_settings set prenatal_target = 9, no_show_threshold = 4, pre_close_warning_minutes = 15`);

    runMigrations(db);

    expect(
      db.all(sql`select id, prenatal_target, no_show_threshold, pre_close_warning_minutes, hospital_name from opd_settings`),
    ).toEqual([
      { id: 1, prenatal_target: 9, no_show_threshold: 4, pre_close_warning_minutes: 15, hospital_name: "Hospital OPD" },
    ]);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([
    ["a one-character name", "update opd_settings set hospital_name = 'H'"],
    ["a blank name", "update opd_settings set hospital_name = '     '"],
    ["an 81-character name", `update opd_settings set hospital_name = '${"x".repeat(81)}'`],
    ["a second row", "insert into opd_settings (id, prenatal_target, no_show_threshold, pre_close_warning_minutes, updated_at) values (2, 8, 3, 30, 'x')"],
  ])("rejects %s", (_label, statement) => {
    runMigrations(db);
    expect(() => db.$client.exec(statement)).toThrow(/CHECK constraint failed/);
  });
});
