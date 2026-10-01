import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "@/server/audit/schema";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

/** The signed-in user the actions see, and the Better Auth headers they pass on. */
const stubs = vi.hoisted(() => ({
  user: { id: "", name: "Ana Cruz", username: "ana.cruz", role: "admin" as string, facilityIds: [] as string[] },
  headers: new Headers(),
  revalidated: [] as string[],
}));

vi.mock("./session", () => ({
  requireStaff: async () => ({ ...stubs.user }),
  sessionHeaders: async () => new Headers(stubs.headers),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => stubs.revalidated.push(path) }));
// The real command transaction, which a test can make fail on a given action
// (as if the audit row couldn't be written) to check the compensation.
const failing = vi.hoisted(() => ({ action: null as string | null }));
vi.mock("@/server/db/tx", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/db/tx")>();
  return {
    ...real,
    withCommandTx: ((actor, action, fn, db) => {
      if (action === failing.action) throw new Error("audit write failed");
      return real.withCommandTx(actor, action, fn, db);
    }) as typeof real.withCommandTx,
  };
});

const { getAuth } = await import("./auth");
const { ruleAllows } = await import("./permissions");
const { activeFacilityIdsOf, getStaffMember, listStaff } = await import("./staff-queries");
const service = await import("./staff-service");
const actions = await import("./staff-actions");
const { listFacilities } = await import("@/server/settings/queries");
const { deactivateFacility } = await import("@/server/settings/service");

const ADMIN_PASSWORD = "ana correct horse";
const JOY_PASSWORD = "joy temporary 1";

let t: TestDb;
let adminId: string;
let adminHeaders: Headers;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };

function cookieOf(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function signIn(username: string, password: string) {
  const { headers, response } = await getAuth().api.signInUsername({
    body: { username, password },
    headers: new Headers({ "x-forwarded-for": "10.9.0.1" }),
    returnHeaders: true,
  });
  return { userId: response.user.id, headers: new Headers({ cookie: cookieOf(headers) }) };
}

async function canSignIn(username: string, password: string) {
  try {
    await signIn(username, password);
    return true;
  } catch {
    return false;
  }
}

// Every test gets a freshly migrated database with one signed-in Admin.
beforeEach(async () => {
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
      password: ADMIN_PASSWORD,
      role: "admin",
      data: { username: "ana.cruz" },
    },
  });
  const signedIn = await signIn("ana.cruz", ADMIN_PASSWORD);
  adminId = signedIn.userId;
  adminHeaders = signedIn.headers;
  stubs.user = { id: adminId, name: "Ana Cruz", username: "ana.cruz", role: "admin", facilityIds: [] };
  stubs.headers = adminHeaders;
  stubs.revalidated.length = 0;
  failing.action = null;
});

afterEach(() => {
  closeDb();
  (globalThis as { __opdAuth?: unknown }).__opdAuth = undefined;
  t.cleanup();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
});

const actor = () => ({ type: "staff" as const, id: adminId, name: "Ana Cruz" });

function facilityId(name: string) {
  const facility = listFacilities(new Date(), t.db).find((f) => f.name === name);
  if (!facility) throw new Error(`no Facility ${name}`);
  return facility.id;
}

function auditRows(action?: string) {
  const rows = action
    ? t.db.select().from(auditLog).where(sql`${auditLog.action} = ${action}`).orderBy(sql`rowid`).all()
    : t.db.select().from(auditLog).orderBy(sql`rowid`).all();
  return rows.map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
}

function auditCount() {
  return t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
}

/** Everything a staff command may write, for "nothing changed" checks. */
function snapshot() {
  return JSON.stringify([
    t.db.all(sql`select id, name, username, role, banned, locked_at, failed_attempts from users order by id`),
    t.db.all(sql`select user_id, facility_id from user_facilities order by user_id, facility_id`),
    t.db.all(sql`select id, user_id, password from accounts order by id`),
    t.db.all(sql`select id from sessions order by id`),
  ]);
}

function createJoy(overrides: Partial<Parameters<typeof service.createStaff>[0]> = {}) {
  return service.createStaff(
    {
      name: "Joy Santos",
      username: "joy.santos",
      role: "facility_staff",
      facilityIds: [facilityId("Prenatal"), facilityId("Animal Bite Center")],
      password: JOY_PASSWORD,
      ...overrides,
    },
    actor(),
    adminHeaders,
  );
}

