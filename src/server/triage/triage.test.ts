import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { opdDate } from "@/lib/time";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

// Monday 2026-09-28, 10:00 in Manila: the seeded Facilities (Mon–Sat 07:00–17:00) are open.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-28T02:00:00.000Z"));
afterAll(() => {
  vi.useRealTimers();
});

const stubs = vi.hoisted(() => ({
  user: { id: "u-nurse", name: "Joy Santos", username: "joy.santos", role: "triage_nurse" as string, facilityIds: [] },
  revalidated: [] as string[],
}));

vi.mock("@/server/auth/session", () => ({ requireStaff: async () => ({ ...stubs.user }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => stubs.revalidated.push(path) }));

const { registerPatientAction } = await import("@/server/patients/actions");
const { getRecordView } = await import("@/server/patients/service");
const { searchPatients } = await import("@/server/patients/queries");
const { patients } = await import("@/server/patients/schema");
const { listFacilities, urgencyLevels } = await import("@/server/settings/queries");
const { queueEntries } = await import("@/server/queue/schema");
const { visits } = await import("@/server/visits/schema");
const { transition } = await import("@/server/visits/service");
const { triageRecords } = await import("./schema");
const { getTriageContextAction, recordTriageAction } = await import("./actions");
const { isActiveVisitConflict, recordTriage, sortGroupFor } = await import("./service");
const { triageInputSchema } = await import("./schemas");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const nurse: Actor = { type: "staff", id: "u-nurse", name: "Joy Santos" };

beforeEach(() => {
  t = createTestDb();
  process.env.DATABASE_PATH = t.filePath;
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(40, "x");
  resetEnvForTests();
  closeDb();
  stubs.user.role = "triage_nurse";
  stubs.revalidated.length = 0;
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

const YEAR = Number(opdDate().slice(0, 4));

/** Register a patient and return their id. `age` is on Jan 1 birthdays, so it holds all year. */
async function register(fields: { lastName: string; firstName: string; sex: string; age: number } & Record<string, unknown>) {
  const { age, ...rest } = fields;
  const result = await registerPatientAction({
    birthdate: `${YEAR - age}-01-01`,
    addressBarangay: "Poblacion",
    addressMunicipality: "San Jose",
    contactNumber: "0917 123 4567",
    privacyNoticeExplained: true,
    ...rest,
  });
  if (!result.ok || result.data.status !== "created") throw new Error("expected created");
  return result.data.patient.id;
}

const lola = () => register({ lastName: "Carmen", firstName: "Lola", sex: "female", age: 72, seniorCitizenId: "SC-0001" });
const juan = () => register({ lastName: "Dela Cruz", firstName: "Juan", sex: "male", age: 41 });
const ana = () => register({ lastName: "Reyes", firstName: "Ana", sex: "female", age: 45 });

function levelId(name: string): string {
  const level = urgencyLevels(t.db).find((l) => l.name === name);
  if (!level) throw new Error(`no level ${name}`);
  return level.id;
}

function facilityId(name: string): string {
  const facility = listFacilities(new Date(), t.db).find((f) => f.name === name);
  if (!facility) throw new Error(`no Facility ${name}`);
  return facility.id;
}

function input(patientId: string, overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    chiefComplaint: "Cough for 3 days",
    temperatureC: "37.0",
    bpSystolic: "120",
    bpDiastolic: "80",
    pulse: "80",
    respiratoryRate: "16",
    spo2: "",
    weightKg: "",
    urgencyLevelId: levelId("Routine"),
    priorityCategory: "",
    facilityId: facilityId("Consultation"),
    ...overrides,
  };
}

const allVisits = () => t.db.select().from(visits).all();
const allTriage = () => t.db.select().from(triageRecords).all();
const triageAudit = () =>
  t.db
    .select()
    .from(auditLog)
    .all()
    .filter((row) => row.action === "triage.recorded")
    .map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
const patientRow = (id: string) => t.db.select().from(patients).all().find((p) => p.id === id)!;

function expectNothingSaved() {
  expect(allVisits()).toHaveLength(0);
  expect(allTriage()).toHaveLength(0);
  expect(triageAudit()).toHaveLength(0);
  expect(t.db.select().from(queueEntries).all()).toHaveLength(0);
}

describe("recordTriageAction: the I/O matrix", () => {
  it("normal save: a Visit today (queued), the Triage Record with sort_group 3, one audit row", async () => {
    const id = await juan();
    const result = await recordTriageAction(input(id));
    expect(result).toMatchObject({
      ok: true,
      data: {
        urgencyName: "Routine",
        urgencyIsEr: false,
        priorityCategoryName: null,
        sortGroup: 3,
        abnormalFields: [],
        outcome: "queued",
        queue: { queueNumber: "CN-001", ahead: 0, facilityName: "Consultation" },
      },
    });
    const [visit] = allVisits();
    expect(visit).toMatchObject({ patientId: id, status: "in_queue", opdDate: opdDate(), closedAt: null, createdBy: "u-nurse" });
    const [record] = allTriage();
    expect(record).toMatchObject({
      visitId: visit!.id,
      patientId: id,
      chiefComplaint: "Cough for 3 days",
      temperatureC: 37,
      bpSystolic: 120,
      bpDiastolic: 80,
      pulse: 80,
      respiratoryRate: 16,
      spo2: null,
      weightKg: null,
      abnormalFields: "[]",
      urgencyName: "Routine",
      urgencyRank: 2,
      urgencyIsEr: false,
      sortGroup: 3,
      priorityCategory: null,
      priorityIdStatus: null,
      recordedBy: "u-nurse",
    });
    const audits = triageAudit();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entity: "visit", entityId: visit!.id, actorId: "u-nurse" });
    expect(audits[0]!.changes).toEqual({
      patientId: id,
      urgencyLevelId: levelId("Routine"),
      urgencyName: "Routine",
      urgencyRank: 2,
      urgencyIsEr: false,
      urgencyTone: "routine",
      sortGroup: 3,
      priorityCategory: null,
      priorityIdStatus: null,
      outcome: "queued",
      facilityId: facilityId("Consultation"),
      queueNumber: "CN-001",
      ahead: 0,
      closedAt: null,
    });
    expect(stubs.revalidated).toEqual([]);
    // Vital values and the complaint are never audited.
    // Every value is checked; the ids (a random UUID may contain "37") are replaced by a placeholder first.
    let audited = JSON.stringify(audits[0]!.changes);
    for (const knownId of [id, visit!.id, levelId("Routine"), facilityId("Consultation")]) {
      audited = audited.replaceAll(knownId, "<id>");
    }
    expect(audited).not.toMatch(/Cough|temperature|37/);
  });

  it("abnormal: temperature 39.2 saves, flagged", async () => {
    const id = await juan();
    expect(await recordTriageAction(input(id, { temperatureC: "39.2", spo2: "93" }))).toMatchObject({
      ok: true,
      data: { abnormalFields: ["temperatureC", "spo2"] },
    });
    expect(JSON.parse(allTriage()[0]!.abnormalFields)).toEqual(["temperatureC", "spo2"]);
  });

  it("impossible: temperature 93.2 saves nothing", async () => {
    const id = await juan();
    expect(await recordTriageAction(input(id, { temperatureC: "93.2" }))).toEqual({
      ok: false,
      error: {
        code: "invalid",
        message: "Check the highlighted fields.",
        fieldErrors: { temperatureC: "Temperature must be between 30 and 45 °C." },
      },
    });
    expectNothingSaved();
  });

  it("diastolic ≥ systolic: 120/130 saves nothing, error on diastolic", async () => {
    const id = await juan();
    const result = await recordTriageAction(input(id, { bpSystolic: "120", bpDiastolic: "130" }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid", fieldErrors: { bpDiastolic: "Diastolic BP must be lower than systolic." } } });
    expectNothingSaved();
  });

  it("missing required fields save nothing", async () => {
    const id = await juan();
    const result = await recordTriageAction(input(id, { chiefComplaint: "", pulse: "", urgencyLevelId: "" }));
    expect(result).toMatchObject({
      ok: false,
      error: { fieldErrors: { chiefComplaint: "Enter the chief complaint.", pulse: "Enter the pulse.", urgencyLevelId: "Choose an Urgency Level." } },
    });
    expectNothingSaved();
  });

  it("urgent: rank 1 gives sort_group 1", async () => {
    const id = await juan();
    await recordTriageAction(input(id, { urgencyLevelId: levelId("Urgent") }));
    expect(allTriage()[0]).toMatchObject({ urgencyRank: 1, sortGroup: 1, urgencyName: "Urgent" });
  });

  it("Senior Citizen, ID on file, age 72: sort_group 2, on_file", async () => {
    const id = await lola();
    const result = await recordTriageAction(input(id, { priorityCategory: "senior_citizen" }));
    expect(result).toMatchObject({ ok: true, data: { sortGroup: 2, priorityCategoryName: "Senior Citizen" } });
    expect(allTriage()[0]).toMatchObject({ sortGroup: 2, priorityCategory: "senior_citizen", priorityIdStatus: "on_file" });
    expect(triageAudit()[0]!.changes).toMatchObject({ priorityCategory: "senior_citizen", priorityIdStatus: "on_file" });
    expect(triageAudit()[0]!.changes).not.toHaveProperty("seniorCitizenId");
  });

  it("Senior Citizen under 60 is refused", async () => {
    const id = await ana();
    expect(await recordTriageAction(input(id, { priorityCategory: "senior_citizen", idNotPresented: true }))).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { priorityCategory: "Senior Citizen is for patients aged 60 and over." } },
    });
    expectNothingSaved();
  });

  it("PWD with no ID and ID not presented ticked: saved as not_presented", async () => {
    const id = await juan();
    await recordTriageAction(input(id, { priorityCategory: "pwd", idNotPresented: true }));
    expect(allTriage()[0]).toMatchObject({ priorityCategory: "pwd", priorityIdStatus: "not_presented", sortGroup: 2 });
    expect(patientRow(id).pwdId).toBeNull();
  });

  it("PWD with the ID typed: saved to the patient, old/new in the audit row", async () => {
    const id = await juan();
    const before = patientRow(id);
    await recordTriageAction(input(id, { priorityCategory: "pwd", priorityId: " PWD-123 " }));
    expect(allTriage()[0]).toMatchObject({ priorityIdStatus: "entered" });
    expect(patientRow(id).pwdId).toBe("PWD-123");
    // The record page shows the new ID.
    expect(stubs.revalidated).toEqual([`/patients/${id}`]);
    expect(patientRow(id).updatedAt >= before.updatedAt).toBe(true);
    expect(triageAudit()[0]!.changes).toMatchObject({ pwdId: { old: null, new: "PWD-123" }, priorityIdStatus: "entered" });
    // One audit row: the patient update isn't audited separately.
    expect(t.db.select().from(auditLog).all().filter((row) => row.action === "patient.updated")).toHaveLength(0);
  });

  it("Senior Citizen or PWD without an ID or ID not presented is refused", async () => {
    const id = await juan();
    expect(await recordTriageAction(input(id, { priorityCategory: "pwd" }))).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { priorityId: "Enter the PWD ID, or tick ID not presented." } },
    });
    expectNothingSaved();
  });

  it("Pregnant for a male patient is refused", async () => {
    const id = await juan();
    expect(await recordTriageAction(input(id, { priorityCategory: "pregnant" }))).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { priorityCategory: "Pregnant is for female patients only." } },
    });
    expectNothingSaved();
  });

  it("a disabled category is refused, an enabled one saves", async () => {
    const id = await ana();
    t.db.run(sql`update priority_categories set enabled = 0 where code = 'pregnant'`);
    expect(await recordTriageAction(input(id, { priorityCategory: "pregnant" }))).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { priorityCategory: expect.stringContaining("isn't available") } },
    });
    expectNothingSaved();
    t.db.run(sql`update priority_categories set enabled = 1 where code = 'pregnant'`);
    expect(await recordTriageAction(input(id, { priorityCategory: "pregnant" }))).toMatchObject({ ok: true, data: { sortGroup: 2 } });
  });

  it("already open: a second triage the same day saves nothing", async () => {
    const id = await juan();
    await recordTriageAction(input(id));
    expect(await recordTriageAction(input(id))).toEqual({
      ok: false,
      error: { code: "visit_already_open", message: "DELA CRUZ, Juan already has an open Visit today." },
    });
    expect(allVisits()).toHaveLength(1);
    expect(triageAudit()).toHaveLength(1);
  });

  it("a closed Visit today doesn't block a new triage", async () => {
    const id = await juan();
    const first = await recordTriageAction(input(id));
    if (!first.ok) throw new Error("expected ok");
    t.db.transaction((tx) => transition(tx, first.data.visitId, "cancelled"));
    expect(await recordTriageAction(input(id))).toMatchObject({ ok: true });
  });

  it("Facility Staff are forbidden, saving nothing", async () => {
    const id = await juan();
    stubs.user.role = "facility_staff";
    expect(await recordTriageAction(input(id))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expectNothingSaved();
  });

  it("an Admin may record triage", async () => {
    const id = await juan();
    stubs.user.role = "admin";
    expect(await recordTriageAction(input(id))).toMatchObject({ ok: true });
  });

  it("ER level with Direct to ER: saved with urgency_is_er and no sort_group; the Visit is Directed to ER", async () => {
    const id = await lola();
    const result = await recordTriageAction(
      input(id, { urgencyLevelId: levelId("Emergency"), priorityCategory: "senior_citizen", facilityId: "", directToEr: true }),
    );
    expect(result).toMatchObject({ ok: true, data: { outcome: "directed_to_er", queue: null, closedAt: expect.any(String) } });
    expect(allTriage()[0]).toMatchObject({ urgencyIsEr: true, urgencyRank: null, sortGroup: null, priorityCategory: "senior_citizen" });
    expect(allVisits()[0]).toMatchObject({ status: "directed_to_er", closedAt: expect.any(String) });
    expect(t.db.select().from(queueEntries).all()).toHaveLength(0);
  });

  it("ER level with a Facility (no confirmation): nothing saved, invalid", async () => {
    const id = await lola();
    expect(await recordTriageAction(input(id, { urgencyLevelId: levelId("Emergency") }))).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expectNothingSaved();
  });

  it("a deactivated patient is refused, saving nothing", async () => {
    const id = await juan();
    t.db.run(sql`update patients set deactivated_at = ${new Date().toISOString()} where id = ${id}`);
    expect(await recordTriageAction(input(id))).toMatchObject({ ok: false, error: { code: "patient_deactivated" } });
    expect(await getTriageContextAction({ patientId: id })).toMatchObject({ ok: false, error: { code: "patient_deactivated" } });
    expectNothingSaved();
  });

  it("an unknown patient or inactive Urgency Level is refused", async () => {
    const id = await juan();
    expect(await recordTriageAction(input("nope"))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await recordTriageAction(input(id, { urgencyLevelId: "gone" }))).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { urgencyLevelId: expect.any(String) } },
    });
    expectNothingSaved();
  });
});

