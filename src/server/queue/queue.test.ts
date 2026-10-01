import { spawn } from "node:child_process";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAhead, formatQueueNumber } from "@/lib/queue-number";
import { triageInputSchema } from "@/lib/triage";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => ({
  user: { id: "u-nurse", name: "Joy Santos", username: "joy.santos", role: "triage_nurse" as string, facilityIds: [] },
}));

vi.mock("@/server/auth/session", () => ({ requireStaff: async () => ({ ...stubs.user }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { insertPatient, nextHospitalNumber } = await import("@/server/patients/repo");
const { listFacilities, urgencyLevels } = await import("@/server/settings/queries");
const { visits } = await import("@/server/visits/schema");
const { recordTriage } = await import("@/server/triage/service");
const { recordTriageAction, getTriageContextAction } = await import("@/server/triage/actions");
const { triageRecords } = await import("@/server/triage/schema");
const { queueCounters, queueEntries } = await import("./schema");
const { aheadOf, facilityTiles, getSlip, liveQueue, waitingCounts } = await import("./queries");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const nurse: Actor = { type: "staff", id: "u-nurse", name: "Joy Santos" };

/** Monday 2026-09-28, 10:00 in Manila: the seeded Facilities (Mon–Sat 07:00–17:00) are open. */
const MON_10 = new Date("2026-09-28T02:00:00.000Z");
const TODAY = "2026-09-28";

beforeEach(() => {
  t = createTestDb();
  process.env.DATABASE_PATH = t.filePath;
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(40, "x");
  resetEnvForTests();
  closeDb();
  stubs.user.role = "triage_nurse";
});

afterEach(() => {
  vi.useRealTimers();
  closeDb();
  t.cleanup();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
});

let patientCount = 0;

/** A patient row, straight into the table (its Hospital Number from the counter). */
function addPatient(fields: { sex?: "female" | "male"; birthdate?: string; seniorCitizenId?: string } = {}): string {
  const id = crypto.randomUUID();
  patientCount++;
  t.db.transaction((tx) => {
    insertPatient(tx, {
      id,
      hospitalNumber: nextHospitalNumber(tx, 2026),
      lastName: `Test${patientCount}`,
      firstName: "Pat",
      sex: fields.sex ?? "female",
      birthdate: fields.birthdate ?? "1985-01-01",
      seniorCitizenId: fields.seniorCitizenId ?? null,
      addressBarangay: "Poblacion",
      addressMunicipality: "San Jose",
      contactNumber: "09175550000",
      privacyNoticeAt: MON_10.toISOString(),
      createdAt: MON_10.toISOString(),
      updatedAt: MON_10.toISOString(),
      createdBy: "u-test",
    });
  });
  return id;
}

const senior = () => addPatient({ birthdate: "1954-01-01", seniorCitizenId: "SC-0001" });

function facilityId(name: string): string {
  const facility = listFacilities(MON_10, t.db).find((f) => f.name === name);
  if (!facility) throw new Error(`no Facility ${name}`);
  return facility.id;
}

function levelId(name: string): string {
  const level = urgencyLevels(t.db).find((l) => l.name === name);
  if (!level) throw new Error(`no level ${name}`);
  return level.id;
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
    urgencyLevelId: levelId("Routine"),
    priorityCategory: "",
    facilityId: facilityId("Consultation"),
    ...overrides,
  };
}

/** Record triage through the service at `now` (default Monday 10:00 Manila). */
function triage(patientId: string, overrides: Record<string, unknown> = {}, now: Date = MON_10) {
  return recordTriage(triageInputSchema.parse(input(patientId, overrides)), nurse, now, t.db);
}

/** Minutes after MON_10, so entry times differ. */
const at = (minutes: number) => new Date(MON_10.getTime() + minutes * 60_000);

const entries = () => t.db.select().from(queueEntries).all();
const allVisits = () => t.db.select().from(visits).all();
const triageAudit = () =>
  t.db
    .select()
    .from(auditLog)
    .all()
    .filter((row) => row.action === "triage.recorded")
    .map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
const consultationQueue = (day = TODAY) => liveQueue(t.db, facilityId("Consultation"), day);

function expectNothingSaved() {
  expect(allVisits()).toHaveLength(0);
  expect(entries()).toHaveLength(0);
  expect(triageAudit()).toHaveLength(0);
  expect(t.db.select().from(queueCounters).all()).toHaveLength(0);
}

describe("formatQueueNumber", () => {
  it("pads to 3 digits and keeps longer sequences whole", () => {
    expect(formatQueueNumber("CN", 1)).toBe("CN-001");
    expect(formatQueueNumber("CN", 14)).toBe("CN-014");
    expect(formatQueueNumber("CN", 999)).toBe("CN-999");
    expect(formatQueueNumber("CN", 1000)).toBe("CN-1000");
    expect(formatQueueNumber("ABC", 7)).toBe("ABC-007");
  });

  it("says Next in line for nobody ahead", () => {
    expect(formatAhead(0)).toBe("Next in line");
    expect(formatAhead(1)).toBe("1 ahead");
    expect(formatAhead(12)).toBe("12 ahead");
  });
});

describe("issuing a Queue Number: the I/O matrix", () => {
  it("first of the day: CN-001, Next in line, the Visit in_queue, one audit row", () => {
    const id = addPatient();
    const outcome = triage(id);
    expect(outcome).toMatchObject({
      outcome: "queued",
      closedAt: null,
      queue: { facilityId: facilityId("Consultation"), facilityName: "Consultation", queueNumber: "CN-001", ahead: 0 },
    });
    expect(allVisits()).toEqual([expect.objectContaining({ status: "in_queue", closedAt: null, opdDate: TODAY })]);
    const [entry] = entries();
    expect(entry).toMatchObject({
      visitId: outcome.visitId,
      facilityId: facilityId("Consultation"),
      opdDate: TODAY,
      prefix: "CN",
      seq: 1,
      status: "waiting",
      sortGroup: 3,
      urgencyRank: 2,
      urgencyLevelId: levelId("Routine"),
      priorityCategory: null,
      enteredAt: MON_10.toISOString(),
      callCount: 0,
      isPaper: false,
      createdBy: "u-nurse",
    });
    const audits = triageAudit();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entity: "visit", entityId: outcome.visitId });
    expect(audits[0]!.changes).toMatchObject({
      outcome: "queued",
      facilityId: facilityId("Consultation"),
      queueNumber: "CN-001",
      ahead: 0,
      sortGroup: 3,
    });
  });

  it("sequence: after 13 issued today, the next is CN-014", () => {
    for (let i = 0; i < 13; i++) triage(addPatient(), {}, at(i));
    expect(triage(addPatient(), {}, at(20)).queue?.queueNumber).toBe("CN-014");
    expect(entries().map((e) => e.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it("each Facility has its own sequence", () => {
    triage(addPatient());
    expect(triage(addPatient(), { facilityId: facilityId("Treatment") }).queue?.queueNumber).toBe("TR-001");
    expect(triage(addPatient()).queue?.queueNumber).toBe("CN-002");
  });

  it("new day: yesterday went up to CN-040, today starts at CN-001", () => {
    t.db.insert(queueCounters).values({ facilityId: facilityId("Consultation"), opdDate: "2026-09-26", lastSeq: 40 }).run();
    expect(triage(addPatient()).queue?.queueNumber).toBe("CN-001");
  });

  it("prefix change pending from tomorrow: today keeps the old prefix, tomorrow uses the new one", () => {
    t.db.run(sql`update facilities set next_prefix = 'CQ', next_prefix_from = '2026-09-29' where name = 'Consultation'`);
    expect(triage(addPatient()).queue?.queueNumber).toBe("CN-001");
    expect(entries()[0]!.prefix).toBe("CN");
    const tuesday = new Date("2026-09-29T02:00:00.000Z");
    expect(triage(addPatient(), {}, tuesday).queue?.queueNumber).toBe("CQ-001");
  });

  it("Senior after 3 Routine: the Senior is first in liveQueue, 0 ahead", () => {
    const routine = [addPatient(), addPatient(), addPatient()];
    routine.forEach((id, i) => triage(id, {}, at(i)));
    const lola = senior();
    const outcome = triage(lola, { priorityCategory: "senior_citizen" }, at(5));
    expect(outcome.queue).toMatchObject({ queueNumber: "CN-004", ahead: 0 });
    expect(formatAhead(outcome.queue!.ahead)).toBe("Next in line");
    expect(consultationQueue().map((e) => e.seq)).toEqual([4, 1, 2, 3]);
    expect(consultationQueue()[0]).toMatchObject({ sortGroup: 2, priorityCategory: "senior_citizen" });
  });

  it("same group: arrival order", () => {
    triage(addPatient(), {}, at(0));
    const second = triage(addPatient(), {}, at(1));
    expect(second.queue?.ahead).toBe(1);
    expect(consultationQueue().map((e) => e.seq)).toEqual([1, 2]);
  });

  it("Urgent vs Senior: a Senior waiting, then an Urgent: the Urgent is first", () => {
    triage(senior(), { priorityCategory: "senior_citizen" }, at(0));
    const urgent = triage(addPatient(), { urgencyLevelId: levelId("Urgent") }, at(1));
    expect(urgent.queue?.ahead).toBe(0);
    expect(consultationQueue().map((e) => [e.seq, e.sortGroup])).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  it("closed Facility (outside hours): nothing saved, facility_unavailable", () => {
    const id = addPatient();
    const evening = new Date("2026-09-28T10:30:00.000Z"); // 18:30 Manila
    expect(() => triage(id, {}, evening)).toThrow(expect.objectContaining({ code: "facility_unavailable", message: "Consultation isn't taking patients now." }));
    const sunday = new Date("2026-09-27T02:00:00.000Z");
    expect(() => triage(id, {}, sunday)).toThrow(expect.objectContaining({ code: "facility_unavailable" }));
    expectNothingSaved();
  });

  it("not-live Facility, open now: paper number — Visit stays open, paper_facility_id stored, no Queue Entry", () => {
    t.db.run(sql`update facilities set is_live = 0 where name = 'Consultation'`);
    const id = addPatient();
    const outcome = triage(id, { priorityCategory: "pwd", idNotPresented: true });
    expect(outcome).toMatchObject({
      outcome: "paper_number",
      queue: null,
      closedAt: null,
      paperFacility: { id: facilityId("Consultation"), name: "Consultation" },
      priorityCategoryName: "PWD",
    });
    expect(allVisits()).toEqual([expect.objectContaining({ status: "open", closedAt: null })]);
    expect(t.db.select().from(triageRecords).all()).toEqual([
      expect.objectContaining({ visitId: outcome.visitId, paperFacilityId: facilityId("Consultation"), sortGroup: 2 }),
    ]);
    expect(entries()).toHaveLength(0);
    expect(t.db.select().from(queueCounters).all()).toHaveLength(0);
    const audits = triageAudit();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.changes).toMatchObject({
      outcome: "paper_number",
      facilityId: facilityId("Consultation"),
      queueNumber: null,
      ahead: null,
      closedAt: null,
    });
  });

  it("not-live Facility outside its hours: nothing saved, facility_unavailable", () => {
    t.db.run(sql`update facilities set is_live = 0 where name = 'Consultation'`);
    const evening = new Date("2026-09-28T10:30:00.000Z");
    expect(() => triage(addPatient(), {}, evening)).toThrow(
      expect.objectContaining({ code: "facility_unavailable", message: "Consultation isn't taking patients now." }),
    );
    expectNothingSaved();
  });

  it("a queued Queue Number never goes to a not-live Facility (issue refuses it)", async () => {
    t.db.run(sql`update facilities set is_live = 0 where name = 'Consultation'`);
    const { requireAvailableFacility } = await import("./service");
    const consultation = facilityId("Consultation");
    expect(() => t.db.transaction((tx) => requireAvailableFacility(tx, consultation, MON_10))).toThrow(
      expect.objectContaining({ code: "facility_unavailable", message: "Consultation isn't taking patients now." }),
    );
  });

  it("deactivated or unknown Facility: nothing saved, facility_unavailable", () => {
    const id = addPatient();
    const consultation = facilityId("Consultation");
    t.db.run(sql`update facilities set deactivated_at = ${MON_10.toISOString()} where name = 'Consultation'`);
    expect(() => triage(id, { facilityId: consultation })).toThrow(
      expect.objectContaining({ code: "facility_unavailable", message: "Consultation isn't taking patients now." }),
    );
    expect(() => triage(id, { facilityId: "nope" })).toThrow(
      expect.objectContaining({ code: "facility_unavailable", message: "That Facility isn't available. Choose another." }),
    );
    expectNothingSaved();
  });

  it("ER with directToEr: the Visit is directed_to_er with closed_at, no Queue Entry, one audit row", () => {
    const id = addPatient();
    const outcome = triage(id, { urgencyLevelId: levelId("Emergency"), facilityId: "", directToEr: true });
    expect(outcome).toMatchObject({ outcome: "directed_to_er", queue: null, closedAt: MON_10.toISOString() });
    expect(allVisits()).toEqual([expect.objectContaining({ status: "directed_to_er", closedAt: MON_10.toISOString() })]);
    expect(entries()).toHaveLength(0);
    expect(t.db.select().from(queueCounters).all()).toHaveLength(0);
    const audits = triageAudit();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.changes).toMatchObject({
      outcome: "directed_to_er",
      facilityId: null,
      queueNumber: null,
      ahead: null,
      closedAt: MON_10.toISOString(),
      urgencyIsEr: true,
      sortGroup: null,
    });
  });

  it("ER even when every Facility is closed", () => {
    const evening = new Date("2026-09-28T10:30:00.000Z");
    const outcome = triage(addPatient(), { urgencyLevelId: levelId("Emergency"), facilityId: "", directToEr: true }, evening);
    expect(outcome.outcome).toBe("directed_to_er");
  });

  it("ER without the confirmation (a facilityId, or nothing): nothing saved, invalid", () => {
    const id = addPatient();
    expect(() => triage(id, { urgencyLevelId: levelId("Emergency") })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => triage(id, { urgencyLevelId: levelId("Emergency"), facilityId: "", directToEr: false })).toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
    expect(() => triage(id, { urgencyLevelId: levelId("Emergency"), directToEr: true })).toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
    expectNothingSaved();
  });

  it("Direct to ER with a non-ER level is refused", () => {
    expect(() => triage(addPatient(), { facilityId: "", directToEr: true })).toThrow(expect.objectContaining({ code: "invalid" }));
    expectNothingSaved();
  });

  it("a queued patient can't be triaged again today (the Visit is in_queue)", () => {
    const id = addPatient();
    triage(id);
    expect(() => triage(id, {}, at(1))).toThrow(expect.objectContaining({ code: "visit_already_open" }));
    expect(entries()).toHaveLength(1);
  });
});

describe("recordTriageAction with a Facility", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MON_10);
  });

  it("non-ER with no Facility: nothing saved, field error Choose a Facility.", async () => {
    const result = await recordTriageAction(input(addPatient(), { facilityId: "" }));
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid", message: "Check the highlighted fields.", fieldErrors: { facilityId: "Choose a Facility." } },
    });
    expectNothingSaved();
  });

  it("a closed Facility is refused with facility_unavailable, tied to the tiles", async () => {
    vi.setSystemTime(new Date("2026-09-28T10:30:00.000Z"));
    const result = await recordTriageAction(input(addPatient()));
    expect(result).toEqual({
      ok: false,
      error: {
        code: "facility_unavailable",
        message: "Consultation isn't taking patients now.",
        fieldErrors: { facilityId: "Consultation isn't taking patients now." },
      },
    });
    expectNothingSaved();
  });

  it("issues the number (the AC: Lola after three Routine patients)", async () => {
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(at(i));
      expect(await recordTriageAction(input(addPatient()))).toMatchObject({ ok: true });
    }
    vi.setSystemTime(at(10));
    const result = await recordTriageAction(input(senior(), { priorityCategory: "senior_citizen" }));
    expect(result).toMatchObject({
      ok: true,
      data: { outcome: "queued", queue: { queueNumber: "CN-004", ahead: 0, facilityName: "Consultation" }, priorityCategoryName: "Senior Citizen" },
    });
    expect(consultationQueue()[0]!.seq).toBe(4);
  });

  it("the triage context lists the active Facilities with availability and waiting counts", async () => {
    triage(addPatient());
    t.db.run(sql`update facilities set is_live = 0 where name = 'Treatment'`);
    t.db.run(sql`update facilities set open_days = '[2,3,4,5,6]' where name = 'Animal Bite Center'`);
    t.db.run(sql`update facilities set deactivated_at = ${MON_10.toISOString()} where name = 'Prenatal'`);
    const result = await getTriageContextAction({ patientId: addPatient() });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.facilities).toEqual([
      {
        id: facilityId("Animal Bite Center"),
        name: "Animal Bite Center",
        available: false,
        paper: false,
        waiting: 0,
        reason: "Closed, opens tomorrow 7:00 AM",
      },
      // Not live but open now: selectable for a paper number.
      { id: facilityId("Treatment"), name: "Treatment", available: true, paper: true, waiting: 0, reason: null },
      { id: facilityId("Consultation"), name: "Consultation", available: true, paper: false, waiting: 1, reason: null },
    ]);
  });

  it("an over-long facilityId is refused with the unknown-Facility message", async () => {
    const result = await recordTriageAction(input(addPatient(), { facilityId: "x".repeat(65) }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { facilityId: "That Facility isn't available. Choose another." } },
    });
    expectNothingSaved();
  });
});

