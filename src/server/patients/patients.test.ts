import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import {
  DEMO_ALREADY_LOADED_MESSAGE,
  DEMO_PATIENTS,
  DEMO_PRODUCTION_MESSAGE,
  DEMO_SEED_MARKER,
  seedDemoPatients,
} from "./demo-seed";
import { searchPatients } from "./queries";
import { formatHospitalNumber, insertPatient, nextHospitalNumber, patientSearchText, updatePatient } from "./repo";
import { patients, type NewPatientRow } from "./schema";

const NOW = new Date("2026-09-27T02:00:00.000Z");

type PatientInput = Partial<NewPatientRow> & Pick<NewPatientRow, "lastName" | "firstName" | "birthdate">;

function addPatient(db: TestDb["db"], input: PatientInput, year = 2026): string {
  return db.transaction((tx) => {
    const hospitalNumber = input.hospitalNumber ?? nextHospitalNumber(tx, year);
    insertPatient(tx, {
      id: crypto.randomUUID(),
      sex: "female",
      addressBarangay: "Poblacion",
      addressMunicipality: "San Jose",
      contactNumber: "09175550000",
      privacyNoticeAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      createdBy: "u-test",
      ...input,
      hospitalNumber,
    });
    return hospitalNumber;
  });
}

const names = (q: string, db: TestDb["db"]) => searchPatients({ q }, db, NOW).rows.map((row) => row.name);

