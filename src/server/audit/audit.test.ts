import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { withCommandTx } from "@/server/db/tx";
import { AuditAction, auditLog } from "./schema";

let t: TestDb;
let rowId: string;

beforeAll(() => {
  t = createTestDb();
  rowId = withCommandTx(
    { type: "system", name: "test" },
    AuditAction.AdminCreated,
    (tx, audit) => {
      audit({ entity: "user", entityId: "u-1", changes: { username: "ana" } });
      return tx.select({ id: auditLog.id }).from(auditLog).get()!.id;
    },
    t.db,
  );
});

afterAll(() => t.cleanup());

describe("audit_log", () => {
  it("records the actor, action, entity and changes", () => {
    const row = t.db.select().from(auditLog).where(eq(auditLog.id, rowId)).get();
    expect(row).toMatchObject({
      actorType: "system",
      actorName: "test",
      action: "admin.created",
      entity: "user",
      entityId: "u-1",
    });
    expect(JSON.parse(row!.changes!)).toEqual({ username: "ana" });
    expect(new Date(row!.at).toISOString()).toBe(row!.at);
  });

  it("rejects UPDATE", () => {
    expect(() => t.db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, rowId)).run()).toThrow(
      /append-only/,
    );
    expect(() => t.db.$client.prepare("update audit_log set actor_name = 'x'").run()).toThrow(/append-only/);
  });

  it("rejects DELETE", () => {
    expect(() => t.db.delete(auditLog).where(eq(auditLog.id, rowId)).run()).toThrow(/append-only/);
    expect(() => t.db.$client.prepare("delete from audit_log").run()).toThrow(/append-only/);
    expect(t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n).toBe(1);
  });

  it("rejects an unknown actor type", () => {
    expect(() =>
      t.db.$client
        .prepare(
          "insert into audit_log (id, at, actor_type, action, entity) values ('x', '2026-01-01T00:00:00.000Z', 'robot', 'a', 'b')",
        )
        .run(),
    ).toThrow(/CHECK/);
  });
});