describe("aheadOf and waitingCounts", () => {
  it("counts the waiting and called entries before an entry, not serving or finished ones", () => {
    for (let i = 0; i < 5; i++) triage(addPatient(), {}, at(i));
    const [e1, e2, e3, e4, e5] = [...entries()].sort((a, b) => a.seq - b.seq);
    t.db.run(sql`update queue_entries set status = 'serving' where id = ${e1!.id}`);
    t.db.run(sql`update queue_entries set status = 'called' where id = ${e2!.id}`);
    t.db.run(sql`update queue_entries set status = 'completed' where id = ${e3!.id}`);
    expect(aheadOf(e5!, t.db).map((e) => e.seq)).toEqual([2, 4]);
    expect(aheadOf(e4!, t.db).map((e) => e.seq)).toEqual([2]);
    expect(aheadOf(e2!, t.db)).toEqual([]);
    // An entry no longer in the queue has nobody ahead.
    expect(aheadOf(e3!, t.db)).toEqual([]);
    // Serving is live but not waiting: e2 (called), e4 and e5 (waiting) = 3.
    expect(waitingCounts(TODAY, t.db).get(facilityId("Consultation"))).toBe(3);
    expect(consultationQueue().map((e) => e.seq)).toEqual([1, 2, 4, 5]);
  });

  it("liveQueue leaves out paper entries and other days", () => {
    triage(addPatient());
    const [entry] = entries();
    t.db
      .insert(queueEntries)
      .values([
        { ...entry!, id: "paper", seq: 2, isPaper: true },
        { ...entry!, id: "yesterday", seq: 1, opdDate: "2026-09-27" },
      ])
      .run();
    expect(consultationQueue().map((e) => e.id)).toEqual([entry!.id]);
    expect(waitingCounts(TODAY, t.db).get(facilityId("Consultation"))).toBe(1);
  });

  it("orders ties on entered_at by id", () => {
    triage(addPatient());
    const [entry] = entries();
    t.db.insert(queueEntries).values({ ...entry!, id: "0000-first", seq: 2 }).run();
    expect(consultationQueue().map((e) => e.id)).toEqual(["0000-first", entry!.id]);
  });

  it("facilityTiles lists only active Facilities, in display order", () => {
    expect(facilityTiles(MON_10, t.db).map((f) => f.name)).toEqual(["Prenatal", "Animal Bite Center", "Treatment", "Consultation"]);
    expect(facilityTiles(MON_10, t.db).every((f) => f.available && f.waiting === 0 && f.reason === null)).toBe(true);
    const early = new Date("2026-09-27T22:00:00.000Z"); // Monday 06:00 Manila
    expect(facilityTiles(early, t.db)[0]!.reason).toBe("Closed, opens today 7:00 AM");
    const evening = new Date("2026-09-28T10:30:00.000Z"); // Monday 18:30 Manila
    expect(facilityTiles(evening, t.db)[0]!.reason).toBe("Closed, opens tomorrow 7:00 AM");
  });
});

