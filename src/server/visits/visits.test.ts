import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VISIT_STATUSES, type VisitStatus } from "@/lib/visit-status";
import type { Actor } from "@/server/audit/service";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { activeVisitOn, lastVisitDates, visitsForPatient } from "./queries";
import { open, transition } from "./service";
import { canTransition, VISIT_TRANSITIONS } from "./state";

let t: TestDb;
const nurse: Actor = { type: "staff", id: "u-nurse", name: "Joy Santos" };

beforeEach(() => {
  t = createTestDb();
  for (const id of ["p-1", "p-2"]) {
    t.db.run(sql`insert into patients (id, hospital_number, last_name, first_name, sex, birthdate, address_barangay,
      address_municipality, contact_number, privacy_notice_at, created_at, updated_at, created_by)
      values (${id}, ${`HN-2026-00000${id.slice(-1)}`}, 'Cruz', 'Ana', 'female', '1990-01-01', 'Poblacion', 'San Jose',
      '09171234567', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'test')`);
  }
});

afterEach(() => t.cleanup());

const tx = <T>(fn: (tx: Parameters<Parameters<TestDb["db"]["transaction"]>[0]>[0]) => T): T => t.db.transaction(fn);

// 2026-09-27 08:00 in Manila.
const NOW = new Date("2026-09-27T00:00:00.000Z");

/** Allowed steps from `open` to each status. */
const PATH_TO: Record<VisitStatus, VisitStatus[]> = {
  open: [],
  in_queue: ["in_queue"],
  completed: ["in_queue", "completed"],
  no_show: ["in_queue", "no_show"],
  directed_to_er: ["directed_to_er"],
  cancelled: ["cancelled"],
};

describe("Visit state machine", () => {
  const allowed: [VisitStatus, VisitStatus][] = [
    ["open", "in_queue"],
    ["open", "directed_to_er"],
    ["open", "cancelled"],
    ["in_queue", "completed"],
    ["in_queue", "no_show"],
    ["in_queue", "cancelled"],
  ];

  for (const from of VISIT_STATUSES) {
    for (const to of VISIT_STATUSES) {
      const ok = allowed.some(([a, b]) => a === from && b === to);
      it(`${ok ? "allows" : "forbids"} ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(ok);
        const visit = tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }));
        for (const step of PATH_TO[from]) tx((t2) => transition(t2, visit.id, step, NOW));
        const run = () => tx((t2) => transition(t2, visit.id, to, NOW));
        if (ok) {
          expect(run().status).toBe(to);
        } else {
          expect(run).toThrow(expect.objectContaining({ code: "invalid_transition" }));
          expect(visitsForPatient("p-1", t.db)[0]!.status).toBe(from);
        }
      });
    }
  }

  it("has terminal statuses with no way out", () => {
    for (const status of ["completed", "directed_to_er", "no_show", "cancelled"] as const) {
      expect(VISIT_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("sets closed_at on a terminal status only", () => {
    const visit = tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }));
    expect(tx((t2) => transition(t2, visit.id, "in_queue", NOW)).closedAt).toBeNull();
    const later = new Date("2026-09-27T03:00:00.000Z");
    expect(tx((t2) => transition(t2, visit.id, "completed", later)).closedAt).toBe(later.toISOString());
  });

  it("throws not_found for an unknown Visit", () => {
    expect(() => tx((t2) => transition(t2, "nope", "cancelled", NOW))).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("rejects an unknown status in the database", () => {
    const visit = tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }));
    expect(() => t.db.$client.prepare("update visits set status = 'lost' where id = ?").run(visit.id)).toThrow(/CHECK/);
  });
});

describe("open", () => {
  it("opens today's Visit (Manila OPD date) as open", () => {
    // 2026-09-27T17:00Z is already Sep 28 in Manila.
    const visit = tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: new Date("2026-09-27T17:00:00.000Z") }));
    expect(visit).toMatchObject({ patientId: "p-1", opdDate: "2026-09-28", status: "open", closedAt: null });
  });

  it("refuses a second active Visit the same day, but not after the first is closed or on another day", () => {
    const first = tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }));
    expect(() => tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }))).toThrow(
      expect.objectContaining({ code: "visit_already_open" }),
    );
    tx((t2) => transition(t2, first.id, "in_queue", NOW));
    expect(() => tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }))).toThrow(
      expect.objectContaining({ code: "visit_already_open" }),
    );
    tx((t2) => transition(t2, first.id, "completed", NOW));
    expect(tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW })).status).toBe("open");
    expect(tx((t2) => open(t2, { patientId: "p-2", actor: nurse, now: NOW })).status).toBe("open");
  });

  it("is backed by a unique index on active Visits", () => {
    tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }));
    expect(() =>
      t.db.$client
        .prepare(
          "insert into visits (id, patient_id, opd_date, status, opened_at, created_by, updated_at) values ('v-x', 'p-1', '2026-09-27', 'in_queue', 'x', 'x', 'x')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});

describe("queries", () => {
  it("lists a patient's Visits newest first, and the last Visit date per patient", () => {
    const a = tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: new Date("2026-09-20T01:00:00.000Z") }));
    tx((t2) => transition(t2, a.id, "cancelled", NOW));
    tx((t2) => open(t2, { patientId: "p-1", actor: nurse, now: NOW }));
    expect(visitsForPatient("p-1", t.db).map((v) => v.opdDate)).toEqual(["2026-09-27", "2026-09-20"]);
    const last = lastVisitDates(["p-1", "p-2", "p-1"], t.db);
    expect([...last]).toEqual([["p-1", "2026-09-27"]]);
    expect(lastVisitDates([], t.db).size).toBe(0);
    // A cancelled Visit alone is no "last visit".
    const c = tx((t2) => open(t2, { patientId: "p-2", actor: nurse, now: NOW }));
    tx((t2) => transition(t2, c.id, "cancelled", NOW));
    expect(lastVisitDates(["p-2"], t.db).has("p-2")).toBe(false);
    expect(activeVisitOn("p-1", "2026-09-27", t.db)?.status).toBe("open");
    expect(activeVisitOn("p-1", "2026-09-20", t.db)).toBeUndefined();
  });
});