describe("sort_group", () => {
  const levels = [
    { isEr: false, rank: 1 },
    { isEr: false, rank: 2 },
    { isEr: false, rank: 3 },
    { isEr: false, rank: 4 },
    { isEr: true, rank: null },
  ];

  it("with four levels: ranks above the lowest are group 1; the lowest is 2 with a category, else 3; ER is null", () => {
    expect(sortGroupFor({ isEr: false, rank: 1 }, levels, false)).toBe(1);
    expect(sortGroupFor({ isEr: false, rank: 3 }, levels, true)).toBe(1);
    expect(sortGroupFor({ isEr: false, rank: 4 }, levels, true)).toBe(2);
    expect(sortGroupFor({ isEr: false, rank: 4 }, levels, false)).toBe(3);
    expect(sortGroupFor({ isEr: true, rank: null }, levels, true)).toBeNull();
  });

  it("reads the levels from settings at save time", async () => {
    const id = await juan();
    const now = new Date().toISOString();
    t.db.run(sql`insert into urgency_levels (id, name, is_er, rank, created_at, updated_at)
      values ('lvl-3', 'Semi-urgent', 0, 3, ${now}, ${now}), ('lvl-4', 'Non-urgent', 0, 4, ${now}, ${now})`);
    // Routine (rank 2) is no longer the lowest: group 1.
    await recordTriageAction(input(id));
    expect(allTriage()[0]).toMatchObject({ urgencyName: "Routine", urgencyRank: 2, sortGroup: 1 });

    const other = await ana();
    await recordTriageAction(input(other, { urgencyLevelId: "lvl-4", priorityCategory: "pwd", idNotPresented: true }));
    expect(allTriage().find((r) => r.patientId === other)).toMatchObject({ urgencyRank: 4, sortGroup: 2 });
  });
});