describe("createStaff", () => {
  it("creates Facility Staff with two Facilities, audits once without the password, and they can sign in", async () => {
    const { member } = await createJoy();
    expect(member).toMatchObject({ name: "Joy Santos", username: "joy.santos", role: "facility_staff", status: "active" });
    expect(member.facilities.map((f) => [f.name, f.prefix])).toEqual([
      ["Prenatal", "PN"],
      ["Animal Bite Center", "AB"],
    ]);

    const rows = auditRows("staff.created");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: adminId, actorName: "Ana Cruz", entity: "user", entityId: member.id });
    expect(rows[0]!.changes).toEqual({
      name: "Joy Santos",
      username: "joy.santos",
      role: "facility_staff",
      facilities: [
        { id: facilityId("Prenatal"), name: "Prenatal" },
        { id: facilityId("Animal Bite Center"), name: "Animal Bite Center" },
      ],
    });
    expect(JSON.stringify(auditRows())).not.toContain(JOY_PASSWORD);

    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(true);
    expect(listStaff({ q: "joy" }, t.db).rows.map((r) => r.username)).toEqual(["joy.santos"]);
  });

  it("creates Triage Nurses and Admins without Facilities", async () => {
    const nurse = await createJoy({ username: "liza.nurse", name: "Liza Reyes", role: "triage_nurse", facilityIds: [] });
    const admin = await createJoy({ username: "ben.admin", name: "Ben Ramos", role: "admin", facilityIds: [] });
    expect(nurse.member).toMatchObject({ role: "triage_nurse", facilities: [] });
    expect(admin.member).toMatchObject({ role: "admin", facilities: [] });
    expect(auditRows("staff.created")).toHaveLength(2);
  });

  it.each([
    ["Facility Staff without a Facility", { role: "facility_staff", facilityIds: [] }, "facilities_required"],
    ["a Triage Nurse with Facilities", { role: "triage_nurse" }, "facilities_not_allowed"],
    ["an Admin with Facilities", { role: "admin" }, "facilities_not_allowed"],
    ["an unknown Facility", { facilityIds: ["no-such-facility"] }, "facility_unavailable"],
  ] as const)("refuses %s and writes nothing", async (_label, overrides, code) => {
    const before = snapshot();
    const audits = auditCount();
    await expect(createJoy(overrides as never)).rejects.toMatchObject({ code });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(audits);
  });

  it("refuses a deactivated Facility for a new assignment", async () => {
    deactivateFacility(facilityId("Treatment"), actor(), new Date(), t.db);
    await expect(createJoy({ facilityIds: [facilityId("Treatment")] })).rejects.toMatchObject({
      code: "facility_unavailable",
    });
    await expect(createJoy({ facilityIds: [facilityId("Treatment"), facilityId("Prenatal")] })).rejects.toMatchObject({
      code: "facility_unavailable",
    });
  });

  it("refuses a username that is already taken", async () => {
    await createJoy();
    const before = snapshot();
    const audits = auditCount();
    await expect(createJoy({ name: "Joy Other" })).rejects.toMatchObject({ code: "username_taken" });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(audits);
  });
});

describe("createStaffAction", () => {
  const form = (overrides: Record<string, unknown> = {}) => ({
    name: "  Joy Santos ",
    username: " Joy.Santos ",
    role: "facility_staff",
    facilityIds: [facilityId("Prenatal")],
    password: JOY_PASSWORD,
    ...overrides,
  });

  it("normalizes the name and username and revalidates the page", async () => {
    expect(await actions.createStaffAction(form())).toEqual({ ok: true, data: { changed: true, name: "Joy Santos" } });
    expect(stubs.revalidated).toEqual(["/admin/staff"]);
    expect(auditRows("staff.created")[0]!.changes).toMatchObject({ name: "Joy Santos", username: "joy.santos" });
  });

  it("shows a duplicate username (any case) on the username field", async () => {
    await actions.createStaffAction(form());
    const result = await actions.createStaffAction(form({ username: "JOY.SANTOS" }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "username_taken", fieldErrors: { username: "Username already in use" } },
    });
  });

  it("refuses shared names, short passwords and a missing name with field errors", async () => {
    const before = snapshot();
    const result = await actions.createStaffAction(form({ username: "admin", password: "short", name: " " }));
    if (result.ok) throw new Error("expected failure");
    expect(Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual(["name", "password", "username"]);
    expect(result.error.fieldErrors?.username).toMatch(/shared account/);
    expect(JSON.stringify(result)).not.toContain("short");
    expect(snapshot()).toBe(before);
  });

  it.each([
    [{ role: "facility_staff", facilityIds: [] }, "Facility Staff need at least one active Facility."],
    [{ role: "triage_nurse" }, "Only Facility Staff have Facilities. Triage Nurses and Admins have none."],
  ])("explains the Facility rule on the Facilities field (%o)", async (overrides, message) => {
    const result = await actions.createStaffAction(form(overrides));
    expect(result).toMatchObject({ ok: false, error: { fieldErrors: { facilityIds: message } } });
  });
});