describe("searchPatients", () => {
  let t: TestDb;

  beforeAll(() => {
    t = createTestDb();
    addPatient(t.db, { lastName: "Dela Cruz", firstName: "Juan", middleName: "Santos", sex: "male", birthdate: "1985-04-12" });
    addPatient(t.db, { lastName: "Peña", firstName: "Maria", birthdate: "1972-10-18" });
    addPatient(t.db, { lastName: "Reyes", firstName: "Rosa", birthdate: "1950-03-15", contactNumber: "09171234567" });
    addPatient(t.db, { lastName: "Garcia", firstName: "Ben", suffix: "Jr.", sex: "male", birthdate: "2020-06-30", contactNumber: "0918 123 1200" });
    addPatient(t.db, {
      lastName: "Hidden",
      firstName: "Cruz",
      birthdate: "1950-03-15",
      contactNumber: "09171234567",
      deactivatedAt: NOW.toISOString(),
    });
  });

  afterAll(() => t.cleanup());

  it("finds part of a name: q=dela cr", () => {
    expect(names("dela cr", t.db)).toEqual(["DELA CRUZ, Juan Santos"]);
  });

  it("ignores case, including accented letters: q=PEÑA", () => {
    expect(names("PEÑA", t.db)).toEqual(["PEÑA, Maria"]);
    expect(names("peña", t.db)).toEqual(["PEÑA, Maria"]);
  });

  it('matches "first last" and "last, first" typed together', () => {
    expect(names("juan dela cruz", t.db)).toEqual(["DELA CRUZ, Juan Santos"]);
    expect(names("Dela Cruz, Juan", t.db)).toEqual(["DELA CRUZ, Juan Santos"]);
    expect(names("dela cruz,juan", t.db)).toEqual(["DELA CRUZ, Juan Santos"]);
    expect(names("juan santos dela", t.db)).toEqual(["DELA CRUZ, Juan Santos"]);
    expect(names("jr.", t.db)).toEqual(["GARCIA, Ben Jr."]);
  });

  it("finds part of the Hospital Number, ignoring case", () => {
    expect(searchPatients({ q: "hn-2026-000001" }, t.db, NOW).rows.map((r) => r.hospitalNumber)).toEqual([
      "HN-2026-000001",
    ]);
    // "HN-2026-00001" is part of HN-2026-000010…000019 only (see the seeded test).
    expect(searchPatients({ q: "hn-2026-00001" }, t.db, NOW).total).toBe(0);
    expect(searchPatients({ q: "hn-2026-0000" }, t.db, NOW).total).toBe(4);
  });

  it("matches a US birthdate exactly: q=03/15/1950", () => {
    expect(names("03/15/1950", t.db)).toEqual(["REYES, Rosa"]);
    expect(names("1950-03-15", t.db)).toEqual(["REYES, Rosa"]);
  });

  it("treats an impossible date as text: q=02/30/1950", () => {
    expect(searchPatients({ q: "02/30/1950" }, t.db, NOW).total).toBe(0);
  });

  it("matches a phone number with +63 read as 0", () => {
    expect(names("+63 917 123 4567", t.db)).toEqual(["REYES, Rosa"]);
    expect(names("0917-123-4567", t.db)).toEqual(["REYES, Rosa"]);
    expect(names("639171234567", t.db)).toEqual(["REYES, Rosa"]);
    // Stored with spaces.
    expect(names("09181231200", t.db)).toEqual(["GARCIA, Ben Jr."]);
  });

  it("needs 4 digits for a phone match; name and Hospital Number rules still apply: q=12", () => {
    // "12" is in 0917 123 4567 but too short for a phone match; it is in no
    // Hospital Number (HN-2026-000001…5) or name either.
    expect(searchPatients({ q: "12" }, t.db, NOW).total).toBe(0);
    // A 1-digit query still matches the Hospital Numbers containing it.
    expect(searchPatients({ q: "3" }, t.db, NOW).rows.map((r) => r.hospitalNumber)).toEqual(["HN-2026-000003"]);
    expect(names("1234", t.db)).toEqual(["REYES, Rosa"]);
  });

  it("never lists a deactivated patient", () => {
    expect(names("hidden", t.db)).toEqual([]);
    expect(searchPatients({ q: "" }, t.db, NOW).rows.map((r) => r.name)).not.toContain("HIDDEN, Cruz");
    expect(searchPatients({}, t.db, NOW).total).toBe(4);
  });

  it("returns name, age, sex, Hospital Number and no last Visit, sorted by last then first name", () => {
    const { rows } = searchPatients({}, t.db, NOW);
    expect(rows.map((r) => r.name)).toEqual(["DELA CRUZ, Juan Santos", "GARCIA, Ben Jr.", "PEÑA, Maria", "REYES, Rosa"]);
    expect(rows[0]).toMatchObject({
      hospitalNumber: "HN-2026-000001",
      sex: "male",
      birthdate: "1985-04-12",
      age: 41,
      lastVisit: null,
    });
    expect(rows[1]!.age).toBe(6);
  });

  it("keeps search_text in step when a name changes", () => {
    const id = t.db.select({ id: patients.id }).from(patients).where(sql`${patients.lastName} = 'Garcia'`).get()!.id;
    expect(t.db.transaction((tx) => updatePatient(tx, id, { lastName: "Garcíano", middleName: undefined }))).toBe(true);
    expect(names("garcíano", t.db)).toEqual(["GARCÍANO, Ben Jr."]);
    expect(names("garcia", t.db)).toEqual([]);
    expect(t.db.transaction((tx) => updatePatient(tx, id, { lastName: "Garcia" }))).toBe(true);
    expect(t.db.transaction((tx) => updatePatient(tx, "missing", { lastName: "X" }))).toBe(false);
  });

  it("derives search_text from the name parts", () => {
    expect(patientSearchText({ lastName: "Dela  Cruz", firstName: "Juan", middleName: "Santos", suffix: "Jr." })).toBe(
      "juan dela cruz\njuan santos dela cruz jr.\ndela cruz, juan santos jr.",
    );
    expect(patientSearchText({ lastName: "PEÑA", firstName: "Maria", middleName: null, suffix: null })).toBe(
      "maria peña\nmaria peña\npeña, maria",
    );
  });

  it("pages 25 at a time and clamps the page", () => {
    const page = searchPatients({ q: "", page: 99, pageSize: 3 }, t.db, NOW);
    expect(page).toMatchObject({ total: 4, page: 2, pageCount: 2, pageSize: 3 });
    expect(page.rows).toHaveLength(1);
    expect(searchPatients({ q: "nobody" }, t.db, NOW)).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
  });
});

