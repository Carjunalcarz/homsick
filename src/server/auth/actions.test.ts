import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCOUNT_LOCKED, TOO_MANY_ATTEMPTS, WRONG_CREDENTIALS } from "@/lib/auth-messages";
import { auditLog } from "@/server/audit/schema";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return { RedirectSignal, ip: "10.1.2.3", cookie: "", cookieSets: [] as string[] };
});

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": stubs.ip,
      "user-agent": "Action Test/1.0",
      ...(stubs.cookie ? { cookie: stubs.cookie } : {}),
    }),
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: (name: string) => {
      stubs.cookieSets.push(name);
    },
    delete: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new stubs.RedirectSignal(url);
  },
}));

const { getAuth } = await import("./auth");
const { keepAliveAction, reauthAction, signInAction } = await import("./actions");

let t: TestDb;
const savedEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
};
const PASSWORD = "correct horse battery";
const initial = { error: null, username: "" };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Run the action; return its state, or the URL it redirected to. */
async function submit(fields: Record<string, string>) {
  try {
    return { state: await signInAction(initial, form(fields)) };
  } catch (error) {
    if (error instanceof stubs.RedirectSignal) return { redirect: error.url };
    throw error;
  }
}

function lastAudit() {
  return t.db.select().from(auditLog).orderBy(sql`rowid desc`).limit(1).get();
}

function auditCount() {
  return t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
}