describe("nextOpening", () => {
  const hours = { openDays: [1, 2, 3, 4, 5, 6], openTime: "07:00" };

  it("is later today before opening, else the next open day (Manila time)", async () => {
    const { nextOpening } = await import("@/server/settings/queries");
    // Monday 06:00 Manila: today at 07:00.
    expect(nextOpening(hours, new Date("2026-09-27T22:00:00.000Z"))).toEqual({ opdDate: "2026-09-28", weekday: 1, time: "07:00" });
    // Monday 18:30: Tuesday.
    expect(nextOpening(hours, new Date("2026-09-28T10:30:00.000Z"))).toEqual({ opdDate: "2026-09-29", weekday: 2, time: "07:00" });
    // Saturday evening: skips Sunday to Monday.
    expect(nextOpening(hours, new Date("2026-10-03T12:00:00.000Z"))).toEqual({ opdDate: "2026-10-05", weekday: 1, time: "07:00" });
    // Only Mondays, on a Monday after opening: next week.
    expect(nextOpening({ openDays: [1], openTime: "07:00" }, MON_10)).toEqual({ opdDate: "2026-10-05", weekday: 1, time: "07:00" });
    expect(nextOpening({ openDays: [], openTime: "07:00" }, MON_10)).toBeNull();
  });
});

