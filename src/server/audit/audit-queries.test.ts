import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { listAudit } from "./queries";
import { AuditAction, auditLog, type AuditEntity } from "./schema";
import { record, type Actor } from "./service";
import { recordAuditView } from "./views";

let t: TestDb;

const JOY_ID = "0f5c2a9e-7b1d-4c3e-9a8f-1234abcd5678";
const ana: Actor = { type: "staff", id: "u-ana", name: "Ana Cruz" };
const joy: Actor = { type: "staff", id: JOY_ID, name: "Joy Santos" };
const pena: Actor = { type: "staff", id: "3b9e7f10-2222-4c3e-8888-aaaabbbbcccc", name: "PEÑA Reyes" };
const system: Actor = { type: "system", name: "backup job" };

/** Seeds one row with a fixed time; `changes` may be raw text to store as-is. */
function seed(at: string, actor: Actor, action: AuditAction, entity: AuditEntity, entityId: string | null, changes?: unknown) {
  if (typeof changes === "string") {
    t.db.$client
      .prepare(
        "insert into audit_log (id, at, actor_type, actor_id, actor_name, action, entity, entity_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), at, actor.type, actor.id ?? null, actor.name, action, entity, entityId, changes);
    return;
  }
  t.db.transaction((tx) => {
    record(tx, {
      actor,
      action,
      entity,
      entityId,
      changes: (changes as Record<string, unknown> | undefined) ?? null,
      at: new Date(at),
    });
  });
}

beforeAll(() => {
  t = createTestDb();
  // Manila 2026-09-26 (16:00Z on the 25th .. 16:00Z on the 26th)
  seed("2026-09-25T16:00:00.000Z", ana, AuditAction.AuthSignIn, "user", "u-ana");
  seed("2026-09-26T15:59:59.999Z", joy, AuditAction.AuthSignIn, "user", JOY_ID);
  // Manila 2026-09-27
  seed("2026-09-26T16:00:00.000Z", ana, AuditAction.StaffCreated, "user", JOY_ID, {
    name: "Joy Santos",
    username: "joy.santos",
    role: "facility_staff",
    facilities: [{ id: "f-pn", name: "Prenatal" }],
  });
  seed("2026-09-27T03:00:00.000Z", ana, AuditAction.SettingsFacilityUpdated, "facility", "f-pn", {
    openTime: { old: "07:00", new: "08:00" },
  });
  seed("2026-09-27T04:00:00.000Z", pena, AuditAction.AuthSignOut, "user", "3b9e7f10-2222-4c3e-8888-aaaabbbbcccc");
  seed("2026-09-27T15:59:59.999Z", joy, AuditAction.AuthSignOut, "user", JOY_ID, "{not json");
  // Manila 2026-09-28
  seed("2026-09-27T16:00:00.000Z", system, AuditAction.AuthUnlocked, "user", JOY_ID);
  seed("2026-09-28T02:00:00.000Z", joy, AuditAction.AuthSignIn, "user", JOY_ID);
});

afterAll(() => t.cleanup());

describe("listAudit", () => {
  it("lists newest first with a total", () => {
    const list = listAudit({}, t.db);
    expect(list.total).toBe(8);
    expect(list.rows.map((r) => r.at)).toEqual(
      [...list.rows.map((r) => r.at)].sort().reverse(),
    );
    expect(list.rows[0]).toMatchObject({ actorType: "staff", actorName: "Joy Santos", action: "auth.sign_in" });
    expect(list.page).toBe(1);
    expect(list.pageCount).toBe(1);
  });

  it("breaks ties on the same instant by id, descending", () => {
    const db = createTestDb();
    try {
      for (const id of ["a", "c", "b"]) {
        db.db.$client
          .prepare("insert into audit_log (id, at, actor_type, action, entity) values (?, '2026-09-27T00:00:00.000Z', 'system', 'auth.locked', 'user')")
          .run(id);
      }
      expect(listAudit({}, db.db).rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
    } finally {
      db.cleanup();
    }
  });

  it("filters by staff name, case-insensitive", () => {
    const list = listAudit({ q: "joy" }, t.db);
    expect(list.total).toBe(3);
    expect(list.rows).toHaveLength(3);
    expect(list.rows.every((r) => r.actorName === "Joy Santos")).toBe(true);
    expect(listAudit({ q: "JOY SAN" }, t.db).total).toBe(3);
  });

  it("matches names beyond ASCII (unicode_lower)", () => {
    const list = listAudit({ q: "peña" }, t.db);
    expect(list.total).toBe(1);
    expect(list.rows[0]!.actorName).toBe("PEÑA Reyes");
  });

  it("matches part of a record ID", () => {
    // Every row about Joy's account, whoever wrote it (Ana, Joy or the system).
    const list = listAudit({ q: "7B1D-4c3e" }, t.db);
    expect(list.total).toBe(5);
    expect(list.rows.every((r) => r.entityId === JOY_ID)).toBe(true);
    expect(new Set(list.rows.map((r) => r.actorName))).toEqual(new Set(["Ana Cruz", "Joy Santos", "backup job"]));
  });

  it("filters by action and entity", () => {
    expect(listAudit({ action: "staff.created" }, t.db).total).toBe(1);
    expect(listAudit({ entity: "facility" }, t.db).rows.map((r) => r.entityId)).toEqual(["f-pn"]);
    expect(listAudit({ action: "auth.sign_in", q: "joy" }, t.db).total).toBe(2);
    expect(listAudit({ action: "all", entity: "all" }, t.db).total).toBe(8);
  });

  it("filters by a Manila date range, both ends inclusive", () => {
    const list = listAudit({ from: "2026-09-27", to: "2026-09-27" }, t.db);
    expect(list.rows.map((r) => r.at)).toEqual([
      "2026-09-27T15:59:59.999Z",
      "2026-09-27T04:00:00.000Z",
      "2026-09-27T03:00:00.000Z",
      "2026-09-26T16:00:00.000Z",
    ]);
    expect(listAudit({ from: "2026-09-28" }, t.db).total).toBe(2);
    expect(listAudit({ to: "2026-09-26" }, t.db).total).toBe(2);
  });

  it("swaps a reversed range", () => {
    expect(listAudit({ from: "2026-09-28", to: "2026-09-26" }, t.db).total).toBe(8);
    expect(listAudit({ from: "2026-09-28", to: "2026-09-27" }, t.db).total).toBe(6);
  });

  it("ignores invalid dates and bad values", () => {
    expect(listAudit({ from: "yesterday", to: "2026-02-30" }, t.db).total).toBe(8);
    // Out-of-range years are ignored rather than overflowing to year 10000.
    expect(listAudit({ from: "2026-09-28", to: "9999-12-31" }, t.db).total).toBe(2);
    expect(listAudit({ to: "9998-12-31" }, t.db).total).toBe(8);
    expect(listAudit({ page: Number("abc") }, t.db).page).toBe(1);
  });

  it("pages and clamps the page", () => {
    const first = listAudit({ pageSize: 3 }, t.db);
    expect(first).toMatchObject({ total: 8, page: 1, pageCount: 3, pageSize: 3 });
    const last = listAudit({ pageSize: 3, page: 3 }, t.db);
    expect(last.rows).toHaveLength(2);
    expect(last.rows.at(-1)!.at).toBe("2026-09-25T16:00:00.000Z");
    expect(listAudit({ pageSize: 3, page: 99 }, t.db).page).toBe(3);
    expect(listAudit({ pageSize: 3, page: 0 }, t.db).page).toBe(1);
    expect(listAudit({ q: "nobody" }, t.db)).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 });
  });

  it("parses changes, keeping invalid JSON as raw text", () => {
    const rows = listAudit({}, t.db).rows;
    const created = rows.find((r) => r.action === "staff.created")!;
    expect(created.changes).toEqual({
      name: "Joy Santos",
      username: "joy.santos",
      role: "facility_staff",
      facilities: [{ id: "f-pn", name: "Prenatal" }],
    });
    expect(rows.find((r) => r.at === "2026-09-27T15:59:59.999Z")!.changes).toBe("{not json");
    expect(rows.find((r) => r.action === "auth.unlocked")).toMatchObject({ actorType: "system", changes: null });
  });
});

describe("recordAuditView", () => {
  it("writes exactly one audit.viewed row with the filters and page", () => {
    const before = t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
    recordAuditView(
      ana,
      { q: "joy", action: "staff.created", entity: "all", from: "2026-09-27", to: "", requestedPage: 2 },
      t.db,
    );
    expect(t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n).toBe(before + 1);
    const rows = t.db.select().from(auditLog).where(eq(auditLog.action, "audit.viewed")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "staff",
      actorId: "u-ana",
      actorName: "Ana Cruz",
      entity: "audit_log",
      entityId: null,
    });
    expect(JSON.parse(rows[0]!.changes!)).toEqual({
      q: "joy",
      action: "staff.created",
      entity: "all",
      from: "2026-09-27",
      to: null,
      requestedPage: 2,
    });
    // The view shows up in the list itself.
    expect(listAudit({ entity: "audit_log" }, t.db).rows.map((r) => r.action)).toEqual(["audit.viewed"]);
  });
});