describe("urgency_tone snapshot", () => {
  it("is stored at save time and never recolours after a settings change", async () => {
    const id = await juan();
    await recordTriageAction(input(id));
    expect(allTriage()[0]!.urgencyTone).toBe("routine");
    // A new, less urgent level makes Routine an in-between rank today…
    const now = new Date().toISOString();
    t.db.run(sql`insert into urgency_levels (id, name, is_er, rank, created_at, updated_at) values ('lvl-9', 'Non-urgent', 0, 9, ${now}, ${now})`);
    // …but the stored tone and the record's Visit history keep the old colour.
    expect(allTriage()[0]!.urgencyTone).toBe("routine");
    expect(getRecordView(id, nurse, undefined, t.db)!.visits[0]!.urgency).toEqual({ name: "Routine", isEr: false, tone: "routine" });
    // A save now gets today's tone.
    const other = await ana();
    expect(await recordTriageAction(input(other))).toMatchObject({ ok: true, data: { urgencyTone: "abnormal" } });
  });
});

describe("isActiveVisitConflict", () => {
  it("recognises the one-active-Visit unique violation", async () => {
    const id = await juan();
    await recordTriageAction(input(id));
    let caught: unknown;
    try {
      t.db.run(sql`insert into visits (id, patient_id, opd_date, status, opened_at, created_by, updated_at)
        values ('v-dup', ${id}, ${opdDate()}, 'open', 'x', 'x', 'x')`);
    } catch (error) {
      caught = error;
    }
    expect(isActiveVisitConflict(caught)).toBe(true);
    expect(isActiveVisitConflict(new Error("UNIQUE constraint failed: patients.hospital_number"))).toBe(false);
  });
});

