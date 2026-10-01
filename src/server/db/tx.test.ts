import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditAction, auditLog } from "@/server/audit/schema";
import { users } from "@/server/auth/schema";
import { DomainError } from "./errors";
import { createTestDb, type TestDb } from "./test-db";
import { withCommandTx, type Tx } from "./tx";

let t: TestDb;
const actor = { type: "staff", id: "staff-1", name: "Ana Cruz" } as const;

function count(table: "users" | "audit_log") {
  return t.db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`))!.n;
}

function insertUser(tx: Tx, id: string) {
  tx.insert(users)
    .values({ id, name: id, email: `${id}@staff.opd.invalid`, username: id })
    .run();
}

beforeAll(() => {
  t = createTestDb();
});

afterAll(() => t.cleanup());

describe("createTestDb", () => {
  it("opens with WAL, foreign keys and a busy timeout", () => {
    expect(t.db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(t.db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(t.db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
  });
});

describe("withCommandTx", () => {
  it("commits the command and exactly one audit row", () => {
    const result = withCommandTx(
      actor,
      AuditAction.AdminCreated,
      (tx, audit) => {
        insertUser(tx, "u-ok");
        audit({ entity: "user", entityId: "u-ok" });
        return "done";
      },
      t.db,
    );
    expect(result).toBe("done");
    expect(count("users")).toBe(1);
    expect(count("audit_log")).toBe(1);
    const row = t.db.select().from(auditLog).get();
    expect(row).toMatchObject({ actorType: "staff", actorId: "staff-1", actorName: "Ana Cruz" });
  });

  it("rolls back every write, the audit row included, when fn throws", () => {
    expect(() =>
      withCommandTx(
        actor,
        AuditAction.AdminCreated,
        (tx, audit) => {
          insertUser(tx, "u-rolled-back");
          audit({ entity: "user", entityId: "u-rolled-back" });
          throw new DomainError("nope");
        },
        t.db,
      ),
    ).toThrow(DomainError);
    expect(count("users")).toBe(1);
    expect(count("audit_log")).toBe(1);
  });

  it("rejects an async fn and writes nothing", () => {
    expect(() =>
      withCommandTx(
        actor,
        AuditAction.AdminCreated,
        async (tx, audit) => {
          insertUser(tx, "u-async");
          audit({ entity: "user" });
        },
        t.db,
      ),
    ).toThrow(/synchronous/);
    expect(count("users")).toBe(1);
  });

  it("rejects a fn that returns a promise and rolls back", () => {
    expect(() =>
      withCommandTx(
        actor,
        AuditAction.AdminCreated,
        (tx, audit) => {
          insertUser(tx, "u-promise");
          audit({ entity: "user" });
          return Promise.resolve(1);
        },
        t.db,
      ),
    ).toThrow(/promise/);
    expect(count("users")).toBe(1);
    expect(count("audit_log")).toBe(1);
  });

  it("fails a command that writes no audit row", () => {
    expect(() =>
      withCommandTx(actor, AuditAction.AdminCreated, (tx) => insertUser(tx, "u-silent"), t.db),
    ).toThrow(/no audit row/);
    expect(count("users")).toBe(1);
  });

  it("fails a command that writes two audit rows", () => {
    expect(() =>
      withCommandTx(
        actor,
        AuditAction.AdminCreated,
        (_tx, audit) => {
          audit({ entity: "user" });
          audit({ entity: "user" });
        },
        t.db,
      ),
    ).toThrow(/one audit row/);
    expect(count("audit_log")).toBe(1);
  });
});
