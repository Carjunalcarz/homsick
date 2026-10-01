import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addOpdDays, opdDate } from "@/lib/time";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => ({
  user: { id: "u-nurse", name: "Joy Santos", username: "joy.santos", role: "triage_nurse" as string, facilityIds: [] },
}));

vi.mock("@/server/auth/session", () => ({ requireStaff: async () => ({ ...stubs.user }) }));

const { registerPatientAction } = await import("./actions");
const { createPatient, findPossibleMatches } = await import("./service");
const { searchPatients } = await import("./queries");
const { patientRegistrationSchema } = await import("./schemas");
const { patients } = await import("./schema");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const actor: Actor = { type: "staff", id: "u-nurse", name: "Joy Santos" };
const NOW = new Date("2026-09-27T02:00:00.000Z");

beforeEach(() => {
  t = createTestDb();
  process.env.DATABASE_PATH = t.filePath;
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(40, "x");
  resetEnvForTests();
  closeDb();
  stubs.user.role = "triage_nurse";
});

afterEach(() => {
  closeDb();
  t.cleanup();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
});

const VALID = {
  lastName: "Dela Cruz",
  firstName: "Juan",
  sex: "male",
  birthdate: "1985-04-12",
  addressBarangay: "Poblacion",
  addressMunicipality: "San Jose",
  contactNumber: "0917 123 4567",
  privacyNoticeExplained: true,
};

const parse = (input: Record<string, unknown>) => patientRegistrationSchema.parse(input);

function patientCount() {
  return t.db.get<{ n: number }>(sql`select count(*) as n from patients`)!.n;
}
function auditRows() {
  return t.db
    .select()
    .from(auditLog)
    .all()
    .map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
}
function counter(year: number) {
  return t.db.get<{ last_seq: number }>(sql`select last_seq from hospital_number_counters where year = ${year}`)?.last_seq;
}