describe("concurrency", () => {
  it(
    "two workers (separate connections) issuing 25 each at one Facility get 50 distinct, consecutive numbers",
    async () => {
      const ids = Array.from({ length: 50 }, () => addPatient());
      const consultation = facilityId("Consultation");
      const routine = levelId("Routine");
      const tsx = path.join("node_modules", "tsx", "dist", "cli.mjs");
      const worker = path.join("src", "test-support", "queue-issue-worker.ts");

      const run = (patientIds: string[]) => {
        const child = spawn(
          process.execPath,
          [tsx, "--conditions=react-server", worker, t.filePath, consultation, routine, MON_10.toISOString(), JSON.stringify(patientIds)],
          { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] },
        );
        let out = "";
        let err = "";
        let signalReady: () => void = () => {};
        const ready = new Promise<void>((resolve) => (signalReady = resolve));
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          out += chunk;
          if (out.includes("ready\n")) signalReady();
        });
        child.stderr.on("data", (chunk) => (err += chunk));
        const done = new Promise<{ queueNumber: string | null; error?: string }[]>((resolve, reject) => {
          child.on("close", (code) => {
            if (code !== 0) return reject(new Error(`worker exited ${code}: ${err}`));
            const last = out.trim().split("\n").pop() ?? "[]";
            resolve(JSON.parse(last));
          });
        });
        return { child, ready, done };
      };

      const a = run(ids.slice(0, 25));
      const b = run(ids.slice(25));
      await Promise.all([a.ready, b.ready]);
      a.child.stdin.write("go\n");
      b.child.stdin.write("go\n");
      const [resultsA, resultsB] = await Promise.all([a.done, b.done]);

      const all = [...resultsA, ...resultsB];
      expect(all.filter((r) => r.error)).toEqual([]);
      const numbers = all.map((r) => r.queueNumber);
      expect(new Set(numbers).size).toBe(50);
      const seqs = numbers.map((n) => Number(n!.slice(3))).sort((x, y) => x - y);
      expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      // Each worker's own numbers rise.
      for (const results of [resultsA, resultsB]) {
        const own = results.map((r) => Number(r.queueNumber!.slice(3)));
        expect(own).toEqual([...own].sort((x, y) => x - y));
      }
      expect(t.db.select().from(queueCounters).all()).toEqual([{ facilityId: consultation, opdDate: TODAY, lastSeq: 50 }]);
      expect(entries()).toHaveLength(50);
      expect(triageAudit()).toHaveLength(50);
      expect(allVisits().every((v) => v.status === "in_queue")).toBe(true);
    },
    90_000,
  );
});

describe("getSlip (Story 3.6)", () => {
  it("returns the Facility name, the stored prefix and seq and the entry time, and nothing about the patient", () => {
    const outcome = triage(senior(), { priorityCategory: "senior_citizen" });
    if (outcome.outcome !== "queued") throw new Error("expected a Queue Number");
    const [entry] = entries();
    expect(outcome.queue.entryId).toBe(entry!.id);
    expect(getSlip(entry!.id, t.db)).toEqual({
      facilityName: "Consultation",
      prefix: "CN",
      seq: 1,
      enteredAt: MON_10.toISOString(),
    });
  });

  it("returns null for an unknown id or a paper entry", () => {
    triage(addPatient());
    const [entry] = entries();
    expect(getSlip("nope", t.db)).toBeNull();
    t.db.update(queueEntries).set({ isPaper: true }).run();
    expect(getSlip(entry!.id, t.db)).toBeNull();
  });
});