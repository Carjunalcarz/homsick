import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { DomainError } from "@/server/db/errors";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => ({
  user: { id: "u-admin", name: "Ana Cruz", username: "ana.cruz", role: "admin" as string },
  revalidated: [] as string[],
}));

vi.mock("@/server/auth/session", () => ({ requireStaff: async () => ({ ...stubs.user }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => stubs.revalidated.push(path) }));
// The real repo, with selectAllFacilities spied on so a test can hide a row
// from the service's own checks (simulating a race to the unique index).
vi.mock("./repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("./repo")>();
  return { ...real, selectAllFacilities: vi.fn(real.selectAllFacilities) };
});

const repo = await import("./repo");
const { effectivePrefix, isOpen, listFacilities, liveFacilities, getFacility, pendingPrefix } = await import(
  "./queries"
);
const { updateFacility, deactivateFacility, reactivateFacility } = await import("./service");
const { updateFacilityAction, deactivateFacilityAction, reactivateFacilityAction } = await import("./actions");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const actor: Actor = { type: "staff", id: "u-admin", name: "Ana Cruz" };

// Every test gets a freshly migrated database with only the seed rows.
beforeEach(() => {
  t = createTestDb();
  process.env.DATABASE_PATH = t.filePath;
  process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(40, "x");
  resetEnvForTests();
  closeDb();
  stubs.user.role = "admin";
  stubs.revalidated.length = 0;
});

afterEach(() => {
  closeDb();
  t.cleanup();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
});

function byName(name: string) {
  const facility = listFacilities(new Date(), t.db).find((f) => f.name === name);
  if (!facility) throw new Error(`no Facility ${name}`);
  return facility;
}

function auditCount() {
  return t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
}

function lastAudit() {
  const row = t.db.select().from(auditLog).orderBy(sql`rowid desc`).limit(1).get()!;
  return { ...row, changes: row.changes ? JSON.parse(row.changes) : null };
}

function snapshot() {
  return JSON.stringify(t.db.all(sql`select * from facilities order by id`));
}

/** The form values for a Facility, with overrides. */
function formOf(name: string, overrides: Record<string, unknown> = {}) {
  const f = byName(name);
  return {
    id: f.id,
    name: f.name,
    prefix: f.nextPrefix ?? f.currentPrefix,
    openDays: f.openDays,
    openTime: f.openTime,
    closeTime: f.closeTime,
    isLive: f.isLive,
    ...overrides,
  };
}

/** Save through the service (already-valid input). */
function save(name: string, overrides: Record<string, unknown>, now = new Date()) {
  return updateFacility(formOf(name, overrides) as never, actor, now, t.db);
}

// 2026-09-28 is a Monday. Manila is UTC+8.
const MANILA = (local: string) => new Date(`${local}+08:00`);

