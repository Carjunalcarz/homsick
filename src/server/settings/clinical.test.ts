import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { closeDb } from "@/server/db/client";
import { createTestDb, type TestDb } from "@/server/db/test-db";
import { resetEnvForTests } from "@/server/env";

const stubs = vi.hoisted(() => ({
  user: { id: "u-admin", name: "Ana Cruz", username: "ana.cruz", role: "admin" as string },
  revalidated: [] as string[],
}));

vi.mock("@/server/auth/session", () => ({ requireStaff: async () => ({ ...stubs.user }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => stubs.revalidated.push(path) }));

const { urgencyLevels, priorityCategories, enabledPriorityCategories, abcSchedule, clinicalSchedules, opdThresholds } =
  await import("./queries");
const { updateUrgencyLevels, setPriorityCategoryEnabled, updateClinicalSchedule, updateOpdThresholds } = await import(
  "./service"
);
const {
  updateUrgencyLevelsAction,
  setPriorityCategoryEnabledAction,
  updateClinicalScheduleAction,
  updateOpdThresholdsAction,
  updateFacilityAction,
} = await import("./actions");
const { hospitalName, listFacilities } = await import("./queries");

let t: TestDb;
const savedEnv = { DATABASE_PATH: process.env.DATABASE_PATH, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
const actor: Actor = { type: "staff", id: "u-admin", name: "Ana Cruz" };

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

function auditCount() {
  return t.db.get<{ n: number }>(sql`select count(*) as n from audit_log`)!.n;
}

function lastAudit() {
  const row = t.db.select().from(auditLog).orderBy(sql`rowid desc`).limit(1).get()!;
  return { ...row, changes: row.changes ? JSON.parse(row.changes) : null };
}

/** Every clinical settings table, for "nothing changed" checks. */
function snapshot() {
  return JSON.stringify([
    t.db.all(sql`select * from urgency_levels order by id`),
    t.db.all(sql`select * from priority_categories order by id`),
    t.db.all(sql`select * from clinical_schedules order by id`),
    t.db.all(sql`select * from opd_settings`),
  ]);
}

const levels = () => urgencyLevels(t.db);
const level = (name: string) => {
  const found = levels().find((l) => l.name === name);
  if (!found) throw new Error(`no level ${name}`);
  return found;
};
const category = (code: string) => priorityCategories(t.db).find((c) => c.code === code)!;

/** The current active levels as form input. */
function levelsForm() {
  return levels().map(({ id, name, isEr, rank }) => ({ id, name, isEr, rank }));
}

describe("defaults (migration 0006)", () => {
  it("seeds the PRD clinical defaults", () => {
    expect(levels().map((l) => [l.name, l.isEr, l.rank])).toEqual([
      ["Urgent", false, 1],
      ["Routine", false, 2],
      ["Emergency", true, null],
    ]);
    expect(priorityCategories(t.db).map((c) => [c.name, c.legalBasis, c.legallyRequired, c.enabled])).toEqual([
      ["Senior Citizen", "RA 9994", true, true],
      ["PWD", "RA 10754", true, true],
      ["Pregnant", "Hospital policy", false, true],
    ]);
    expect(abcSchedule("new", t.db).days).toEqual([0, 3, 7]);
    expect(abcSchedule("previously_immunized", t.db).days).toEqual([0, 3]);
    expect(opdThresholds(t.db)).toEqual({
      prenatalTarget: 8,
      noShowThreshold: 3,
      preCloseWarningMinutes: 30,
      hospitalName: "Hospital OPD",
    });
    expect(hospitalName(t.db)).toBe("Hospital OPD");
  });
});

describe("updateUrgencyLevels", () => {
  it("renames, adds and re-ranks in one save with one audit row (AC 1)", () => {
    const urgent = level("Urgent");
    const routine = level("Routine");
    const emergency = level("Emergency");
    const result = updateUrgencyLevels(
      {
        levels: [
          { id: emergency.id, name: "Emergency", isEr: true, rank: null },
          { id: urgent.id, name: "Urgent", isEr: false, rank: 1 },
          { name: "Semi-urgent", isEr: false, rank: 2 },
          { id: routine.id, name: "Non-urgent", isEr: false, rank: 3 },
        ],
      },
      actor,
      new Date(),
      t.db,
    );
    expect(result.changed).toBe(true);
    expect(levels().map((l) => l.name)).toEqual(["Urgent", "Semi-urgent", "Non-urgent", "Emergency"]);
    // Ids are stable.
    expect(level("Non-urgent").id).toBe(routine.id);
    expect(auditCount()).toBe(1);
    const row = lastAudit();
    expect(row).toMatchObject({ action: "settings.urgency_levels_updated", entity: "urgency_levels" });
    expect(row.changes.levels.old.map((l: { name: string }) => l.name)).toEqual(["Urgent", "Routine", "Emergency"]);
    expect(row.changes.levels.new.map((l: { name: string }) => l.name)).toEqual([
      "Urgent",
      "Semi-urgent",
      "Non-urgent",
      "Emergency",
    ]);
  });

  it("swaps ranks and names between levels", () => {
    const urgent = level("Urgent");
    const routine = level("Routine");
    updateUrgencyLevels(
      {
        levels: [
          { id: urgent.id, name: "Routine", isEr: false, rank: 2 },
          { id: routine.id, name: "Urgent", isEr: false, rank: 1 },
          { id: level("Emergency").id, name: "Emergency", isEr: true, rank: null },
        ],
      },
      actor,
      new Date(),
      t.db,
    );
    expect(level("Urgent").id).toBe(routine.id);
    expect(level("Routine")).toMatchObject({ id: urgent.id, rank: 2 });
  });

  it("removes a level softly and a removed name can be used again", () => {
    const routine = level("Routine");
    updateUrgencyLevels(
      { levels: levelsForm().filter((l) => l.name !== "Routine") },
      actor,
      new Date("2026-09-28T01:00:00Z"),
      t.db,
    );
    expect(levels().map((l) => l.name)).toEqual(["Urgent", "Emergency"]);
    const stored = t.db.get<{ deactivated_at: string; name: string; rank: number }>(
      sql`select * from urgency_levels where id = ${routine.id}`,
    );
    expect(stored).toMatchObject({ name: "Routine", rank: 2, deactivated_at: "2026-09-28T01:00:00.000Z" });

    updateUrgencyLevels({ levels: [...levelsForm(), { name: "routine", isEr: false, rank: 2 }] }, actor, new Date(), t.db);
    expect(level("routine").id).not.toBe(routine.id);
  });

  it("writes nothing when nothing changed", () => {
    const before = snapshot();
    expect(updateUrgencyLevels({ levels: levelsForm() }, actor, new Date(), t.db).changed).toBe(false);
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("refuses a list where every level is ER", () => {
    const before = snapshot();
    const all = levelsForm().map((l) => ({ ...l, isEr: true, rank: null }));
    expect(() => updateUrgencyLevels({ levels: all }, actor, new Date(), t.db)).toThrow(
      expect.objectContaining({ code: "no_non_er_level", message: "Keep at least one level that isn't ER." }),
    );
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("refuses a rank clash, naming the second row", () => {
    const form = [...levelsForm(), { name: "Semi-urgent", isEr: false, rank: 2 }];
    expect(() => updateUrgencyLevels({ levels: form }, actor, new Date(), t.db)).toThrow(
      expect.objectContaining({ code: "rank_taken", fieldErrors: { "levels.3.rank": "Rank already used" } }),
    );
    expect(auditCount()).toBe(0);
  });

  it("refuses a duplicate name, ignoring case", () => {
    const form = [...levelsForm(), { name: "URGENT", isEr: false, rank: 5 }];
    expect(() => updateUrgencyLevels({ levels: form }, actor, new Date(), t.db)).toThrow(
      expect.objectContaining({ code: "name_taken", fieldErrors: { "levels.3.name": "Name already used" } }),
    );
  });

  it("switches existing levels between ER and ranked in one save", () => {
    const urgent = level("Urgent");
    const emergency = level("Emergency");
    updateUrgencyLevels(
      {
        levels: [
          { id: urgent.id, name: "Urgent", isEr: true, rank: null },
          { id: emergency.id, name: "Emergency", isEr: false, rank: 1 },
          { id: level("Routine").id, name: "Routine", isEr: false, rank: 2 },
        ],
      },
      actor,
      new Date(),
      t.db,
    );
    const stored = (id: string) =>
      t.db.get<{ is_er: number; rank: number | null }>(sql`select is_er, rank from urgency_levels where id = ${id}`);
    expect(stored(urgent.id)).toEqual({ is_er: 1, rank: null });
    expect(stored(emergency.id)).toEqual({ is_er: 0, rank: 1 });
    expect(levels().map((l) => l.name)).toEqual(["Emergency", "Routine", "Urgent"]);
    expect(auditCount()).toBe(1);
  });

  it("refuses an unknown or removed level id", () => {
    const form = levelsForm().map((l, i) => (i === 0 ? { ...l, id: "nope" } : l));
    expect(() => updateUrgencyLevels({ levels: form }, actor, new Date(), t.db)).toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});

describe("setPriorityCategoryEnabled", () => {
  it("refuses to turn off a legally required category without confirmation", () => {
    const before = snapshot();
    expect(() =>
      setPriorityCategoryEnabled({ id: category("pwd").id, enabled: false }, actor, new Date(), t.db),
    ).toThrow(
      expect.objectContaining({ code: "confirmation_required", message: "Legally required (RA 9994 / RA 10754)" }),
    );
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("turns off a legally required category when confirmed", () => {
    const senior = category("senior_citizen");
    const result = setPriorityCategoryEnabled({ id: senior.id, enabled: false, confirmLegal: true }, actor, new Date(), t.db);
    expect(result).toMatchObject({ changed: true, category: { enabled: false } });
    expect(auditCount()).toBe(1);
    expect(lastAudit()).toMatchObject({
      action: "settings.priority_category_updated",
      entity: "priority_category",
      entityId: senior.id,
      changes: { enabled: { old: true, new: false } },
    });
    expect(enabledPriorityCategories(t.db).map((c) => c.code)).toEqual(["pwd", "pregnant"]);
  });

  it("turns Pregnant off and on without confirmation", () => {
    const pregnant = category("pregnant");
    setPriorityCategoryEnabled({ id: pregnant.id, enabled: false }, actor, new Date(), t.db);
    expect(category("pregnant").enabled).toBe(false);
    setPriorityCategoryEnabled({ id: pregnant.id, enabled: true }, actor, new Date(), t.db);
    expect(category("pregnant").enabled).toBe(true);
    expect(auditCount()).toBe(2);
  });

  it("writes nothing when nothing changed", () => {
    expect(setPriorityCategoryEnabled({ id: category("pwd").id, enabled: true }, actor, new Date(), t.db).changed).toBe(
      false,
    );
    expect(auditCount()).toBe(0);
  });

  it("refuses an unknown category", () => {
    expect(() => setPriorityCategoryEnabled({ id: "nope", enabled: false }, actor, new Date(), t.db)).toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});

describe("updateClinicalSchedule and updateOpdThresholds", () => {
  it("saves a schedule with one audit row, and nothing when unchanged", () => {
    const schedule = abcSchedule("new", t.db);
    expect(updateClinicalSchedule({ id: schedule.id, days: [0, 3, 7] }, actor, new Date(), t.db).changed).toBe(false);
    expect(auditCount()).toBe(0);
    updateClinicalSchedule({ id: schedule.id, days: [0, 3, 7, 14, 28] }, actor, new Date(), t.db);
    expect(abcSchedule("new", t.db).days).toEqual([0, 3, 7, 14, 28]);
    expect(auditCount()).toBe(1);
    expect(lastAudit()).toMatchObject({
      action: "settings.schedule_updated",
      entity: "clinical_schedule",
      entityId: schedule.id,
      changes: { days: { old: [0, 3, 7], new: [0, 3, 7, 14, 28] } },
    });
  });

  it("saves thresholds with only the changed values audited", () => {
    const input = { prenatalTarget: 8, noShowThreshold: 2, preCloseWarningMinutes: 0 };
    updateOpdThresholds(input, actor, new Date(), t.db);
    // Left out, the hospital name is kept.
    expect(opdThresholds(t.db)).toEqual({ ...input, hospitalName: "Hospital OPD" });
    expect(auditCount()).toBe(1);
    expect(lastAudit()).toMatchObject({
      action: "settings.opd_thresholds_updated",
      entity: "opd_settings",
      changes: { noShowThreshold: { old: 3, new: 2 }, preCloseWarningMinutes: { old: 30, new: 0 } },
    });
    expect(updateOpdThresholds(input, actor, new Date(), t.db).changed).toBe(false);
    expect(auditCount()).toBe(1);
  });
});

describe("clinical settings actions", () => {
  it("maps a rank clash to the second rank row's field", async () => {
    const result = await updateUrgencyLevelsAction({
      levels: [...levelsForm(), { name: "Semi-urgent", isEr: false, rank: "2" }],
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "rank_taken", message: "Rank already used", fieldErrors: { "levels.3.rank": "Rank already used" } },
    });
  });

  it("returns the all-ER refusal as a form error", async () => {
    const result = await updateUrgencyLevelsAction({
      levels: levelsForm().map((l) => ({ ...l, isEr: true, rank: null })),
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "no_non_er_level", message: "Keep at least one level that isn't ER." },
    });
  });

  it("validates level names and ranks with nested field keys", async () => {
    const result = await updateUrgencyLevelsAction({
      levels: [...levelsForm(), { name: "X", isEr: false, rank: 3 }, { name: "Later", isEr: false, rank: "" }],
    });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.fieldErrors).toEqual({
      "levels.3.name": "Name must be 2–30 characters.",
      "levels.4.rank": "Enter a rank from 1 to 99.",
    });
  });

  it("refuses a list naming the same level twice", async () => {
    const form = levelsForm();
    const result = await updateUrgencyLevelsAction({ levels: [...form, { ...form[0], name: "Copy", rank: 9 }] });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { form: "A level appears twice. Reload the page and try again." } },
    });
    expect(auditCount()).toBe(0);
  });

  it("refuses more than 20 levels", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `Level ${i + 1}`, isEr: false, rank: i + 1 }));
    const before = snapshot();
    const result = await updateUrgencyLevelsAction({ levels: many });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid", fieldErrors: { levels: "Keep 20 levels or fewer." } },
    });
    expect(snapshot()).toBe(before);
  });

  it("returns 'failed' for an unexpected error, logging only its name and message", async () => {
    t.db.$client.exec(
      "create trigger opd_settings_boom before update on opd_settings begin select raise(abort, 'disk trouble'); end",
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await updateOpdThresholdsAction({ prenatalTarget: 9, noShowThreshold: 3, preCloseWarningMinutes: 30 });
      expect(result).toEqual({ ok: false, error: { code: "failed", message: "Couldn't save the change. Try again." } });
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toMatch(/disk trouble/);
      expect(JSON.stringify(log.mock.calls)).not.toContain("prenatalTarget");
    } finally {
      log.mockRestore();
    }
    expect(auditCount()).toBe(0);
  });

  it("drops a rank typed for an ER level", async () => {
    const form = levelsForm().map((l) => (l.isEr ? { ...l, rank: 7 } : l));
    expect(await updateUrgencyLevelsAction({ levels: form })).toEqual({ ok: true, data: { changed: false } });
  });

  it("returns confirmation_required without confirmLegal, and saves with it (AC 2)", async () => {
    const pwd = category("pwd");
    expect(await setPriorityCategoryEnabledAction({ id: pwd.id, enabled: false })).toEqual({
      ok: false,
      error: { code: "confirmation_required", message: "Legally required (RA 9994 / RA 10754)" },
    });
    expect(auditCount()).toBe(0);
    expect(await setPriorityCategoryEnabledAction({ id: pwd.id, enabled: false, confirmLegal: true })).toEqual({
      ok: true,
      data: { changed: true },
    });
    expect(category("pwd").enabled).toBe(false);
    expect(enabledPriorityCategories(t.db).map((c) => c.name)).not.toContain("PWD");
    expect(stubs.revalidated).toEqual(["/admin/settings"]);
  });

  it.each([
    ["3, 7", "Start at Day 0, then later days in order."],
    ["0, 7, 3", "Start at Day 0, then later days in order."],
    ["0, 0", "Start at Day 0, then later days in order."],
    ["0", "Enter 2 to 10 dose days."],
    ["0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10", "Enter 2 to 10 dose days."],
    ["0, 3, 91", "Enter whole days from 0 to 90, separated by commas."],
    ["0, 3.5", "Enter whole days from 0 to 90, separated by commas."],
    ["0, x", "Enter whole days from 0 to 90, separated by commas."],
  ])("refuses the schedule %j", async (days, message) => {
    const before = snapshot();
    const result = await updateClinicalScheduleAction({ id: abcSchedule("new", t.db).id, days });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid", fieldErrors: { days: message } } });
    expect(snapshot()).toBe(before);
  });

  it("saves a comma-separated schedule", async () => {
    const id = abcSchedule("previously_immunized", t.db).id;
    expect(await updateClinicalScheduleAction({ id, days: " 0, 3 ,7 " })).toEqual({ ok: true, data: { changed: true } });
    expect(clinicalSchedules(t.db).find((s) => s.id === id)?.days).toEqual([0, 3, 7]);
  });

  it.each([
    [{ prenatalTarget: 0 }, "prenatalTarget"],
    [{ prenatalTarget: 21 }, "prenatalTarget"],
    [{ noShowThreshold: 0 }, "noShowThreshold"],
    [{ noShowThreshold: 11 }, "noShowThreshold"],
    [{ preCloseWarningMinutes: -1 }, "preCloseWarningMinutes"],
    [{ preCloseWarningMinutes: 121 }, "preCloseWarningMinutes"],
    [{ preCloseWarningMinutes: "" }, "preCloseWarningMinutes"],
    [{ noShowThreshold: 2.5 }, "noShowThreshold"],
    [{ preCloseWarningMinutes: "  " }, "preCloseWarningMinutes"],
    [{ prenatalTarget: "0x10" }, "prenatalTarget"],
    [{ prenatalTarget: "1e1" }, "prenatalTarget"],
    [{ noShowThreshold: "+5" }, "noShowThreshold"],
  ])("refuses thresholds %j", async (override, field) => {
    const result = await updateOpdThresholdsAction({
      prenatalTarget: 8,
      noShowThreshold: 3,
      preCloseWarningMinutes: 30,
      ...override,
    });
    if (result.ok) throw new Error("expected failure");
    expect(Object.keys(result.error.fieldErrors ?? {})).toEqual([field]);
    expect(auditCount()).toBe(0);
  });

  it("accepts thresholds at their limits, as form strings", async () => {
    expect(
      await updateOpdThresholdsAction({ prenatalTarget: "20", noShowThreshold: "1", preCloseWarningMinutes: "0" }),
    ).toEqual({ ok: true, data: { changed: true } });
    expect(opdThresholds(t.db)).toEqual({
      prenatalTarget: 20,
      noShowThreshold: 1,
      preCloseWarningMinutes: 0,
      hospitalName: "Hospital OPD",
    });
  });

  describe("hospital name (printed on slips, Story 3.6)", () => {
    const THRESHOLDS = { prenatalTarget: 8, noShowThreshold: 3, preCloseWarningMinutes: 30 };

    it("saves a new name with one audit row of old and new; the getter returns it", async () => {
      expect(
        await updateOpdThresholdsAction({ ...THRESHOLDS, hospitalName: "  Ospital   ng Maynila " }),
      ).toEqual({ ok: true, data: { changed: true } });
      expect(hospitalName(t.db)).toBe("Ospital ng Maynila");
      expect(auditCount()).toBe(1);
      expect(lastAudit()).toMatchObject({
        action: "settings.opd_thresholds_updated",
        entity: "opd_settings",
        changes: { hospitalName: { old: "Hospital OPD", new: "Ospital ng Maynila" } },
      });
      // The same name again changes nothing and writes no row.
      expect(await updateOpdThresholdsAction({ ...THRESHOLDS, hospitalName: "Ospital ng Maynila" })).toEqual({
        ok: true,
        data: { changed: false },
      });
      expect(auditCount()).toBe(1);
    });

    it.each([
      ["", "blank"],
      ["   ", "only spaces"],
      ["H", "one character"],
      ["x".repeat(81), "81 characters"],
      [42, "not text"],
    ] as [unknown, string][])("refuses %j (%s) as a field error", async (value) => {
      const before = snapshot();
      const result = await updateOpdThresholdsAction({ ...THRESHOLDS, hospitalName: value });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid", fieldErrors: { hospitalName: "Hospital name must be 2–80 characters." } },
      });
      expect(snapshot()).toBe(before);
      expect(auditCount()).toBe(0);
    });

    it("accepts 2 and 80 characters", async () => {
      expect(await updateOpdThresholdsAction({ ...THRESHOLDS, hospitalName: "HM" })).toMatchObject({ ok: true });
      expect(await updateOpdThresholdsAction({ ...THRESHOLDS, hospitalName: "y".repeat(80) })).toMatchObject({ ok: true });
      expect(hospitalName(t.db)).toBe("y".repeat(80));
    });

    it("is refused for a Triage Nurse", async () => {
      stubs.user.role = "triage_nurse";
      expect(await updateOpdThresholdsAction({ ...THRESHOLDS, hospitalName: "Ospital ng Maynila" })).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(hospitalName(t.db)).toBe("Hospital OPD");
    });
  });

  it.each(["triage_nurse", "facility_staff"])("denies %s every clinical action: nothing changes (AC 3)", async (role) => {
    stubs.user.role = role;
    const before = snapshot();
    for (const result of [
      await updateUrgencyLevelsAction({ levels: [...levelsForm(), { name: "Semi-urgent", isEr: false, rank: 3 }] }),
      await setPriorityCategoryEnabledAction({ id: category("pwd").id, enabled: false, confirmLegal: true }),
      await updateClinicalScheduleAction({ id: abcSchedule("new", t.db).id, days: "0, 3, 7, 14" }),
      await updateOpdThresholdsAction({ prenatalTarget: 9, noShowThreshold: 3, preCloseWarningMinutes: 30 }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    expect(snapshot()).toBe(before);
    expect(auditCount()).toBe(0);
  });

  it("leaves the Facility section working", async () => {
    const consultation = listFacilities(new Date(), t.db).find((f) => f.name === "Consultation")!;
    const result = await updateFacilityAction({
      id: consultation.id,
      name: "Consultation",
      prefix: "CN",
      openDays: consultation.openDays,
      openTime: "08:00",
      closeTime: "16:00",
      isLive: true,
    });
    expect(result).toEqual({ ok: true, data: { changed: true, name: "Consultation" } });
    expect(lastAudit().action).toBe("settings.facility_updated");
  });
});
