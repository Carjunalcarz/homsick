import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

/** The cookie jar `cookies()` returns: `name=value` pairs, like Next's. */
const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));

vi.mock("next/headers", () => ({
  // The request's own cookie header is stale on purpose: session code must
  // read the current jar (after a Server Action signs in, only the jar has it).
  headers: async () => new Headers({ "user-agent": "Session Test/1.0" }),
  cookies: async () => ({
    getAll: () => [...jar.cookies],
    get: (name: string) => jar.cookies.find((c) => c.name === name),
    toString: () => jar.cookies.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; "),
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { getAuth } = await import("./auth");
const { getStaff } = await import("./session");
const { GET } = await import("@/app/api/auth-status/route");

let t: TestDb;
let userId: string;
let token: string;
let sessionCookie: { name: string; value: string };
const savedEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
};
const PASSWORD = "correct horse battery";

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
  const { headers, response } = await getAuth().api.signInUsername({
    body: { username: "ana.cruz", password: PASSWORD },
    headers: new Headers({ "x-forwarded-for": "10.2.0.1" }),
    returnHeaders: true,
  });
  userId = response.user.id;
  const [pair] = headers.getSetCookie().filter((c) => c.includes("session_token="));
  const [name, ...rest] = pair!.split(";")[0]!.split("=");
  sessionCookie = { name: name!, value: decodeURIComponent(rest.join("=")) };
  token = sessionCookie.value.split(".")[0]!;
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

const dbExpiresAt = () =>
  t.db.get<{ e: number }>(sql`select expires_at as e from sessions where token = ${token}`)!.e;

describe("getStaff", () => {
  it("reads the session from the current cookie jar", async () => {
    jar.cookies = [sessionCookie];
    expect(await getStaff()).toEqual({
      id: userId,
      name: "Ana Cruz",
      username: "ana.cruz",
      role: "admin",
      facilityIds: [],
    });
  });

  it("includes the user's active Facility assignments", async () => {
    const pn = "3f1c2a8e-5b7d-4c1e-9a2f-6d8b0e4c7a11";
    const tr = "c5d7e9f1-2a4b-4c6d-8e0f-1a3b5c7d9e33";
    t.db.run(sql`insert into user_facilities (user_id, facility_id) values (${userId}, ${pn}), (${userId}, ${tr})`);
    t.db.run(sql`update facilities set deactivated_at = '2026-09-01T00:00:00.000Z' where id = ${tr}`);
    const { getStaffNoRefresh } = await import("./session");
    try {
      jar.cookies = [sessionCookie];
      // Only Facility Staff have Facilities: an Admin's stray rows are ignored.
      expect((await getStaffNoRefresh())?.facilityIds).toEqual([]);
      t.db.run(sql`update users set role = 'facility_staff' where id = ${userId}`);
      // getStaff is cached per request; the test has no request scope, so read again.
      expect((await getStaffNoRefresh())?.facilityIds).toEqual([pn]);
    } finally {
      t.db.run(sql`update users set role = 'admin' where id = ${userId}`);
      t.db.run(sql`delete from user_facilities where user_id = ${userId}`);
      t.db.run(sql`update facilities set deactivated_at = null where id = ${tr}`);
    }
  });

  it("returns null with an empty jar", async () => {
    jar.cookies = [];
    expect(await getStaff()).toBeNull();
  });
});

describe("GET /api/auth-status", () => {
  it("never extends a session, even one aged past updateAge", async () => {
    jar.cookies = [sessionCookie];
    const aged = Date.now() - 14 * 60_000;
    t.db.run(sql`update sessions set updated_at = ${aged}, expires_at = ${aged + 900_000} where token = ${token}`);
    const before = dbExpiresAt();

    for (let i = 0; i < 3; i++) {
      const body = await (await GET()).json();
      expect(body).toMatchObject({ signedIn: true, userId });
      expect(Date.parse(body.expiresAt)).toBe(before);
    }
    expect(dbExpiresAt()).toBe(before);
  });

  it("answers signed out without a session", async () => {
    jar.cookies = [];
    expect(await (await GET()).json()).toMatchObject({ signedIn: false, userId: null, expiresAt: null });
  });
});