describe("updateStaff", () => {
  it("saves name, Role and Facilities and audits the old and new values once", async () => {
    const { member } = await createJoy();
    const result = await service.updateStaff(
      { id: member.id, name: "Joy S. Santos", role: "facility_staff", facilityIds: [facilityId("Treatment")] },
      actor(),
      adminHeaders,
    );
    expect(result.changed).toBe(true);
    expect(result.member).toMatchObject({ name: "Joy S. Santos" });
    expect(result.member.facilities.map((f) => f.name)).toEqual(["Treatment"]);
    const rows = auditRows("staff.updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toEqual({
      username: "joy.santos",
      name: { old: "Joy Santos", new: "Joy S. Santos" },
      facilities: {
        old: [
          { id: facilityId("Prenatal"), name: "Prenatal" },
          { id: facilityId("Animal Bite Center"), name: "Animal Bite Center" },
        ],
        new: [{ id: facilityId("Treatment"), name: "Treatment" }],
      },
    });

    // A Role change clears the Facilities.
    await service.updateStaff(
      { id: member.id, name: "Joy S. Santos", role: "triage_nurse", facilityIds: [] },
      actor(),
      adminHeaders,
    );
    expect(getStaffMember(member.id, t.db)).toMatchObject({ role: "triage_nurse", facilities: [] });
    expect(auditRows("staff.updated")[1]!.changes).toMatchObject({ role: { old: "facility_staff", new: "triage_nurse" } });
  });

  it("writes nothing when nothing changed", async () => {
    const { member } = await createJoy();
    const audits = auditCount();
    const result = await service.updateStaff(
      {
        id: member.id,
        name: "Joy Santos",
        role: "facility_staff",
        facilityIds: [facilityId("Animal Bite Center"), facilityId("Prenatal")],
      },
      actor(),
      adminHeaders,
    );
    expect(result.changed).toBe(false);
    expect(auditCount()).toBe(audits);
  });

  it("keeps a deactivated Facility that is already assigned, but needs an active one", async () => {
    const { member } = await createJoy();
    deactivateFacility(facilityId("Animal Bite Center"), actor(), new Date(), t.db);
    const keep = await service.updateStaff(
      {
        id: member.id,
        name: "Joy Santos Reyes",
        role: "facility_staff",
        facilityIds: [facilityId("Prenatal"), facilityId("Animal Bite Center")],
      },
      actor(),
      adminHeaders,
    );
    expect(keep.member.facilities.map((f) => [f.name, f.active])).toEqual([
      ["Prenatal", true],
      ["Animal Bite Center", false],
    ]);
    await expect(
      service.updateStaff(
        { id: member.id, name: "Joy", role: "facility_staff", facilityIds: [facilityId("Animal Bite Center")] },
        actor(),
        adminHeaders,
      ),
    ).rejects.toMatchObject({ code: "facilities_required" });
  });

  it("refuses to let an Admin demote themself, and changes nothing", async () => {
    await createJoy({ username: "ben.admin", name: "Ben Ramos", role: "admin", facilityIds: [] });
    const before = snapshot();
    const audits = auditCount();
    const result = await actions.updateStaffAction({ id: adminId, name: "Ana Cruz", role: "triage_nurse", facilityIds: [] });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "self_action", fieldErrors: { role: "You can't remove your own Admin Role. Ask another Admin." } },
    });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(audits);
  });

  it("refuses to demote the last active Admin", async () => {
    const before = snapshot();
    // Acting as someone other than Ana, the only active Admin.
    await expect(
      service.updateStaff(
        { id: adminId, name: "Ana Cruz", role: "triage_nurse", facilityIds: [] },
        { type: "staff", id: "someone-else", name: "Someone Else" },
        adminHeaders,
      ),
    ).rejects.toMatchObject({ code: "last_admin" });
    expect(snapshot()).toBe(before);
  });

  it("lets an Admin demote another Admin while one stays active", async () => {
    const { member: ben } = await createJoy({ username: "ben.admin", name: "Ben Ramos", role: "admin", facilityIds: [] });
    const result = await actions.updateStaffAction({ id: ben.id, name: "Ben Ramos", role: "triage_nurse", facilityIds: [] });
    expect(result).toEqual({ ok: true, data: { changed: true, name: "Ben Ramos" } });
    expect(getStaffMember(ben.id, t.db)?.role).toBe("triage_nurse");
  });
});

