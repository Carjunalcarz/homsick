import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => ({
  user: { id: "u-nurse", name: "Joy Santos", username: "joy.santos", role: "triage_nurse" as string, facilityIds: [] },
  revalidated: [] as string[],
}));

vi.mock("@/server/auth/session", () => ({ requireStaff: async () => ({ ...stubs.user }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => stubs.revalidated.push(path) }));

const { registerPatientAction, updatePatientAction } = await import("./actions");
const { getRecordView, updatePatient } = await import("./service");
const { searchPatients } = await import("./queries");
const { patientEditSchema } = await import("./schemas");
const { patients } = await import("./schema");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const nurse: Actor = { type: "staff", id: "u-nurse", name: "Joy Santos" };
const staff: Actor = { type: "staff", id: "u-staff", name: "Ben Reyes" };

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

const JUAN = {
  lastName: "Dela Cruz",
  firstName: "Juan",
  middleName: "Santos",
  sex: "male",
  birthdate: "1985-04-12",
  addressBarangay: "Poblacion",
  addressMunicipality: "San Jose",
  contactNumber: "0917 123 4567",
  philhealthPin: "12-345678901-2",
  privacyNoticeExplained: true,
};

/** Register a patient and return their id. */
async function register(overrides: Record<string, unknown> = {}): Promise<string> {
  const result = await registerPatientAction({ ...JUAN, ...overrides });
  if (!result.ok || result.data.status !== "created") throw new Error("expected created");
  return result.data.patient.id;
}

/** The edit form as it opens for a patient: every stored field, as typed. */
function editInput(id: string, overrides: Record<string, unknown> = {}) {
  const row = t.db.select().from(patients).all().find((p) => p.id === id)!;
  return {
    id,
    expectedUpdatedAt: row.updatedAt,
    lastName: row.lastName,
    firstName: row.firstName,
    middleName: row.middleName ?? "",
    suffix: row.suffix ?? "",
    sex: row.sex,
    birthdate: row.birthdate,
    addressBarangay: row.addressBarangay,
    addressMunicipality: row.addressMunicipality,
    contactNumber: row.contactNumber,
    philhealthPin: row.philhealthPin ?? "",
    seniorCitizenId: row.seniorCitizenId ?? "",
    pwdId: row.pwdId ?? "",
    emergencyContactName: row.emergencyContactName ?? "",
    emergencyContactNumber: row.emergencyContactNumber ?? "",
    ...overrides,
  };
}

function auditRows(action?: string) {
  return t.db
    .select()
    .from(auditLog)
    .all()
    .filter((row) => !action || row.action === action)
    .map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
}

function patientRow(id: string) {
  return t.db.select().from(patients).all().find((p) => p.id === id)!;
}

describe("getRecordView", () => {
  it("returns the whole record, age, no visits and the name, with one patient.viewed row", async () => {
    const id = await register();
    const view = getRecordView(id, nurse, new Date("2026-09-27T02:00:00.000Z"), t.db);
    expect(view).toMatchObject({
      name: "DELA CRUZ, Juan Santos",
      age: 41,
      visits: [],
      patient: { id, contactNumber: "09171234567", philhealthPin: "12-345678901-2", addressBarangay: "Poblacion" },
    });
    expect(view!.patient).not.toHaveProperty("searchText");
    const views = auditRows("patient.viewed");
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ entity: "patient", entityId: id, actorId: "u-nurse", changes: null });
  });

  it("writes one row per view, for Facility Staff too", async () => {
    const id = await register();
    getRecordView(id, nurse, undefined, t.db);
    getRecordView(id, staff, undefined, t.db);
    expect(auditRows("patient.viewed").map((row) => row.actorId)).toEqual(["u-nurse", "u-staff"]);
  });

  it("returns null for an unknown id, with no audit row", () => {
    expect(getRecordView("nope", nurse, undefined, t.db)).toBeNull();
    expect(getRecordView("", nurse, undefined, t.db)).toBeNull();
    expect(getRecordView("x".repeat(65), nurse, undefined, t.db)).toBeNull();
    expect(auditRows()).toHaveLength(0);
  });

  it("still opens a deactivated patient", async () => {
    const id = await register();
    t.db.run(sql`update patients set deactivated_at = '2026-09-01T00:00:00.000Z'`);
    expect(getRecordView(id, nurse, undefined, t.db)?.patient.deactivatedAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("updatePatientAction", () => {
  it("saves a changed contact number in normalized form, auditing only that field", async () => {
    const id = await register();
    const result = await updatePatientAction(editInput(id, { contactNumber: "+63 918 000 1111" }));
    expect(result).toEqual({ ok: true, data: { status: "updated", changed: true, name: "DELA CRUZ, Juan Santos" } });
    expect(patientRow(id).contactNumber).toBe("09180001111");
    const updates = auditRows("patient.updated");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ entity: "patient", entityId: id, actorId: "u-nurse" });
    expect(updates[0]!.changes).toEqual({ contactNumber: { old: "09171234567", new: "09180001111" } });
    expect(stubs.revalidated).toEqual([`/patients/${id}`]);
  });

  it("audits old and new for each changed field only (barangay, a cleared optional field)", async () => {
    const id = await register();
    await updatePatientAction(editInput(id, { addressBarangay: "San Roque", philhealthPin: "", seniorCitizenId: "SC-1" }));
    expect(auditRows("patient.updated")[0]!.changes).toEqual({
      addressBarangay: { old: "Poblacion", new: "San Roque" },
      philhealthPin: { old: "12-345678901-2", new: null },
      seniorCitizenId: { old: null, new: "SC-1" },
    });
    expect(patientRow(id)).toMatchObject({ addressBarangay: "San Roque", philhealthPin: null, seniorCitizenId: "SC-1" });
  });

  it("writes nothing for a save without changes", async () => {
    const id = await register();
    const before = patientRow(id);
    // The PIN typed without dashes and the phone with spaces store the same values.
    const result = await updatePatientAction(
      editInput(id, { philhealthPin: "123456789012", contactNumber: "0917 123 4567" }),
    );
    expect(result).toEqual({ ok: true, data: { status: "updated", changed: false, name: "DELA CRUZ, Juan Santos" } });
    expect(patientRow(id)).toEqual(before);
    expect(auditRows("patient.updated")).toHaveLength(0);
    // No re-render, so no extra patient.viewed row.
    expect(stubs.revalidated).toEqual([]);
  });

  it("refuses a save over a change made since the form opened (stale), keeping the first save", async () => {
    const id = await register();
    const opened = editInput(id);
    // Another editor saves first.
    expect(await updatePatientAction({ ...opened, addressBarangay: "San Roque" })).toMatchObject({
      ok: true,
      data: { changed: true },
    });
    stubs.revalidated.length = 0;
    // This editor's form still holds the old updated_at and the old barangay.
    const result = await updatePatientAction({ ...opened, contactNumber: "09990000000" });
    expect(result).toEqual({
      ok: false,
      error: { code: "stale", message: "This record changed since you opened it. Reload to see the latest details." },
    });
    expect(patientRow(id)).toMatchObject({ addressBarangay: "San Roque", contactNumber: "09171234567" });
    expect(auditRows("patient.updated")).toHaveLength(1);
    expect(stubs.revalidated).toEqual([]);

    // Reopened with the current updated_at: saves.
    expect(await updatePatientAction(editInput(id, { contactNumber: "09990000000" }))).toMatchObject({
      ok: true,
      data: { changed: true },
    });
    expect(auditRows("patient.updated")).toHaveLength(2);
  });

  it("treats a missing expectedUpdatedAt as stale", async () => {
    const id = await register();
    const { expectedUpdatedAt: _omit, ...input } = editInput(id, { addressBarangay: "San Roque" });
    void _omit;
    expect(await updatePatientAction(input)).toMatchObject({ ok: false, error: { code: "stale" } });
    expect(patientRow(id).addressBarangay).toBe("Poblacion");
  });

  it("updates search_text on a rename, so the finder finds the new name", async () => {
    const id = await register();
    const result = await updatePatientAction(editInput(id, { lastName: "Reyes", firstName: "Juanito" }));
    expect(result).toMatchObject({ ok: true, data: { changed: true, name: "REYES, Juanito Santos" } });
    expect(searchPatients({ q: "juanito reyes" }, t.db).rows.map((row) => row.id)).toEqual([id]);
    expect(searchPatients({ q: "reyes, juanito" }, t.db).total).toBe(1);
    expect(searchPatients({ q: "dela cruz" }, t.db).total).toBe(0);
  });

  it("returns possible_match for a rename to another active patient's name and birthdate, saving nothing", async () => {
    const juan = await register();
    const pedro = await register({ firstName: "Pedro", middleName: "" });
    const before = patientRow(pedro);
    const result = await updatePatientAction(editInput(pedro, { firstName: "JUAN" }));
    if (!result.ok || result.data.status !== "possible_match") throw new Error("expected possible_match");
    expect(result.data.matches.map((match) => match.id)).toEqual([juan]);
    expect(patientRow(pedro)).toEqual(before);
    expect(auditRows("patient.updated")).toHaveLength(0);
    expect(stubs.revalidated).toEqual([]);

    // Confirmed with the ids shown: saved.
    const confirmed = await updatePatientAction(editInput(pedro, { firstName: "Juan", confirmedMatchIds: [juan] }));
    expect(confirmed).toMatchObject({ ok: true, data: { status: "updated", changed: true } });
    expect(auditRows("patient.updated")[0]!.changes).toEqual({ firstName: { old: "Pedro", new: "Juan" } });
  });

  it("doesn't match the patient themself, or ask when the name and birthdate stay the same", async () => {
    const juan = await register();
    // A second Juan registered with "Create anyway".
    const twin = await registerPatientAction({ ...JUAN, confirmedMatchIds: [juan] });
    if (!twin.ok || twin.data.status !== "created") throw new Error("expected created");
    // A contact change on either never asks.
    expect(await updatePatientAction(editInput(juan, { contactNumber: "09990000000" }))).toMatchObject({
      ok: true,
      data: { status: "updated", changed: true },
    });
    // A change of name case only: the twin still matches, so it asks.
    const recase = await updatePatientAction(editInput(juan, { firstName: "JUAN" }));
    expect(recase).toMatchObject({ ok: true, data: { status: "possible_match" } });
    if (recase.ok && recase.data.status === "possible_match") {
      expect(recase.data.matches.map((match) => match.id)).toEqual([twin.data.patient.id]);
    }
  });

  it("forbids Facility Staff, saving and auditing nothing", async () => {
    const id = await register();
    stubs.user.role = "facility_staff";
    const before = patientRow(id);
    expect(await updatePatientAction(editInput(id, { addressBarangay: "San Roque" }))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(patientRow(id)).toEqual(before);
    expect(auditRows("patient.updated")).toHaveLength(0);
  });

  it("lets an Admin edit", async () => {
    const id = await register();
    stubs.user.role = "admin";
    expect(await updatePatientAction(editInput(id, { addressBarangay: "San Roque" }))).toMatchObject({ ok: true });
  });

  it("returns not_found for an unknown or missing id, saving nothing", async () => {
    const id = await register();
    const input = editInput(id, { addressBarangay: "San Roque" });
    expect(await updatePatientAction({ ...input, id: "nope" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    const { id: _omit, ...withoutId } = input;
    void _omit;
    expect(await updatePatientAction(withoutId)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(patientRow(id).addressBarangay).toBe("Poblacion");
    expect(auditRows("patient.updated")).toHaveLength(0);
  });

  it("refuses invalid fields with field errors and no audit row", async () => {
    const id = await register();
    const result = await updatePatientAction(
      editInput(id, { birthdate: "2999-01-01", philhealthPin: "1234", lastName: "Cruz2" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid",
        fieldErrors: {
          birthdate: "Birthdate can't be in the future.",
          philhealthPin: "PhilHealth PIN must be 12 digits.",
          lastName: "Use letters, spaces, . ' and - only.",
        },
      },
    });
    expect(auditRows("patient.updated")).toHaveLength(0);
  });

  it("never changes the Hospital Number, created_* or privacy_notice_at", async () => {
    const id = await register();
    const before = patientRow(id);
    await updatePatientAction({
      ...editInput(id, { addressBarangay: "San Roque" }),
      hospitalNumber: "HN-1999-000001",
      createdAt: "2000-01-01T00:00:00.000Z",
      createdBy: "someone",
      privacyNoticeAt: "2000-01-01T00:00:00.000Z",
      privacyNoticeExplained: false,
    });
    const after = patientRow(id);
    expect(after).toMatchObject({
      hospitalNumber: before.hospitalNumber,
      createdAt: before.createdAt,
      createdBy: before.createdBy,
      privacyNoticeAt: before.privacyNoticeAt,
      addressBarangay: "San Roque",
    });
  });
});

describe("updatePatient", () => {
  it("stores updated_at as the command's now, and writes the audit row at that time", async () => {
    const id = await register();
    const now = new Date("2031-05-06T07:08:09.000Z");
    const input = patientEditSchema.parse(editInput(id, { addressBarangay: "San Roque" }));
    expect(updatePatient(input, nurse, now, t.db)).toEqual({ status: "updated", changed: true, name: "DELA CRUZ, Juan Santos" });
    expect(patientRow(id).updatedAt).toBe("2031-05-06T07:08:09.000Z");
    expect(auditRows("patient.updated")[0]!.at).toBe("2031-05-06T07:08:09.000Z");
  });

  it("throws stale when the row's updated_at isn't the expected one", async () => {
    const id = await register();
    const input = patientEditSchema.parse(editInput(id, { addressBarangay: "San Roque", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }));
    expect(() => updatePatient(input, nurse, undefined, t.db)).toThrow(expect.objectContaining({ code: "stale" }));
    expect(patientRow(id).addressBarangay).toBe("Poblacion");
    expect(auditRows("patient.updated")).toHaveLength(0);
  });

  it("throws not_found inside the command for an unknown id", () => {
    const input = patientEditSchema.parse({ ...JUAN, id: "missing", expectedUpdatedAt: "2026-09-27T02:00:00.000Z" });
    expect(() => updatePatient(input, nurse, undefined, t.db)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(auditRows()).toHaveLength(0);
  });
});