describe("registerPatientAction", () => {
  it("creates the patient with the next Hospital Number and one audit row", async () => {
    const result = await registerPatientAction({
      ...VALID,
      middleName: "Santos",
      philhealthPin: "12 345678901 2",
      seniorCitizenId: "",
      emergencyContactName: "  Maria  Dela Cruz ",
      emergencyContactNumber: "+63 918 000 1111",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "created") throw new Error("expected created");
    const year = opdDate().slice(0, 4);
    const { patient } = result.data;
    expect(patient).toMatchObject({
      hospitalNumber: `HN-${year}-000001`,
      name: "DELA CRUZ, Juan Santos",
      sex: "male",
      birthdate: "1985-04-12",
      lastVisit: null,
    });
    expect(patient).not.toHaveProperty("contactNumber");

    const row = t.db.select().from(patients).get()!;
    expect(row).toMatchObject({
      id: patient.id,
      contactNumber: "09171234567",
      philhealthPin: "12-345678901-2",
      seniorCitizenId: null,
      emergencyContactName: "Maria Dela Cruz",
      emergencyContactNumber: "09180001111",
      createdBy: "u-nurse",
      deactivatedAt: null,
    });
    expect(row.privacyNoticeAt).toBe(row.createdAt);
    expect(Date.now() - Date.parse(row.privacyNoticeAt)).toBeLessThan(10_000);

    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "patient.created",
      entity: "patient",
      entityId: patient.id,
      actorId: "u-nurse",
    });
    expect(audits[0]!.changes).toEqual({
      hospitalNumber: `HN-${year}-000001`,
      lastName: "Dela Cruz",
      firstName: "Juan",
      middleName: "Santos",
      sex: "male",
      birthdate: "1985-04-12",
      addressBarangay: "Poblacion",
      addressMunicipality: "San Jose",
      contactNumber: "09171234567",
      philhealthPin: "12-345678901-2",
      emergencyContactName: "Maria Dela Cruz",
      emergencyContactNumber: "09180001111",
      privacyNoticeAt: row.privacyNoticeAt,
    });
  });

  it("is found by the finder search on its new Hospital Number", async () => {
    const result = await registerPatientAction(VALID);
    if (!result.ok || result.data.status !== "created") throw new Error("expected created");
    const found = searchPatients({ q: result.data.patient.hospitalNumber }, t.db);
    expect(found.rows.map((row) => row.id)).toEqual([result.data.patient.id]);
    expect(searchPatients({ q: "juan dela cruz" }, t.db).total).toBe(1);
  });

  it.each([
    ["privacy not ticked", { privacyNoticeExplained: false }, "privacyNoticeExplained", "Confirm the privacy notice was explained."],
    ["privacy missing", { privacyNoticeExplained: undefined }, "privacyNoticeExplained", "Confirm the privacy notice was explained."],
    ["future birthdate", { birthdate: addOpdDays(opdDate(), 1) }, "birthdate", "Birthdate can't be in the future."],
    ["impossible date", { birthdate: "1990-02-30" }, "birthdate", "Enter a real date."],
    ["before 1900", { birthdate: "1899-12-31" }, "birthdate", "Birthdate must be 1900 or later."],
    ["impossible date before 1900", { birthdate: "1899-02-29" }, "birthdate", "Enter a real date."],
    ["name with digits", { lastName: "Cruz2" }, "lastName", "Use letters, spaces, . ' and - only."],
    ["blank first name", { firstName: "   " }, "firstName", "Enter the first name."],
    ["long name", { firstName: "A".repeat(61) }, "firstName", "First name must be 1–60 characters."],
    ["short phone", { contactNumber: "12345" }, "contactNumber", "Enter a phone number with 7 to 11 digits."],
    ["foreign code", { contactNumber: "+1 555 123 4567" }, "contactNumber", "Enter a phone number with 7 to 11 digits."],
    ["no sex", { sex: "" }, "sex", "Choose female or male."],
    ["bad PhilHealth", { philhealthPin: "1234" }, "philhealthPin", "PhilHealth PIN must be 12 digits."],
    ["long ID", { pwdId: "X".repeat(31) }, "pwdId", "Keep IDs to 30 characters."],
    ["bad emergency number", { emergencyContactNumber: "abc" }, "emergencyContactNumber", "Enter a phone number with 7 to 11 digits."],
  ])("refuses %s with a field error, creating and auditing nothing", async (_, change, field, message) => {
    const result = await registerPatientAction({ ...VALID, ...change });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
    if (result.ok) return;
    expect(result.error.fieldErrors?.[field]).toBe(message);
    expect(patientCount()).toBe(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("accepts today's date and names with ñ, accents, dots, apostrophes and hyphens", async () => {
    const result = await registerPatientAction({
      ...VALID,
      lastName: "Peña-O'Neil",
      firstName: "Ma. José",
      suffix: "Jr.",
      birthdate: opdDate(),
      contactNumber: "(02) 8123-4567",
    });
    expect(result).toMatchObject({ ok: true, data: { status: "created" } });
    expect(t.db.select().from(patients).get()).toMatchObject({ lastName: "Peña-O'Neil", contactNumber: "0281234567" });
  });

  it("stores +63 and 63 phone forms as 09…", () => {
    for (const form of ["+63 917 123 4567", "639171234567", "(+63) 917-123-4567", "(+63) 0917 123 4567", "0917.123.4567", "917 123 4567"]) {
      expect(parse({ ...VALID, contactNumber: form }).contactNumber).toBe("09171234567");
    }
    expect(parse({ ...VALID, contactNumber: "632 8123 4567" }).contactNumber).toBe("0281234567");
    expect(parse({ ...VALID, contactNumber: "123 4567" }).contactNumber).toBe("1234567");
  });

  it("returns possible_match for the same name (any case) and birthdate, creating nothing", async () => {
    const first = await registerPatientAction(VALID);
    expect(first.ok).toBe(true);
    const year = Number(opdDate().slice(0, 4));

    const again = await registerPatientAction({ ...VALID, lastName: "DELA  CRUZ", firstName: "juan", contactNumber: "09990000000" });
    expect(again.ok).toBe(true);
    if (!again.ok || again.data.status !== "possible_match") throw new Error("expected possible_match");
    expect(again.data.matches).toHaveLength(1);
    expect(again.data.matches[0]).toMatchObject({ name: "DELA CRUZ, Juan", hospitalNumber: `HN-${year}-000001` });
    expect(again.data.matches[0]).not.toHaveProperty("contactNumber");
    expect(patientCount()).toBe(1);
    expect(auditRows()).toHaveLength(1);
    expect(counter(year)).toBe(1);
  });

  it("creates the duplicate when the shown matches are confirmed", async () => {
    const first = await registerPatientAction(VALID);
    if (!first.ok || first.data.status !== "created") throw new Error("expected created");
    const year = opdDate().slice(0, 4);
    const confirmed = await registerPatientAction({ ...VALID, confirmedMatchIds: [first.data.patient.id] });
    expect(confirmed).toMatchObject({
      ok: true,
      data: { status: "created", patient: { hospitalNumber: `HN-${year}-000002` } },
    });
    expect(patientCount()).toBe(2);
    const audits = auditRows();
    expect(audits).toHaveLength(2);
    expect(audits[1]!.changes.possibleMatchesConfirmed).toEqual([`HN-${year}-000001`]);
  });

  it("asks again, with every current match, when a match wasn't among the confirmed ones", async () => {
    const first = await registerPatientAction(VALID);
    if (!first.ok || first.data.status !== "created") throw new Error("expected created");
    const second = await registerPatientAction({ ...VALID, confirmedMatchIds: [first.data.patient.id] });
    if (!second.ok || second.data.status !== "created") throw new Error("expected created");

    // The nurse saw only the first match; the second appeared since.
    const again = await registerPatientAction({ ...VALID, confirmedMatchIds: [first.data.patient.id, "p-unknown"] });
    expect(again.ok).toBe(true);
    if (!again.ok || again.data.status !== "possible_match") throw new Error("expected possible_match");
    expect(again.data.matches.map((match) => match.id).sort()).toEqual([first.data.patient.id, second.data.patient.id].sort());
    expect(patientCount()).toBe(2);
    expect(auditRows()).toHaveLength(2);

    // A bare or empty confirmation confirms nothing.
    for (const extra of [{ confirmDuplicate: true }, { confirmedMatchIds: [] }]) {
      const result = await registerPatientAction({ ...VALID, ...extra });
      expect(result).toMatchObject({ ok: true, data: { status: "possible_match" } });
    }
    expect(patientCount()).toBe(2);
  });

  it("finds a Possible match for PEÑA, María typed in lower case or decomposed", async () => {
    await registerPatientAction({ ...VALID, lastName: "PEÑA", firstName: "María", birthdate: "1972-10-18" });
    for (const [lastName, firstName] of [
      ["peña", "maría"],
      ["pen\u0303a", "mari\u0301a"],
    ]) {
      const result = await registerPatientAction({ ...VALID, lastName, firstName, birthdate: "1972-10-18" });
      if (!result.ok || result.data.status !== "possible_match") throw new Error(`expected possible_match for ${lastName}`);
      expect(result.data.matches.map((match) => match.name)).toEqual(["PEÑA, María"]);
    }
    expect(patientCount()).toBe(1);
  });

  it("stores a decomposed name as NFC, so search finds it either way", async () => {
    const result = await registerPatientAction({ ...VALID, lastName: "Pen\u0303a", firstName: "Rosa" });
    expect(result.ok).toBe(true);
    expect(t.db.select().from(patients).get()!.lastName).toBe("Peña");
    expect(searchPatients({ q: "peña" }, t.db).total).toBe(1);
    expect(searchPatients({ q: "pen\u0303a" }, t.db).total).toBe(1);
  });

  it("returns hospital_numbers_exhausted with no patient and no audit row", async () => {
    const year = Number(opdDate().slice(0, 4));
    t.db.run(sql`insert into hospital_number_counters (year, last_seq) values (${year}, 999999)`);
    const result = await registerPatientAction(VALID);
    expect(result).toMatchObject({ ok: false, error: { code: "hospital_numbers_exhausted" } });
    expect(patientCount()).toBe(0);
    expect(auditRows()).toHaveLength(0);
    expect(counter(year)).toBe(999999);
  });

  it("does not match a different birthdate or a deactivated patient", async () => {
    await registerPatientAction(VALID);
    expect(await registerPatientAction({ ...VALID, birthdate: "1985-04-13" })).toMatchObject({
      ok: true,
      data: { status: "created" },
    });
    t.db.run(sql`update patients set deactivated_at = ${NOW.toISOString()}`);
    expect(await registerPatientAction(VALID)).toMatchObject({ ok: true, data: { status: "created" } });
  });

  it("forbids Facility Staff, creating nothing", async () => {
    stubs.user.role = "facility_staff";
    expect(await registerPatientAction(VALID)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(patientCount()).toBe(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("lets an Admin register", async () => {
    stubs.user.role = "admin";
    expect(await registerPatientAction(VALID)).toMatchObject({ ok: true, data: { status: "created" } });
  });
});

describe("createPatient", () => {
  it("issues sequential Hospital Numbers for creates one after another", () => {
    const a = createPatient(parse(VALID), actor, NOW, t.db);
    const b = createPatient(parse({ ...VALID, firstName: "Pedro" }), actor, NOW, t.db);
    const c = createPatient(parse({ ...VALID, firstName: "Jose" }), actor, NOW, t.db);
    expect([a, b, c].map((outcome) => outcome.status === "created" && outcome.patient.hospitalNumber)).toEqual([
      "HN-2026-000001",
      "HN-2026-000002",
      "HN-2026-000003",
    ]);
    expect(counter(2026)).toBe(3);
  });

  it("sets privacy_notice_at to the save time", () => {
    createPatient(parse(VALID), actor, NOW, t.db);
    expect(t.db.select().from(patients).get()).toMatchObject({
      privacyNoticeAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("starts a new year at HN-2027-000001 (the Manila year)", () => {
    createPatient(parse(VALID), actor, NOW, t.db);
    // 2026-12-31 16:30 UTC is already 2027-01-01 in Manila.
    const outcome = createPatient(parse({ ...VALID, firstName: "Ana" }), actor, new Date("2026-12-31T16:30:00.000Z"), t.db);
    expect(outcome).toMatchObject({ status: "created", patient: { hospitalNumber: "HN-2027-000001" } });
  });

  it("finds possible matches inside a transaction", () => {
    createPatient(parse(VALID), actor, NOW, t.db);
    const matches = t.db.transaction((tx) =>
      findPossibleMatches(tx, { lastName: "dela cruz", firstName: "JUAN", birthdate: "1985-04-12" }, NOW),
    );
    expect(matches.map((match) => match.name)).toEqual(["DELA CRUZ, Juan"]);
    expect(matches[0]!.age).toBe(41);
  });
});