describe("deactivateStaff and reactivateStaff", () => {
  it("signs the person out at once, blocks sign-in, keeps their name on past audit rows, and reactivates", async () => {
    const { member } = await createJoy();
    const joy = await signIn("joy.santos", JOY_PASSWORD);
    expect(await getAuth().api.getSession({ headers: joy.headers })).not.toBeNull();

    const audits = auditCount();
    expect(await actions.deactivateStaffAction({ id: member.id })).toEqual({
      ok: true,
      data: { changed: true, name: "Joy Santos" },
    });
    expect(auditCount()).toBe(audits + 1);
    expect(auditRows("staff.deactivated")[0]).toMatchObject({
      entityId: member.id,
      changes: { username: "joy.santos", name: "Joy Santos", banned: { old: false, new: true } },
    });

    // Her next request finds no session, and she can't sign in again.
    expect(await getAuth().api.getSession({ headers: joy.headers })).toBeNull();
    expect(t.db.get<{ n: number }>(sql`select count(*) as n from sessions where user_id = ${member.id}`)!.n).toBe(0);
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(false);

    // Nothing is deleted; her own sign-in row still names her.
    expect(getStaffMember(member.id, t.db)).toMatchObject({ status: "deactivated", name: "Joy Santos" });
    expect(auditRows("auth.sign_in").find((row) => row.actorId === member.id)).toMatchObject({ actorName: "Joy Santos" });
    // It is not the lockout.
    expect(getStaffMember(member.id, t.db)?.lockedAt).toBeNull();

    // Deactivating again changes nothing.
    const afterDeactivation = auditCount();
    expect(await actions.deactivateStaffAction({ id: member.id })).toMatchObject({ ok: true, data: { changed: false } });
    expect(auditCount()).toBe(afterDeactivation);

    expect(await actions.reactivateStaffAction({ id: member.id })).toMatchObject({ ok: true, data: { changed: true } });
    expect(auditRows("staff.reactivated")[0]!.changes).toMatchObject({ banned: { old: true, new: false } });
    expect(getStaffMember(member.id, t.db)?.status).toBe("active");
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(true);
  });

  it("refuses to let an Admin deactivate themself", async () => {
    await createJoy({ username: "ben.admin", name: "Ben Ramos", role: "admin", facilityIds: [] });
    const before = snapshot();
    const audits = auditCount();
    const result = await actions.deactivateStaffAction({ id: adminId });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "self_action", message: "You can't deactivate your own account. Ask another Admin." },
    });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(audits);
  });

  it("refuses to deactivate the last active Admin", async () => {
    const before = snapshot();
    await expect(
      service.deactivateStaff(adminId, { type: "staff", id: "someone-else", name: "Someone Else" }, adminHeaders),
    ).rejects.toMatchObject({ code: "last_admin" });
    expect(snapshot()).toBe(before);
  });

  it("won't reactivate Facility Staff whose Facilities are all deactivated", async () => {
    const { member } = await createJoy({ facilityIds: [facilityId("Treatment")] });
    await service.deactivateStaff(member.id, actor(), adminHeaders);
    deactivateFacility(facilityId("Treatment"), actor(), new Date(), t.db);
    await expect(service.reactivateStaff(member.id, actor(), adminHeaders)).rejects.toMatchObject({
      code: "facilities_required",
    });
    expect(getStaffMember(member.id, t.db)?.status).toBe("deactivated");
  });
});