describe("recordTriage", () => {
  it("stores the Visit's opd_date in Manila and the times at the command's now", async () => {
    const id = await juan();
    const now = new Date("2031-05-06T17:30:00.000Z"); // May 7 in Manila, 01:30
    t.db.run(sql`update facilities set open_days = '[1,2,3,4,5,6,7]', open_time = '00:00', close_time = '23:59' where name = 'Consultation'`);
    const parsed = triageInputSchema.parse(input(id));
    const outcome = recordTriage(parsed, nurse, now, t.db);
    expect(outcome.opdDate).toBe("2031-05-07");
    expect(allVisits()[0]).toMatchObject({ opdDate: "2031-05-07", openedAt: now.toISOString() });
    expect(allTriage()[0]!.recordedAt).toBe(now.toISOString());
    expect(triageAudit()[0]!.at).toBe(now.toISOString());
  });
});

describe("reads", () => {
  it("the record's Visit history and the finder's last visit come from visits", async () => {
    const id = await lola();
    expect(searchPatients({ q: "carmen" }, t.db).rows[0]!.lastVisit).toBeNull();
    await recordTriageAction(input(id, { priorityCategory: "senior_citizen", urgencyLevelId: levelId("Urgent") }));
    expect(searchPatients({ q: "carmen" }, t.db).rows[0]!.lastVisit).toBe(opdDate());
    const view = getRecordView(id, nurse, undefined, t.db)!;
    expect(view.visits).toEqual([
      {
        id: allVisits()[0]!.id,
        opdDate: opdDate(),
        dateLabel: expect.any(String),
        status: "in_queue",
        statusLabel: "In queue",
        urgency: { name: "Urgent", isEr: false, tone: "urgent" },
      },
    ]);
    // No clinical values in the record view.
    expect(JSON.stringify(view.visits)).not.toMatch(/Cough|temperature/i);
  });
});

