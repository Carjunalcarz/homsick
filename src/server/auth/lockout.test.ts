import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog } from "@/server/audit/schema";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { withCommandTx } from "@/server/db/tx";
import { isLocked, LOCK_THRESHOLD, recordFailure, resetFailures, unlock } from "./lockout";
import { users } from "./schema";

let t: TestDb;
const USER_ID = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
  t = createTestDb();
});

afterAll(() => t.cleanup());

beforeEach(() => {
  t.db.delete(users).run();
  t.db
    .insert(users)
    .values({
      id: USER_ID,
      name: "Liza Test",
      email: "liza.test@staff.opd.invalid",
      username: "liza.test",
      role: "admin",
      updatedAt: new Date(),
    })
    .run();
});

/** One failed sign-in, the way the Better Auth hook runs it. */
function fail(username = "liza.test") {
  return withCommandTx(
    { type: "staff", id: null, name: null },
    "auth.sign_in_failed",
    (tx, audit) => {
      const result = recordFailure(tx, username, { ip: "10.0.0.1" });
      audit({ entity: "user", entityId: null, changes: { username } });
      return result;
    },
    t.db,
  );
}

function succeed() {
  withCommandTx(
    { type: "staff", id: USER_ID, name: "Liza Test" },
    "auth.sign_in",
    (tx, audit) => {
      resetFailures(tx, USER_ID);
      audit({ entity: "user", entityId: USER_ID });
    },
    t.db,
  );
}

function user() {
  return t.db.select().from(users).where(eq(users.id, USER_ID)).get()!;
}

function auditRows(action: string) {
  return t.db.select().from(auditLog).where(eq(auditLog.action, action)).all();
}

function auditCount() {
  // audit_log is append-only; tests count relative to a baseline.
  return t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
}

describe("account lockout", () => {
  it("locks on the 5th consecutive failure and audits the lock once", () => {
    const lockedBefore = auditRows("auth.locked").length;
    for (let i = 1; i < LOCK_THRESHOLD; i++) {
      expect(fail()).toMatchObject({ status: "counted", failedAttempts: i });
    }
    expect(isLocked("liza.test", t.db)).toBe(false);

    expect(fail()).toMatchObject({ status: "locked", failedAttempts: 5 });
    expect(isLocked("Liza.Test", t.db)).toBe(true);
    expect(user().lockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const rows = auditRows("auth.locked").slice(lockedBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "system", entity: "user", entityId: USER_ID });
    expect(JSON.parse(rows[0]!.changes!)).toMatchObject({ username: "liza.test", failedAttempts: 5, ip: "10.0.0.1" });
  });

  it("neither re-locks nor re-audits on further failures", () => {
    for (let i = 0; i < LOCK_THRESHOLD; i++) fail();
    const lockedAt = user().lockedAt;
    const lockedRows = auditRows("auth.locked").length;

    expect(fail()).toMatchObject({ status: "counted", failedAttempts: 6 });
    expect(fail()).toMatchObject({ status: "counted", failedAttempts: 7 });
    expect(user().lockedAt).toBe(lockedAt);
    expect(auditRows("auth.locked")).toHaveLength(lockedRows);
  });

  it("resets the count on a successful sign-in, so failures must be consecutive", () => {
    for (let i = 0; i < LOCK_THRESHOLD - 1; i++) fail();
    succeed();
    expect(user().failedAttempts).toBe(0);
    for (let i = 0; i < LOCK_THRESHOLD - 1; i++) fail();
    expect(isLocked("liza.test", t.db)).toBe(false);
  });

  it("does not count unknown usernames", () => {
    const before = auditCount();
    expect(fail("nobody.here")).toEqual({ status: "unknown" });
    expect(isLocked("nobody.here", t.db)).toBe(false);
    expect(t.db.get<{ n: number }>(sql`select count(*) as n from users`)!.n).toBe(1);
    // Only the sign_in_failed row of the command itself.
    expect(auditCount()).toBe(before + 1);
  });

  it("never stores the password in the counters or the lock row", () => {
    for (let i = 0; i < LOCK_THRESHOLD; i++) fail();
    const row = auditRows("auth.locked").at(-1)!;
    expect(row.changes).not.toMatch(/password/i);
  });
});

describe("unlock", () => {
  it("clears the lock and the count and writes one auth.unlocked row", () => {
    for (let i = 0; i < LOCK_THRESHOLD; i++) fail();
    const before = auditRows("auth.unlocked").length;

    expect(unlock(USER_ID, { type: "system", name: "unlock-user" }, t.db)).toBe("unlocked");
    expect(user()).toMatchObject({ failedAttempts: 0, lockedAt: null });
    expect(isLocked("liza.test", t.db)).toBe(false);

    const rows = auditRows("auth.unlocked").slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "system", actorName: "unlock-user", entityId: USER_ID });
    expect(JSON.parse(rows[0]!.changes!)).toMatchObject({
      username: "liza.test",
      failedAttempts: { old: 5, new: 0 },
      lockedAt: { new: null },
    });
  });

  it("does nothing, and audits nothing, for an account that is not locked", () => {
    const before = auditCount();
    expect(unlock(USER_ID, { type: "system", name: "unlock-user" }, t.db)).toBe("not_locked");
    expect(auditCount()).toBe(before);
  });

  it("quietly resets 1-4 failures on an account that is not locked (no audit row)", () => {
    for (let i = 0; i < LOCK_THRESHOLD - 2; i++) fail();
    const before = auditCount();
    expect(unlock(USER_ID, { type: "system", name: "unlock-user" }, t.db)).toBe("reset");
    expect(user()).toMatchObject({ failedAttempts: 0, lockedAt: null });
    expect(auditCount()).toBe(before);
  });

  it("reports an unknown user", () => {
    expect(unlock("no-such-id", { type: "system", name: "unlock-user" }, t.db)).toBe("unknown");
  });
});
