import { describe, expect, it, vi } from "vitest";

// requirePermission reads the session; the map itself needs no request.
vi.mock("./session", () => ({ requireStaff: vi.fn() }));

const { can, PERMISSIONS, ruleAllows } = await import("./permissions");
type Action = import("./permissions").Action;

const ROLES = ["admin", "triage_nurse", "facility_staff"] as const;

/** Every action in the map, with the Roles expected to have it. */
const EXPECTED: Record<Action, readonly string[]> = {
  "settings.view": ["admin"],
  "settings.facilities.manage": ["admin"],
  "settings.clinical.manage": ["admin"],
  "staff.view": ["admin"],
  "staff.manage": ["admin"],
  "audit.view": ["admin"],
  "patients.view": ["admin", "triage_nurse", "facility_staff"],
  "patients.register": ["admin", "triage_nurse"],
  "patients.edit": ["admin", "triage_nurse"],
  "triage.view": ["admin", "triage_nurse"],
  "triage.record": ["admin", "triage_nurse"],
  "nav.overview": ["admin", "triage_nurse", "facility_staff"],
  "nav.triage": ["admin", "triage_nurse"],
  "nav.queues": ["admin", "facility_staff"],
  "nav.patients": ["admin", "triage_nurse", "facility_staff"],
  "nav.appointments": ["admin", "triage_nurse", "facility_staff"],
  "nav.directory": ["admin", "triage_nurse", "facility_staff"],
};

/** Actions about one Facility; none yet (queue actions arrive in Epic 4). */
const FACILITY_SCOPED: readonly Action[] = [];

describe("PERMISSIONS", () => {
  it("lists exactly the actions under test", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("declares the expected Facility scope for each action", () => {
    for (const action of Object.keys(EXPECTED) as Action[]) {
      expect(PERMISSIONS[action].scope).toBe(FACILITY_SCOPED.includes(action) ? "facility" : "none");
    }
  });

  for (const action of Object.keys(EXPECTED) as Action[]) {
    for (const role of ROLES) {
      const allowed = EXPECTED[action].includes(role);
      it(`${allowed ? "allows" : "denies"} ${role} → ${action}`, () => {
        expect(can({ role }, action)).toBe(allowed);
      });
    }
  }
});

describe("can", () => {
  it("denies an unknown action by default", () => {
    expect(can({ role: "admin" }, "settings.delete_everything" as Action)).toBe(false);
    expect(can({ role: "admin" }, "toString" as Action)).toBe(false);
  });

  it("denies an unknown Role and no user", () => {
    expect(can({ role: "superuser" }, "settings.view")).toBe(false);
    expect(can({ role: "" }, "settings.view")).toBe(false);
    expect(can(null, "settings.view")).toBe(false);
    expect(can(undefined, "settings.view")).toBe(false);
  });
});

describe("Facility scope", () => {
  const rule = { roles: ["admin", "facility_staff"], scope: "facility" } as const;

  it("needs a Facility to be named", () => {
    expect(ruleAllows(rule, { role: "admin" })).toBe(false);
  });

  it("lets an Admin act on any Facility", () => {
    expect(ruleAllows(rule, { role: "admin" }, "f-1")).toBe(true);
  });

  it("limits other Roles to their assigned Facilities", () => {
    expect(ruleAllows(rule, { role: "facility_staff", facilityIds: ["f-1"] }, "f-1")).toBe(true);
    expect(ruleAllows(rule, { role: "facility_staff", facilityIds: ["f-1"] }, "f-2")).toBe(false);
    expect(ruleAllows(rule, { role: "facility_staff" }, "f-1")).toBe(false);
  });

  it("still requires the Role", () => {
    expect(ruleAllows(rule, { role: "triage_nurse", facilityIds: ["f-1"] }, "f-1")).toBe(false);
  });
});