describe("nextHospitalNumber", () => {
  let t: TestDb;

  beforeAll(() => {
    t = createTestDb();
  });

  afterAll(() => t.cleanup());

  it("formats HN-YYYY-NNNNNN", () => {
    expect(formatHospitalNumber(2026, 42)).toBe("HN-2026-000042");
  });

  it("issues sequential numbers, separately per year", () => {
    const issue = (year: number) => t.db.transaction((tx) => nextHospitalNumber(tx, year));
    expect(issue(2026)).toBe("HN-2026-000001");
    expect(issue(2026)).toBe("HN-2026-000002");
    expect(issue(2027)).toBe("HN-2027-000001");
    expect(issue(2026)).toBe("HN-2026-000003");
  });

  it("gives the number back when the transaction rolls back", () => {
    expect(() =>
      t.db.transaction((tx) => {
        nextHospitalNumber(tx, 2030);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(t.db.transaction((tx) => nextHospitalNumber(tx, 2030))).toBe("HN-2030-000001");
  });

  it("refuses when a year runs out, and rejects a bad year", () => {
    t.db.run(sql`insert into hospital_number_counters (year, last_seq) values (2031, 999999)`);
    expect(() => t.db.transaction((tx) => nextHospitalNumber(tx, 2031))).toThrow(/No Hospital Numbers left/);
    expect(() => t.db.transaction((tx) => nextHospitalNumber(tx, 26))).toThrow(RangeError);
  });

  it("is enforced by the table: unique numbers, sex and number shape", () => {
    addPatient(t.db, { lastName: "Uno", firstName: "A", birthdate: "2000-01-01", hospitalNumber: "HN-2026-900000" });
    expect(() =>
      addPatient(t.db, { lastName: "Dos", firstName: "B", birthdate: "2000-01-01", hospitalNumber: "HN-2026-900000" }),
    ).toThrow();
    expect(() =>
      addPatient(t.db, { lastName: "Tres", firstName: "C", birthdate: "2000-01-01", hospitalNumber: "HN-26-1" }),
    ).toThrow();
    expect(() =>
      addPatient(t.db, { lastName: "Cuatro", firstName: "D", birthdate: "2000-01-01", sex: "other" as "female" }),
    ).toThrow();
  });
});

describe("seedDemoPatients", () => {
  let t: TestDb;

  beforeAll(() => {
    t = createTestDb();
  });

  afterAll(() => t.cleanup());

  it("refuses in production and writes nothing", () => {
    expect(() => seedDemoPatients(t.db, NOW, "production")).toThrow(DEMO_PRODUCTION_MESSAGE);
    expect(t.db.select().from(patients).all()).toHaveLength(0);
  });

  it("adds the 42 fictional patients (the documented count) numbered by the counter, with no audit rows", () => {
    expect(DEMO_PATIENTS).toHaveLength(42);
    const auditBefore = t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
    const added = seedDemoPatients(t.db, NOW, "development");
    expect(added).toBe(42);
    const rows = t.db.select().from(patients).all();
    expect(rows).toHaveLength(added);
    expect(rows.every((row) => row.createdBy === DEMO_SEED_MARKER)).toBe(true);
    expect(new Set(rows.map((row) => row.hospitalNumber)).size).toBe(added);
    expect(t.db.get<{ s: number }>(sql`select last_seq as s from hospital_number_counters where year = 2026`)!.s).toBe(
      added,
    );
    expect(t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n).toBe(auditBefore);
    // A registration after the seed continues the sequence.
    expect(t.db.transaction((tx) => nextHospitalNumber(tx, 2026))).toBe(formatHospitalNumber(2026, added + 1));
  });

  it("covers children, seniors, both sexes, repeated names and IDs", () => {
    const { rows } = searchPatients({ pageSize: 100 }, t.db, NOW);
    const ages = rows.map((r) => r.age ?? -1);
    expect(ages.some((age) => age < 13)).toBe(true);
    expect(ages.some((age) => age >= 60)).toBe(true);
    expect(new Set(rows.map((r) => r.sex))).toEqual(new Set(["female", "male"]));
    const juans = rows.filter((r) => r.name.startsWith("DELA CRUZ, Juan "));
    expect(new Set(juans.map((r) => r.birthdate)).size).toBe(2);
    const withIds = t.db.get<{ n: number }>(
      sql`select count(*) as n from patients where senior_citizen_id is not null or pwd_id is not null or philhealth_pin is not null`,
    )!.n;
    expect(withIds).toBeGreaterThan(0);
  });

  it("fills more than one page for cruz, and the finder's first 8", () => {
    const page2 = searchPatients({ q: "cruz", page: 2, pageSize: 25 }, t.db, NOW);
    expect(page2.total).toBeGreaterThan(25);
    expect(page2.page).toBe(2);
    expect(page2.rows.length).toBeGreaterThan(0);
    expect(searchPatients({ q: "cruz", pageSize: 8 }, t.db, NOW).rows).toHaveLength(8);
  });

  it("lists the patients whose number contains q=hn-2026-00001", () => {
    const { rows } = searchPatients({ q: "hn-2026-00001" }, t.db, NOW);
    expect(rows.map((r) => r.hospitalNumber).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => formatHospitalNumber(2026, 10 + i)),
    );
  });

  it("stores accented names as real UTF-8, so they are searchable", () => {
    expect(searchPatients({ q: "peña" }, t.db, NOW).rows.map((r) => r.name)).toEqual(["PEÑA, Maria Gomez"]);
    expect(searchPatients({ q: "IBAÑEZ" }, t.db, NOW).total).toBe(2);
    // The barangay isn't searched, but it is stored intact.
    expect(
      t.db.get<{ n: number }>(sql`select count(*) as n from patients where address_barangay = 'Santo Niño'`)!.n,
    ).toBeGreaterThan(0);
    expect(
      t.db.get<{ n: number }>(
        sql`select count(*) as n from patients where (last_name || first_name || coalesce(middle_name, '') || address_barangay) glob '*[ÃÂ]*'`,
      )!.n,
    ).toBe(0);
  });

  it("refuses a second run", () => {
    const before = t.db.select().from(patients).all().length;
    expect(() => seedDemoPatients(t.db, NOW, "development")).toThrow(DEMO_ALREADY_LOADED_MESSAGE);
    expect(t.db.select().from(patients).all()).toHaveLength(before);
  });

  it("answers a search in well under 1 s on the seeded DB", () => {
    const started = performance.now();
    for (const q of ["cruz", "hn-2026", "03/15/1950", "0917 555", "maria santos"]) searchPatients({ q }, t.db, NOW);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("npm run db:seed:demo", () => {
  it("exits 1 with NODE_ENV=production and writes nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-seed-"));
    const dbFile = path.join(dir, "prod.sqlite");
    try {
      const result = spawnSync(
        process.execPath,
        [path.join("node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", "scripts/seed-demo.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, NODE_ENV: "production", DATABASE_PATH: dbFile },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Demo data is never loaded in production.");
      expect(fs.existsSync(dbFile)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("exits 1 before db:migrate, without creating a database file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-seed-"));
    const dbFile = path.join(dir, "new.sqlite");
    try {
      const result = spawnSync(
        process.execPath,
        [path.join("node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", "scripts/seed-demo.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, NODE_ENV: "development", DATABASE_PATH: dbFile },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Run npm run db:migrate first.");
      expect(fs.existsSync(dbFile)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