describe("getTriageContextAction", () => {
  it("says whether an ID is on file (not the ID) and whether a Visit is open", async () => {
    const id = await lola();
    const before = await getTriageContextAction({ patientId: id });
    expect(before).toMatchObject({
      ok: true,
      data: { patientId: id, sex: "female", age: 72, seniorCitizenIdOnFile: true, pwdIdOnFile: false, openVisit: false },
    });
    expect(JSON.stringify(before)).not.toContain("SC-0001");
    if (before.ok) {
      expect(before.data.levels.map((l) => l.name)).toEqual(["Urgent", "Routine", "Emergency"]);
      expect(before.data.categories.map((c) => c.code)).toEqual(["senior_citizen", "pwd", "pregnant"]);
      expect(before.data.facilities.map((f) => [f.name, f.available])).toEqual([
        ["Prenatal", true],
        ["Animal Bite Center", true],
        ["Treatment", true],
        ["Consultation", true],
      ]);
    }
    await recordTriageAction(input(id));
    expect(await getTriageContextAction({ patientId: id })).toMatchObject({ ok: true, data: { openVisit: true } });
  });

  it("is refused for Facility Staff and unknown patients", async () => {
    const id = await juan();
    expect(await getTriageContextAction({ patientId: "nope" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    stubs.user.role = "facility_staff";
    expect(await getTriageContextAction({ patientId: id })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});
