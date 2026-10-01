import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "@/server/audit/schema";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";
import { getAuth } from "./auth";

let t: TestDb;
const savedEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
};
const PASSWORD = "correct horse battery";

beforeAll(async () => {
  t = createTestDb();
  // Point the app's shared connection (used by Better Auth and its hooks) at the temp file.
  process.env.DATABASE_PATH = t.filePath;
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(40, "x");
  resetEnvForTests();
  closeDb();
  (globalThis as { __opdAuth?: unknown }).__opdAuth = undefined;
  await getAuth().api.createUser({
    body: {
      name: "Ana Cruz",
      email: "ana.cruz@staff.opd.invalid",
      password: PASSWORD,
      role: "admin",
      data: { username: "ana.cruz" },
    },
  });
});

afterAll(() => {
  closeDb();
  (globalThis as { __opdAuth?: unknown }).__opdAuth = undefined;
  t.cleanup();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
});

function lastAudit() {
  return t.db.select().from(auditLog).orderBy(sql`rowid desc`).limit(1).get();
}

function sessionCount() {
  return t.db.get<{ n: number }>(sql`select count(*) as n from sessions`)!.n;
}

// The leftmost entry is client-supplied (spoofable); the rightmost is the one
// the reverse proxy appended, and is the one recorded.
const clientHeaders = () =>
  new Headers({ "x-forwarded-for": "203.0.113.66, 10.0.0.7", "user-agent": "Test Browser/1.0" });

async function signIn(username: string, password: string, headers = clientHeaders()) {
  return getAuth().api.signInUsername({ body: { username, password }, headers, returnHeaders: true });
}

describe("Better Auth sign-in and sign-out audit", () => {
  it("audits a failed sign-in with the attempted username and request context only", async () => {
    await expect(signIn("ana.cruz", "wrong password!!")).rejects.toThrow();
    const row = lastAudit();
    expect(row).toMatchObject({ action: "auth.sign_in_failed", actorType: "staff", actorId: null });
    expect(JSON.parse(row!.changes!)).toEqual({
      username: "ana.cruz",
      ip: "10.0.0.7",
      userAgent: "Test Browser/1.0",
    });
    expect(row!.changes).not.toContain("wrong password");
  });

  it("fails an unknown username the same way", async () => {
    await expect(signIn("nobody", "whatever12345")).rejects.toThrow();
    expect(lastAudit()).toMatchObject({ action: "auth.sign_in_failed" });
  });

  it("falls back to x-real-ip and truncates the user agent", async () => {
    const headers = new Headers({ "x-real-ip": "10.0.0.9", "user-agent": "U".repeat(400) });
    await expect(signIn("ana.cruz", "wrong password!!", headers)).rejects.toThrow();
    const changes = JSON.parse(lastAudit()!.changes!);
    expect(changes.ip).toBe("10.0.0.9");
    expect(changes.userAgent).toHaveLength(256);
  });

  it("audits sign-in and sign-out as the staff member", async () => {
    const { headers, response } = await signIn("Ana.Cruz", PASSWORD);
    expect(response.user.name).toBe("Ana Cruz");
    const signInRow = lastAudit();
    expect(signInRow).toMatchObject({ action: "auth.sign_in", actorId: response.user.id, actorName: "Ana Cruz" });
    expect(JSON.parse(signInRow!.changes!)).toEqual({ ip: "10.0.0.7", userAgent: "Test Browser/1.0" });

    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    await getAuth().api.signOut({ headers: new Headers({ cookie }) });
    expect(lastAudit()).toMatchObject({ action: "auth.sign_out", actorId: response.user.id });
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});

describe("account lockout through Better Auth", () => {
  const LIZA_PASSWORD = "liza correct horse";
  let lizaId: string;

  beforeAll(async () => {
    const { user } = await getAuth().api.createUser({
      body: {
        name: "Liza Test",
        email: "liza.test@staff.opd.invalid",
        password: LIZA_PASSWORD,
        role: "triage_nurse",
        data: { username: "liza.test" },
      },
    });
    lizaId = user.id;
  });

  function countAction(action: string) {
    return t.db.get<{ n: number }>(sql`select count(*) as n from audit_log where action = ${action}`)!.n;
  }

  it("locks after 5 wrong passwords and then refuses even the correct password", async () => {
    const lockedBefore = countAction("auth.locked");
    for (let i = 0; i < 5; i++) {
      await expect(signIn("liza.test", `wrong password ${i}`)).rejects.toThrow();
    }
    expect(countAction("auth.locked")).toBe(lockedBefore + 1);
    const user = t.db.get<{ failed_attempts: number; locked_at: string | null; banned: number | null }>(
      sql`select failed_attempts, locked_at, banned from users where id = ${lizaId}`,
    )!;
    expect(user.failed_attempts).toBe(5);
    expect(user.locked_at).not.toBeNull();
    expect(user.banned).toBeFalsy();

    const sessionsBefore = sessionCount();
    const error = await signIn("Liza.Test", LIZA_PASSWORD).catch((e: unknown) => e);
    expect((error as { body?: { code?: string } }).body?.code).toBe("LOCKED");
    expect(sessionCount()).toBe(sessionsBefore);
    // Refused before the password check: audited as locked, not counted again.
    expect(JSON.parse(lastAudit()!.changes!)).toMatchObject({ username: "liza.test", reason: "locked" });
    expect(countAction("auth.locked")).toBe(lockedBefore + 1);
    expect(
      t.db.get<{ n: number }>(sql`select failed_attempts as n from users where id = ${lizaId}`)!.n,
    ).toBe(5);
  });

  it("signs in again after unlock and resets the count on success", async () => {
    const { unlock } = await import("./lockout");
    expect(unlock(lizaId, { type: "system", name: "unlock-user" })).toBe("unlocked");
    await expect(signIn("liza.test", "wrong password again")).rejects.toThrow();
    const { response } = await signIn("liza.test", LIZA_PASSWORD);
    expect(response.user.id).toBe(lizaId);
    expect(
      t.db.get<{ n: number }>(sql`select failed_attempts as n from users where id = ${lizaId}`)!.n,
    ).toBe(0);
  });
});

describe("idle session lifetime", () => {
  it("lasts 15 minutes; a polling read never extends it, a normal read does", async () => {
    const { headers } = await signIn("ana.cruz", PASSWORD);
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const token = decodeURIComponent(cookie.split("session_token=")[1]!.split(";")[0]!).split(".")[0]!;
    const expiresAt = () =>
      t.db.get<{ e: number }>(sql`select expires_at as e from sessions where token = ${token}`)!.e;

    expect(expiresAt() - Date.now()).toBeGreaterThan(895_000);
    expect(expiresAt() - Date.now()).toBeLessThanOrEqual(900_000);

    // Pretend the session was last refreshed 14 minutes ago.
    const fourteenMinutesAgo = Date.now() - 14 * 60_000;
    t.db.run(
      sql`update sessions set updated_at = ${fourteenMinutesAgo}, expires_at = ${fourteenMinutesAgo + 900_000} where token = ${token}`,
    );
    const before = expiresAt();

    for (let i = 0; i < 3; i++) {
      const polled = await getAuth().api.getSession({
        headers: new Headers({ cookie }),
        query: { disableRefresh: true },
      });
      expect(polled?.user.name).toBe("Ana Cruz");
    }
    expect(expiresAt()).toBe(before);

    await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(expiresAt() - Date.now()).toBeGreaterThan(895_000);
  });

  it("is gone once it has expired", async () => {
    const { headers } = await signIn("ana.cruz", PASSWORD);
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const token = decodeURIComponent(cookie.split("session_token=")[1]!).split(".")[0]!;
    t.db.run(sql`update sessions set expires_at = ${Date.now() - 1000} where token = ${token}`);
    expect(
      await getAuth().api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } }),
    ).toBeNull();
  });
});