describe("lockout, passwords and reactivation", () => {
  async function lockJoy() {
    for (let i = 0; i < 5; i++) expect(await canSignIn("joy.santos", `wrong password ${i}`)).toBe(false);
  }

  it("a new temporary password clears a lockout and signs the person out everywhere", async () => {
    const { member } = await createJoy();
    const joy = await signIn("joy.santos", JOY_PASSWORD);
    await lockJoy();
    expect(getStaffMember(member.id, t.db)?.status).toBe("locked");

    const NEW_PASSWORD = "fresh temp pass 7";
    expect(await actions.setTemporaryPasswordAction({ id: member.id, password: NEW_PASSWORD })).toMatchObject({
      ok: true,
    });
    expect(await getAuth().api.getSession({ headers: joy.headers })).toBeNull();
    expect(t.db.get<{ n: number }>(sql`select count(*) as n from sessions where user_id = ${member.id}`)!.n).toBe(0);
    expect(getStaffMember(member.id, t.db)).toMatchObject({ status: "active", failedAttempts: 0 });
    expect(auditRows("staff.password_set")[0]!.changes).toEqual({
      username: "joy.santos",
      lockCleared: true,
      sessionsRevoked: true,
    });
    expect(await canSignIn("joy.santos", NEW_PASSWORD)).toBe(true);
  });

  it("reactivation clears a lockout left from before deactivation", async () => {
    const { member } = await createJoy();
    await lockJoy();
    await service.deactivateStaff(member.id, actor(), adminHeaders);
    await service.reactivateStaff(member.id, actor(), adminHeaders);
    expect(auditRows("staff.reactivated")[0]!.changes).toMatchObject({ lockCleared: true });
    expect(getStaffMember(member.id, t.db)).toMatchObject({ status: "active", lockedAt: null });
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(true);
  });

  it("records lockCleared false when there was no lock", async () => {
    const { member } = await createJoy();
    await service.deactivateStaff(member.id, actor(), adminHeaders);
    await service.reactivateStaff(member.id, actor(), adminHeaders);
    expect(auditRows("staff.reactivated")[0]!.changes).toMatchObject({ lockCleared: false });
  });
});