describe("seed migration", () => {
  it("creates the four default Facilities, live, Mon–Sat 07:00–17:00", () => {
    const all = listFacilities(new Date(), t.db);
    expect(all.map((f) => [f.name, f.prefix, f.sortOrder])).toEqual([
      ["Prenatal", "PN", 1],
      ["Animal Bite Center", "AB", 2],
      ["Treatment", "TR", 3],
      ["Consultation", "CN", 4],
    ]);
    for (const f of all) {
      expect(f).toMatchObject({
        openDays: [1, 2, 3, 4, 5, 6],
        openTime: "07:00",
        closeTime: "17:00",
        isLive: true,
        deactivatedAt: null,
        nextPrefix: null,
      });
      expect(f.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(liveFacilities(new Date(), t.db)).toHaveLength(4);
  });
});

describe("isOpen", () => {
  const hours = { openDays: [1, 2, 3, 4, 5, 6], openTime: "07:00", closeTime: "17:00" };

  it.each([
    ["Sunday 10:00", "2026-09-27T10:00:00", false],
    ["Monday 06:59", "2026-09-28T06:59:59", false],
    ["Monday 07:00", "2026-09-28T07:00:00", true],
    ["Monday 16:59", "2026-09-28T16:59:59", true],
    ["Monday 17:00", "2026-09-28T17:00:00", false],
    ["Saturday 12:00", "2026-10-03T12:00:00", true],
  ])("%s Manila → %s", (_label, local, open) => {
    expect(isOpen(hours, MANILA(local))).toBe(open);
  });

  it("uses Manila time, not UTC", () => {
    // Monday 07:00 Manila is Sunday 23:00 UTC.
    expect(isOpen(hours, new Date("2026-09-27T23:00:00Z"))).toBe(true);
    // Saturday 16:00 UTC is Sunday 00:00 in Manila.
    expect(isOpen(hours, new Date("2026-10-03T16:00:00Z"))).toBe(false);
  });
});

describe("updateFacility", () => {
  it("saves hours and Live, drops it from liveFacilities, and audits old and new values once", () => {
    const result = save("Consultation", { openTime: "08:00", closeTime: "16:00", isLive: false });
    expect(result.changed).toBe(true);
    expect(byName("Consultation")).toMatchObject({ openTime: "08:00", closeTime: "16:00", isLive: false });
    expect(liveFacilities(new Date(), t.db).map((f) => f.name)).not.toContain("Consultation");
    expect(auditCount()).toBe(1);
    const row = lastAudit();
    expect(row).toMatchObject({ action: "settings.facility_updated", entity: "facility", actorId: "u-admin" });
    expect(row.entityId).toBe(byName("Consultation").id);
    expect(row.changes).toEqual({
      openTime: { old: "07:00", new: "08:00" },
      closeTime: { old: "17:00", new: "16:00" },
      isLive: { old: true, new: false },
    });
  });

  it("writes nothing when nothing changed", () => {
    expect(save("Prenatal", {}).changed).toBe(false);
    expect(auditCount()).toBe(0);
  });

  it("applies a prefix change from the next Manila day only", () => {
    // Monday 23:59:59 Manila.
    save("Treatment", { prefix: "TX" }, new Date("2026-09-28T15:59:59Z"));
    const treatment = byName("Treatment");
    expect(treatment).toMatchObject({ prefix: "TR", nextPrefix: "TX", nextPrefixFrom: "2026-09-29" });
    expect(auditCount()).toBe(1);
    expect(lastAudit().changes).toEqual({
      nextPrefix: { old: null, new: "TX" },
      nextPrefixFrom: { old: null, new: "2026-09-29" },
    });
    expect(effectivePrefix(treatment, "2026-09-28T15:59:59Z")).toBe("TR");
    expect(effectivePrefix(treatment, "2026-09-28T16:00:00Z")).toBe("TX");
    expect(getFacility(treatment.id, "2026-09-28T16:00:00Z", t.db)?.currentPrefix).toBe("TX");
  });

  it("reports the pending change until its day, then none", () => {
    save("Treatment", { prefix: "TX" }, new Date("2026-09-28T01:00:00Z"));
    const treatment = byName("Treatment");
    expect(pendingPrefix(treatment, "2026-09-28T15:59:59Z")).toEqual({ prefix: "TX", from: "2026-09-29" });
    expect(pendingPrefix(treatment, "2026-09-28T16:00:00Z")).toBeNull();
  });

  it("sets the next OPD day from Manila, not UTC, and changing back cancels it", () => {
    // 16:00Z Monday is already Tuesday in Manila: the change applies Wednesday.
    const now = new Date("2026-09-28T16:00:00Z");
    save("Prenatal", { prefix: "PR" }, now);
    expect(byName("Prenatal")).toMatchObject({ prefix: "PN", nextPrefixFrom: "2026-09-30" });
    save("Prenatal", { prefix: "PN" }, now);
    expect(byName("Prenatal")).toMatchObject({ prefix: "PN", nextPrefix: null, nextPrefixFrom: null });
    expect(auditCount()).toBe(2);
    expect(lastAudit().changes).toEqual({
      nextPrefix: { old: "PR", new: null },
      nextPrefixFrom: { old: "2026-09-30", new: null },
    });
  });

  it("folds a due prefix change into prefix on the next write", () => {
    save("Treatment", { prefix: "TX" }, MANILA("2026-09-28T09:00:00"));
    save("Treatment", { prefix: "TX", closeTime: "16:30" }, MANILA("2026-09-30T09:00:00"));
    expect(byName("Treatment")).toMatchObject({ prefix: "TX", nextPrefix: null, nextPrefixFrom: null });
    expect(lastAudit().changes).toMatchObject({
      prefix: { old: "TR", new: "TX" },
      closeTime: { old: "17:00", new: "16:30" },
    });
  });

  it("rejects a prefix another Facility uses today", () => {
    const before = snapshot();
    expect(() => save("Consultation", { prefix: "AB" })).toThrow(DomainError);
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("rejects a prefix another Facility has pending", () => {
    save("Treatment", { prefix: "TX" });
    const before = snapshot();
    expect(() => save("Consultation", { prefix: "TX" })).toThrow(
      expect.objectContaining({ code: "prefix_taken" }),
    );
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(1);
  });

  it("rejects the prefix of a deactivated Facility", () => {
    deactivateFacility(byName("Animal Bite Center").id, actor, new Date(), t.db);
    expect(() => save("Consultation", { prefix: "AB" })).toThrow(expect.objectContaining({ code: "prefix_taken" }));
    expect(auditCount()).toBe(1);
  });

  it("refuses to edit a deactivated Facility", () => {
    deactivateFacility(byName("Animal Bite Center").id, actor, new Date(), t.db);
    expect(() => save("Animal Bite Center", { closeTime: "16:00" })).toThrow(/Reactivate/);
  });
});

describe("deactivateFacility and reactivateFacility", () => {
  it("each writes one audit row with the old and new values, and never deletes", () => {
    const f = byName("Prenatal");
    deactivateFacility(f.id, actor, new Date("2026-09-28T01:00:00Z"), t.db);
    expect(auditCount()).toBe(1);
    expect(lastAudit()).toMatchObject({
      action: "settings.facility_deactivated",
      entityId: f.id,
      changes: { deactivatedAt: { old: null, new: "2026-09-28T01:00:00.000Z" } },
    });
    expect(liveFacilities(new Date(), t.db).map((x) => x.name)).not.toContain("Prenatal");
    expect(listFacilities(new Date(), t.db)).toHaveLength(4);

    // Deactivating again changes nothing.
    expect(deactivateFacility(f.id, actor, new Date(), t.db).changed).toBe(false);
    expect(auditCount()).toBe(1);

    reactivateFacility(f.id, actor, new Date(), t.db);
    expect(auditCount()).toBe(2);
    expect(lastAudit()).toMatchObject({
      action: "settings.facility_reactivated",
      changes: { deactivatedAt: { old: "2026-09-28T01:00:00.000Z", new: null } },
    });
    expect(byName("Prenatal").deactivatedAt).toBeNull();
  });
});

describe("Facility actions", () => {
  it("shows 'Prefix already in use' on the prefix field and saves nothing", async () => {
    const before = snapshot();
    const result = await updateFacilityAction(formOf("Consultation", { prefix: "ab" }));
    expect(result).toEqual({
      ok: false,
      error: { code: "prefix_taken", message: "Prefix already in use", fieldErrors: { prefix: "Prefix already in use" } },
    });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("rejects invalid hours, days, name and prefix with field errors", async () => {
    const hours = await updateFacilityAction(formOf("Consultation", { openTime: "16:00", closeTime: "08:00" }));
    if (hours.ok) throw new Error("expected failure");
    expect(hours.error.fieldErrors).toEqual({ closeTime: "Closing time must be later than opening time." });

    const fields = await updateFacilityAction(
      formOf("Consultation", { name: "C", prefix: "C1", openDays: [], openTime: "25:00" }),
    );
    if (fields.ok) throw new Error("expected failure");
    expect(Object.keys(fields.error.fieldErrors ?? {}).sort()).toEqual(["name", "openDays", "openTime", "prefix"]);
    expect(auditCount()).toBe(0);
  });

  it("rejects a name another active Facility has, ignoring case", async () => {
    const result = await updateFacilityAction(formOf("Consultation", { name: "treatment" }));
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatchObject({ code: "name_taken", fieldErrors: { name: "Name already in use" } });
  });

  it("maps a unique-index violation (a race past the service check) to name_taken", async () => {
    // Hide the other Facilities from the service's check, as if Treatment
    // was renamed by another request after the check ran.
    const form = formOf("Consultation", { name: "TREATMENT" });
    const before = snapshot();
    vi.mocked(repo.selectAllFacilities).mockImplementationOnce(() => []);
    const result = await updateFacilityAction(form);
    expect(result).toEqual({
      ok: false,
      error: { code: "name_taken", message: "Name already in use", fieldErrors: { name: "Name already in use" } },
    });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("refuses to reactivate a Facility whose name an active one now has", async () => {
    const prenatal = byName("Prenatal");
    await deactivateFacilityAction({ id: prenatal.id });
    await updateFacilityAction(formOf("Consultation", { name: "Prenatal" }));
    const before = snapshot();
    const audits = auditCount();
    const result = await reactivateFacilityAction({ id: prenatal.id });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "name_taken",
        message: "An active Facility is already named Prenatal.",
        fieldErrors: { name: "Name already in use" },
      },
    });
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(audits);
  });

  it("saves for an Admin and revalidates the page", async () => {
    const result = await updateFacilityAction(formOf("Consultation", { name: "  General Consultation " }));
    expect(result).toEqual({ ok: true, data: { changed: true, name: "General Consultation" } });
    expect(stubs.revalidated).toEqual(["/admin/settings"]);
  });

  it("revalidates even when nothing changed", async () => {
    const id = byName("Prenatal").id;
    await deactivateFacilityAction({ id });
    stubs.revalidated.length = 0;
    expect(await deactivateFacilityAction({ id })).toEqual({ ok: true, data: { changed: false, name: "Prenatal" } });
    expect(stubs.revalidated).toEqual(["/admin/settings"]);
  });

  it.each(["triage_nurse", "facility_staff"])("denies %s: nothing changes and no audit row", async (role) => {
    stubs.user.role = role;
    const f = byName("Consultation");
    const before = snapshot();
    for (const result of [
      await updateFacilityAction(formOf("Consultation", { closeTime: "12:00" })),
      await deactivateFacilityAction({ id: f.id }),
      await reactivateFacilityAction({ id: f.id }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });
});