beforeAll(async () => {
  t = createTestDb();
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

describe("signInAction", () => {
  it("returns the generic message for a wrong password", async () => {
    const result = await submit({ username: "ana.cruz", password: "wrong password!!" });
    expect(result.state).toEqual({ error: WRONG_CREDENTIALS, username: "ana.cruz" });
  });

  it("returns the same message for an unknown user", async () => {
    const result = await submit({ username: "nobody.here", password: "whatever-12345" });
    expect(result.state?.error).toBe(WRONG_CREDENTIALS);
  });

  it("audits an empty password as a failed sign-in with the same message", async () => {
    const before = auditCount();
    const result = await submit({ username: "Ana.Cruz", password: "" });
    expect(result.state?.error).toBe(WRONG_CREDENTIALS);
    expect(auditCount()).toBe(before + 1);
    const row = lastAudit();
    expect(row).toMatchObject({ action: "auth.sign_in_failed", actorId: null });
    expect(JSON.parse(row!.changes!)).toEqual({
      username: "ana.cruz",
      ip: "10.1.2.3",
      userAgent: "Action Test/1.0",
    });
  });

  it("audits an over-long username as a failed sign-in", async () => {
    const result = await submit({ username: "a".repeat(80), password: PASSWORD });
    expect(result.state?.error).toBe(WRONG_CREDENTIALS);
    expect(JSON.parse(lastAudit()!.changes!).username).toHaveLength(30);
  });

  it.each(["https://evil.example", "/..//evil.example"])(
    "signs in and ignores the unsafe next %s",
    async (next) => {
      const result = await submit({ username: "ana.cruz", password: PASSWORD, next });
      expect(result.redirect).toBe("/");
      expect(lastAudit()).toMatchObject({ action: "auth.sign_in", actorName: "Ana Cruz" });
    },
  );

  it("goes to a safe next after sign-in", async () => {
    const result = await submit({ username: "ana.cruz", password: PASSWORD, next: "/triage" });
    expect(result.redirect).toBe("/triage");
  });
});

describe("signInAction lockout and rate limit", () => {
  beforeAll(async () => {
    await getAuth().api.createUser({
      body: {
        name: "Liza Test",
        email: "liza.test@staff.opd.invalid",
        password: PASSWORD,
        role: "triage_nurse",
        data: { username: "liza.test" },
      },
    });
  });

  it("shows the locked message after the 5th wrong password, even for the right password", async () => {
    stubs.ip = "10.1.2.4";
    for (let i = 1; i <= 4; i++) {
      const result = await submit({ username: "liza.test", password: `wrong password ${i}` });
      expect(result.state?.error).toBe(WRONG_CREDENTIALS);
    }
    // The 5th failure itself still gets the generic message; it locks the account.
    expect((await submit({ username: "liza.test", password: "wrong password 5" })).state?.error).toBe(
      WRONG_CREDENTIALS,
    );
    expect(
      t.db.get<{ n: number }>(sql`select count(*) as n from audit_log where action = 'auth.locked'`)!.n,
    ).toBe(1);

    const locked = await submit({ username: "liza.test", password: PASSWORD });
    expect(locked.state).toEqual({ error: ACCOUNT_LOCKED, username: "liza.test" });
    // Other failures keep the generic message.
    expect((await submit({ username: "nobody.here", password: "whatever-12345" })).state?.error).toBe(
      WRONG_CREDENTIALS,
    );
  });

  it("does not count successful sign-ins towards the limit", async () => {
    stubs.ip = "10.1.2.8";
    for (let i = 1; i <= 11; i++) {
      expect((await submit({ username: "ana.cruz", password: PASSWORD })).redirect).toBe("/");
    }
  });

  it("refuses the attempt after 10 failures from one address within 60 s, audited, without checking the password", async () => {
    stubs.ip = "10.1.2.5";
    for (let i = 1; i <= 10; i++) {
      const result = await submit({ username: "nobody.here", password: `wrong password ${i}` });
      expect(result.state?.error).toBe(WRONG_CREDENTIALS);
    }
    const before = auditCount();
    // Even the right password is not checked once the limit is reached.
    const result = await submit({ username: "ana.cruz", password: PASSWORD });
    expect(result.state).toEqual({ error: TOO_MANY_ATTEMPTS, username: "ana.cruz" });
    expect(auditCount()).toBe(before + 1);
    const row = lastAudit();
    expect(row).toMatchObject({ action: "auth.sign_in_failed", actorId: null });
    expect(JSON.parse(row!.changes!)).toEqual({
      username: "ana.cruz",
      ip: "10.1.2.5",
      userAgent: "Action Test/1.0",
      reason: "rate_limited",
    });

    // Another address is unaffected.
    stubs.ip = "10.1.2.6";
    expect((await submit({ username: "ana.cruz", password: PASSWORD })).redirect).toBe("/");
  });
});

describe("reauthAction and keepAliveAction", () => {
  it("returns the signed-in user instead of redirecting", async () => {
    stubs.ip = "10.1.2.7";
    const state = await reauthAction(
      { error: null, username: "", userId: null },
      form({ username: "ana.cruz", password: PASSWORD }),
    );
    expect(state.error).toBeNull();
    expect(state.userId).toMatch(/[0-9a-f-]{36}/);
  });

  it("reports signed out when there is no session", async () => {
    stubs.cookie = "";
    expect(await keepAliveAction()).toEqual({ signedIn: false });
  });

  describe("with a real session", () => {
    let token: string;
    let userId: string;
    const expiresAt = () =>
      t.db.get<{ e: number }>(sql`select expires_at as e from sessions where token = ${token}`)?.e;

    beforeAll(async () => {
      const { headers, response } = await getAuth().api.signInUsername({
        body: { username: "ana.cruz", password: PASSWORD },
        headers: new Headers({ "x-forwarded-for": "10.1.2.9" }),
        returnHeaders: true,
      });
      userId = response.user.id;
      stubs.cookie = headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      token = decodeURIComponent(stubs.cookie.split("session_token=")[1]!).split(".")[0]!;
    });

    afterAll(() => {
      stubs.cookie = "";
    });

    it("refreshes a session older than updateAge to ~900 s ahead, matching the DB", async () => {
      const aged = Date.now() - 14 * 60_000;
      t.db.run(sql`update sessions set updated_at = ${aged}, expires_at = ${aged + 900_000} where token = ${token}`);
      const result = await keepAliveAction();
      expect(result).toMatchObject({ signedIn: true, userId });
      if (!result.signedIn) throw new Error("expected signed in");
      const returned = Date.parse(result.expiresAt);
      expect(returned - Date.now()).toBeGreaterThan(895_000);
      expect(returned - Date.now()).toBeLessThanOrEqual(900_000);
      expect(expiresAt()).toBe(returned);
    });

    it("returns signed out for a deleted DB session, without throwing or touching cookies", async () => {
      t.db.run(sql`delete from sessions where token = ${token}`);
      stubs.cookieSets.length = 0;
      await expect(keepAliveAction()).resolves.toEqual({ signedIn: false });
      expect(stubs.cookieSets).toEqual([]);
    });
  });
});