describe("usernames and search", () => {
  it.each([".joy", "joy.", "a..b", "_joy", "joy-"])("refuses the username %j on its field", async (username) => {
    const result = await actions.createStaffAction({
      name: "Joy Santos",
      username,
      role: "triage_nurse",
      facilityIds: [],
      password: JOY_PASSWORD,
    });
    expect(result).toMatchObject({ ok: false, error: { fieldErrors: { username: expect.stringMatching(/can't start/) } } });
  });

  it("maps Better Auth's invalid email to the username field", async () => {
    // Past the Zod rules (service called directly): Better Auth rejects the email.
    await expect(createJoy({ username: "joy..santos" })).rejects.toMatchObject({ code: "username_invalid" });
    expect(listStaff({ q: "joy" }, t.db).total).toBe(0);
  });

  it("matches names with non-ASCII letters in any case", async () => {
    await createJoy({ username: "ana.pena", name: "Ana PEÑA", role: "triage_nurse", facilityIds: [] });
    await createJoy({ username: "jose.munoz", name: "José muñoz", role: "triage_nurse", facilityIds: [] });
    expect(listStaff({ q: "peña" }, t.db).rows.map((r) => r.name)).toEqual(["Ana PEÑA"]);
    expect(listStaff({ q: "MUÑOZ" }, t.db).rows.map((r) => r.name)).toEqual(["José muñoz"]);
    expect(listStaff({ q: "JOSÉ" }, t.db).total).toBe(1);
  });
});

describe("unexpected failures in actions", () => {
  it("come back as a result, not a thrown error", async () => {
    failing.action = "staff.created";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await actions.createStaffAction({
      name: "Joy Santos",
      username: "joy.santos",
      role: "triage_nurse",
      facilityIds: [],
      password: JOY_PASSWORD,
    });
    errors.mockRestore();
    expect(result).toEqual({ ok: false, error: { code: "failed", message: "Couldn't save the change. Try again." } });
  });

  it("domain errors still revalidate the page", async () => {
    await actions.createStaffAction({ name: "A", username: "ana.cruz", role: "admin", facilityIds: [], password: JOY_PASSWORD });
    expect(stubs.revalidated).toEqual(["/admin/staff"]);
  });
});

describe("unlock", () => {
  it("unlocks an account locked after 5 failures with one auth.unlocked row", async () => {
    const { member } = await createJoy();
    for (let i = 0; i < 5; i++) expect(await canSignIn("joy.santos", `wrong password ${i}`)).toBe(false);
    expect(getStaffMember(member.id, t.db)?.status).toBe("locked");
    expect(listStaff({ status: "locked" }, t.db).rows.map((r) => r.username)).toEqual(["joy.santos"]);
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(false);

    expect(await actions.unlockStaffAction({ id: member.id })).toEqual({
      ok: true,
      data: { changed: true, name: "Joy Santos" },
    });
    const rows = auditRows("auth.unlocked");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: adminId, entityId: member.id });
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(true);

    // Nothing to unlock now.
    expect(await actions.unlockStaffAction({ id: member.id })).toMatchObject({ ok: true, data: { changed: false } });
    expect(auditRows("auth.unlocked")).toHaveLength(1);
  });
});

describe("setTemporaryPassword", () => {
  it("sets a password that works, retires the old one, and never audits it", async () => {
    const { member } = await createJoy();
    const NEW_PASSWORD = "brand new temp 42";
    expect(await actions.setTemporaryPasswordAction({ id: member.id, password: NEW_PASSWORD })).toEqual({
      ok: true,
      data: { changed: true, name: "Joy Santos" },
    });
    expect(await canSignIn("joy.santos", NEW_PASSWORD)).toBe(true);
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(false);

    const rows = auditRows("staff.password_set");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: member.id, changes: { username: "joy.santos" } });
    const all = JSON.stringify(auditRows());
    expect(all).not.toContain(NEW_PASSWORD);
    expect(all).not.toContain(JOY_PASSWORD);
  });

  it("refuses a password under 10 characters", async () => {
    const { member } = await createJoy();
    const result = await actions.setTemporaryPasswordAction({ id: member.id, password: "123456789" });
    expect(result).toMatchObject({ ok: false, error: { fieldErrors: { password: expect.any(String) } } });
    expect(auditRows("staff.password_set")).toHaveLength(0);
  });
});

describe("listStaff", () => {
  it("filters by search, Role and status, sorts by name and pages with a total", async () => {
    const make = (username: string, name: string, role: "admin" | "triage_nurse" | "facility_staff") =>
      createJoy({ username, name, role, facilityIds: role === "facility_staff" ? [facilityId("Prenatal")] : [] });
    await make("joy.santos", "Joy Santos", "facility_staff");
    await make("liza.reyes", "Liza Reyes", "triage_nurse");
    const { member: mark } = await make("mark.dela", "Mark Dela Cruz", "triage_nurse");
    await make("ben.ramos", "Ben Ramos", "admin");
    await service.deactivateStaff(mark.id, actor(), adminHeaders);

    const all = listStaff({}, t.db);
    expect(all.total).toBe(5);
    expect(all.rows.map((r) => r.name)).toEqual(["Ana Cruz", "Ben Ramos", "Joy Santos", "Liza Reyes", "Mark Dela Cruz"]);

    // Partial, case-insensitive, name or username.
    expect(listStaff({ q: "CRUZ" }, t.db).rows.map((r) => r.name)).toEqual(["Ana Cruz", "Mark Dela Cruz"]);
    expect(listStaff({ q: "dela" }, t.db).rows.map((r) => r.username)).toEqual(["mark.dela"]);
    expect(listStaff({ q: "cruz", role: "triage_nurse" }, t.db)).toMatchObject({ total: 1 });
    expect(listStaff({ q: "cruz", status: "active" }, t.db).rows.map((r) => r.name)).toEqual(["Ana Cruz"]);
    expect(listStaff({ role: "triage_nurse", status: "deactivated" }, t.db).rows.map((r) => r.name)).toEqual([
      "Mark Dela Cruz",
    ]);
    expect(listStaff({ q: "%" }, t.db).total).toBe(0);

    const page2 = listStaff({ page: 2, pageSize: 2 }, t.db);
    expect(page2).toMatchObject({ total: 5, page: 2, pageCount: 3, pageSize: 2 });
    expect(page2.rows.map((r) => r.name)).toEqual(["Joy Santos", "Liza Reyes"]);
    // A page past the end shows the last page.
    expect(listStaff({ page: 9, pageSize: 2 }, t.db).rows.map((r) => r.name)).toEqual(["Mark Dela Cruz"]);
  });
});

describe("Facility scope from real assignments", () => {
  it("uses the user's active Facilities", async () => {
    const { member } = await createJoy();
    const pn = facilityId("Prenatal");
    const ab = facilityId("Animal Bite Center");
    const rule = { roles: ["admin", "facility_staff"], scope: "facility" } as const;
    const joy = { role: "facility_staff", facilityIds: activeFacilityIdsOf(member.id, t.db) };
    expect(joy.facilityIds.sort()).toEqual([pn, ab].sort());
    expect(ruleAllows(rule, joy, pn)).toBe(true);
    expect(ruleAllows(rule, joy, facilityId("Treatment"))).toBe(false);

    deactivateFacility(ab, actor(), new Date(), t.db);
    const after = { role: "facility_staff", facilityIds: activeFacilityIdsOf(member.id, t.db) };
    expect(after.facilityIds).toEqual([pn]);
    expect(ruleAllows(rule, after, ab)).toBe(false);
  });
});

describe("compensation when the audit row can't be written", () => {
  it("removes a created account", async () => {
    const before = snapshot();
    failing.action = "staff.created";
    await expect(createJoy()).rejects.toThrow("audit write failed");
    expect(snapshot()).toBe(before);
    failing.action = null;
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(false);
  });

  it("restores the name and Role, the password, and the ban state", async () => {
    const { member } = await createJoy();
    const before = snapshot();

    failing.action = "staff.updated";
    await expect(
      service.updateStaff({ id: member.id, name: "Joy X", role: "triage_nurse", facilityIds: [] }, actor(), adminHeaders),
    ).rejects.toThrow("audit write failed");
    failing.action = "staff.password_set";
    await expect(
      service.setTemporaryPassword({ id: member.id, password: "never stored 123" }, actor(), adminHeaders),
    ).rejects.toThrow("audit write failed");
    failing.action = "staff.deactivated";
    await expect(service.deactivateStaff(member.id, actor(), adminHeaders)).rejects.toThrow("audit write failed");

    // Only updatedAt-like columns may differ; the snapshot has none of them.
    expect(snapshot()).toBe(before);
    failing.action = null;
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(true);
  });

  it("unbans when revoking the sessions fails after the ban", async () => {
    const { member } = await createJoy();
    const before = snapshot();
    const revoke = vi
      .spyOn(getAuth().api, "revokeUserSessions")
      .mockRejectedValueOnce(new Error("revoke failed"));
    try {
      await expect(service.deactivateStaff(member.id, actor(), adminHeaders)).rejects.toThrow("revoke failed");
    } finally {
      revoke.mockRestore();
    }
    expect(snapshot()).toBe(before);
    expect(auditRows("staff.deactivated")).toHaveLength(0);
    expect(getStaffMember(member.id, t.db)?.status).toBe("active");
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(true);
  });

  it("bans again when the reactivation can't be audited", async () => {
    const { member } = await createJoy();
    await service.deactivateStaff(member.id, actor(), adminHeaders);
    const before = snapshot();
    failing.action = "staff.reactivated";
    await expect(service.reactivateStaff(member.id, actor(), adminHeaders)).rejects.toThrow("audit write failed");
    failing.action = null;
    expect(snapshot()).toBe(before);
    expect(await canSignIn("joy.santos", JOY_PASSWORD)).toBe(false);
  });
});

describe("staff actions for non-Admins", () => {
  it.each(["triage_nurse", "facility_staff"])("deny %s: nothing changes and no audit row", async (role) => {
    const { member } = await createJoy();
    stubs.user = { ...stubs.user, role };
    const before = snapshot();
    const audits = auditCount();
    const results = [
      await actions.createStaffAction({
        name: "Eve Mallory",
        username: "eve.mallory",
        role: "admin",
        facilityIds: [],
        password: "eve password 123",
      }),
      await actions.updateStaffAction({ id: member.id, name: "Joy X", role: "admin", facilityIds: [] }),
      await actions.setTemporaryPasswordAction({ id: member.id, password: "another password" }),
      await actions.unlockStaffAction({ id: member.id }),
      await actions.deactivateStaffAction({ id: member.id }),
      await actions.reactivateStaffAction({ id: member.id }),
    ];
    for (const result of results) expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(audits);
    expect(stubs.revalidated).toEqual([]);
  });
});