describe("HTTP sign-in rate limit", () => {
  it("answers the 11th attempt from one address within 60 s with 429, without checking the password", async () => {
    const attempt = () =>
      getAuth().handler(
        new Request("http://localhost:3000/api/auth/sign-in/username", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            "x-forwarded-for": "10.77.0.1",
          },
          body: JSON.stringify({ username: "nobody.at.all", password: "whatever-12345" }),
        }),
      );
    for (let i = 0; i < 10; i++) {
      expect((await attempt()).status).not.toBe(429);
    }
    const failedBefore = t.db.get<{ n: number }>(
      sql`select count(*) as n from audit_log where action = 'auth.sign_in_failed'`,
    )!.n;
    expect((await attempt()).status).toBe(429);
    // Refused before the endpoint ran: no password check, no hook.
    expect(
      t.db.get<{ n: number }>(sql`select count(*) as n from audit_log where action = 'auth.sign_in_failed'`)!.n,
    ).toBe(failedBefore);
  });
});

describe("disabled Better Auth routes", () => {
  const base = "http://localhost:3000/api/auth";

  it.each([
    ["/sign-in/email", { email: "ana.cruz@staff.opd.invalid", password: PASSWORD }],
    ["/sign-up/email", { email: "eve@staff.opd.invalid", password: "eve-password-123", name: "Eve" }],
    ["/admin/impersonate-user", { userId: "anything" }],
    ["/request-password-reset", { email: "ana.cruz@staff.opd.invalid" }],
  ])("rejects %s and creates no session", async (path, body) => {
    const before = sessionCount();
    const response = await getAuth().handler(
      new Request(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(false);
    expect(sessionCount()).toBe(before);
  });
});
