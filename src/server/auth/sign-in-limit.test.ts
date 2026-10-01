import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { rateLimits } from "./schema";
import { isSignInLimited, recordSignInFailure, SIGN_IN_MAX, signInLimitKey } from "./sign-in-limit";

let t: TestDb;

beforeAll(() => {
  t = createTestDb();
});

afterAll(() => t.cleanup());

describe("sign-in rate limit (server-action path)", () => {
  it("limits a key after 10 failures within 60 s", () => {
    const key = signInLimitKey("10.9.9.1", "x");
    const start = 1_000_000;
    for (let i = 0; i < SIGN_IN_MAX; i++) {
      expect(isSignInLimited(key, start + i * 1000, t.db)).toBe(false);
      recordSignInFailure(key, start + i * 1000, t.db);
    }
    expect(isSignInLimited(key, start + 10_000, t.db)).toBe(true);
    // Other addresses have their own bucket.
    expect(isSignInLimited(signInLimitKey("10.9.9.2", "x"), start + 10_000, t.db)).toBe(false);

    const row = t.db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
    expect(row).toMatchObject({ key: "action:sign-in:10.9.9.1", count: 10 });
  });

  it("lifts the limit 60 s after the last failure, and counts afresh", () => {
    const key = signInLimitKey("10.9.9.3", "x");
    const start = 5_000_000;
    for (let i = 0; i < SIGN_IN_MAX; i++) recordSignInFailure(key, start, t.db);
    expect(isSignInLimited(key, start + 59_999, t.db)).toBe(true);
    expect(isSignInLimited(key, start + 60_000, t.db)).toBe(false);
    recordSignInFailure(key, start + 60_000, t.db);
    expect(t.db.select().from(rateLimits).where(eq(rateLimits.key, key)).get()?.count).toBe(1);
  });

  it("keys on the attempted username when there is no address, never one global bucket", () => {
    expect(signInLimitKey(null, " Ana.Cruz ")).toBe("action:sign-in:user:ana.cruz");
    expect(signInLimitKey(null, "liza.test")).not.toBe(signInLimitKey(null, "ana.cruz"));
    expect(signInLimitKey("10.0.0.1", "ana.cruz")).toBe("action:sign-in:10.0.0.1");
  });
});
