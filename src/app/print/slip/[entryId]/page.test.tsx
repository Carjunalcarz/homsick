import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triageInputSchema } from "@/lib/triage";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => ({
  user: { id: "u-nurse", name: "Joy Santos", username: "joy.santos", role: "triage_nurse" as string, facilityIds: [] as string[] },
  signedIn: true,
}));

vi.mock("@/server/auth/session", async () => {
  const { redirect } = await import("next/navigation");
  return {
    requireStaff: async () => {
      if (!stubs.signedIn) redirect("/sign-in?next=%2Fprint%2Fslip%2Fx");
      return { ...stubs.user };
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { insertPatient, nextHospitalNumber } = await import("@/server/patients/repo");
const { listFacilities, urgencyLevels } = await import("@/server/settings/queries");
const { updateOpdThresholds } = await import("@/server/settings/service");
const { recordTriage } = await import("@/server/triage/service");
const { queueCounters, queueEntries } = await import("@/server/queue/schema");
const { default: QueueSlipPage, generateMetadata } = await import("./page");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const nurse: Actor = { type: "staff", id: "u-nurse", name: "Joy Santos" };
const admin: Actor = { type: "staff", id: "u-admin", name: "Ana Reyes" };

/** Monday 2026-09-28, 8:14 in Manila: the seeded Facilities (Mon–Sat 07:00–17:00) are open. */
const MON_0814 = new Date("2026-09-28T00:14:00.000Z");
const TODAY = "2026-09-28";

/** Everything identifying the patient or the triage that must never reach the slip. */
const PATIENT = {
  lastName: "Villanueva",
  firstName: "Rosalinda",
  complaint: "Persistent cough with fever",
  contact: "09175550123",
  seniorId: "SC-778899",
};

beforeEach(() => {
  t = createTestDb();
  process.env.DATABASE_PATH = t.filePath;
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(40, "x");
  resetEnvForTests();
  closeDb();
  stubs.user.role = "triage_nurse";
  stubs.signedIn = true;
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

function facilityId(name: string): string {
  const facility = listFacilities(MON_0814, t.db).find((f) => f.name === name);
  if (!facility) throw new Error(`no Facility ${name}`);
  return facility.id;
}

/** A Senior Citizen triaged Urgent at Consultation, after 13 numbers today: CN-014. Returns the Queue Entry id. */
function issueCn014(): { entryId: string; hospitalNumber: string } {
  const consultation = facilityId("Consultation");
  t.db.insert(queueCounters).values({ facilityId: consultation, opdDate: TODAY, lastSeq: 13 }).run();
  const id = crypto.randomUUID();
  let hospitalNumber = "";
  t.db.transaction((tx) => {
    hospitalNumber = nextHospitalNumber(tx, 2026);
    insertPatient(tx, {
      id,
      hospitalNumber,
      lastName: PATIENT.lastName,
      firstName: PATIENT.firstName,
      sex: "female",
      birthdate: "1950-03-04",
      seniorCitizenId: PATIENT.seniorId,
      addressBarangay: "Poblacion",
      addressMunicipality: "San Jose",
      contactNumber: PATIENT.contact,
      privacyNoticeAt: MON_0814.toISOString(),
      createdAt: MON_0814.toISOString(),
      updatedAt: MON_0814.toISOString(),
      createdBy: "u-test",
    });
  });
  const urgent = urgencyLevels(t.db).find((l) => l.name === "Urgent")!;
  const outcome = recordTriage(
    triageInputSchema.parse({
      patientId: id,
      chiefComplaint: PATIENT.complaint,
      temperatureC: "38.4",
      bpSystolic: "150",
      bpDiastolic: "95",
      pulse: "104",
      respiratoryRate: "22",
      urgencyLevelId: urgent.id,
      priorityCategory: "senior_citizen",
      facilityId: consultation,
    }),
    nurse,
    MON_0814,
    t.db,
  );
  if (outcome.outcome !== "queued") throw new Error("expected a Queue Number");
  expect(outcome.queue.queueNumber).toBe("CN-014");
  return { entryId: outcome.queue.entryId, hospitalNumber };
}

async function renderSlip(entryId: string): Promise<string> {
  const page = (await QueueSlipPage({ params: Promise.resolve({ entryId }) })) as ReactElement;
  return renderToStaticMarkup(page);
}

/** The visible text of the markup, tags stripped. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const auditRows = () => t.db.select().from(auditLog).all();

describe("/print/slip/[entryId]", () => {
  it("shows the hospital name, Facility, CN-014, the Manila date and time and the wait line", async () => {
    const { entryId } = issueCn014();
    const html = await renderSlip(entryId);
    expect(textOf(html)).toBe(
      "Queue slip Hospital OPD Consultation CN-014 Sep 28, 2026 · 8:14 AM Please wait for your number on the screen.",
    );
    // The iframe checks for the marker; the heading is visually hidden.
    expect(html).toContain("data-queue-slip");
    expect(html).toMatch(/<h1 class="sr-only">Queue slip<\/h1>/);
    expect(await generateMetadata()).toEqual({ title: "Queue slip" });
  });

  it("an Admin can print it too", async () => {
    const { entryId } = issueCn014();
    stubs.user.role = "admin";
    expect(textOf(await renderSlip(entryId))).toContain("CN-014");
  });

  it("has no patient identifiers, complaint, category, group or urgency in the HTML, and writes no audit row", async () => {
    const { entryId, hospitalNumber } = issueCn014();
    const before = auditRows().length;
    const html = await renderSlip(entryId);
    for (const secret of [
      PATIENT.lastName,
      PATIENT.firstName,
      PATIENT.complaint,
      PATIENT.contact,
      PATIENT.seniorId,
      hospitalNumber,
      "HN-",
      "Senior",
      "senior_citizen",
      "Urgent",
      "Routine",
      "38.4",
      "1950",
    ]) {
      expect(html.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(auditRows()).toHaveLength(before);
  });

  it("gives a 404 for an unknown or overlong id", async () => {
    issueCn014();
    for (const entryId of ["nope", "x".repeat(65)]) {
      await expect(QueueSlipPage({ params: Promise.resolve({ entryId }) })).rejects.toMatchObject({
        digest: expect.stringContaining("404"),
      });
    }
  });

  it("gives a 404 for a paper entry (they have no slip)", async () => {
    const { entryId } = issueCn014();
    t.db.update(queueEntries).set({ isPaper: true }).run();
    await expect(QueueSlipPage({ params: Promise.resolve({ entryId }) })).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("shows Facility Staff only the no-access text, with no data", async () => {
    const { entryId } = issueCn014();
    stubs.user.role = "facility_staff";
    stubs.user.facilityIds = [facilityId("Consultation")];
    const html = await renderSlip(entryId);
    expect(textOf(html)).toBe("You don't have access to this page.");
    expect(html).not.toContain("data-queue-slip");
    expect(await generateMetadata()).toEqual({ title: "No access" });
    stubs.user.facilityIds = [];
  });

  it("sends a signed-out request to sign-in", async () => {
    stubs.signedIn = false;
    await expect(QueueSlipPage({ params: Promise.resolve({ entryId: "x" }) })).rejects.toMatchObject({
      digest: expect.stringContaining("/sign-in"),
    });
  });

  it("prints the hospital name an Admin sets; the change writes one audit row", async () => {
    const { entryId } = issueCn014();
    const before = auditRows().length;
    const outcome = updateOpdThresholds(
      { prenatalTarget: 8, noShowThreshold: 3, preCloseWarningMinutes: 30, hospitalName: "Ospital ng Maynila" },
      admin,
      MON_0814,
      t.db,
    );
    expect(outcome.changed).toBe(true);
    const rows = auditRows().slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "settings.opd_thresholds_updated", entity: "opd_settings" });
    expect(JSON.parse(rows[0]!.changes!)).toEqual({ hospitalName: { old: "Hospital OPD", new: "Ospital ng Maynila" } });

    expect(textOf(await renderSlip(entryId))).toMatch(/^Queue slip Ospital ng Maynila Consultation CN-014 /);
  });
});
