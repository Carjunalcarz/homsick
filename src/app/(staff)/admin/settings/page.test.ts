import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ role: "admin" }));

vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => ({ id: "u-1", name: "Test User", username: "test.user", role: stubs.role }),
}));
vi.mock("@/server/settings/queries", () => ({
  listFacilities: vi.fn(() => []),
  pendingPrefix: vi.fn(() => null),
  urgencyLevels: vi.fn(() => []),
  priorityCategories: vi.fn(() => []),
  clinicalSchedules: vi.fn(() => []),
  opdThresholds: vi.fn(() => ({
    prenatalTarget: 8,
    noShowThreshold: 3,
    preCloseWarningMinutes: 30,
    hospitalName: "Hospital OPD",
  })),
}));

const queries = await import("@/server/settings/queries");
const { Forbidden, FORBIDDEN_TITLE } = await import("@/components/forbidden");
const { default: SettingsPage, generateMetadata } = await import("./page");

const getters = [
  queries.listFacilities,
  queries.urgencyLevels,
  queries.priorityCategories,
  queries.clinicalSchedules,
  queries.opdThresholds,
] as const;

beforeEach(() => {
  for (const getter of getters) vi.mocked(getter).mockClear();
});

describe("/admin/settings", () => {
  it.each(["triage_nurse", "facility_staff"])("shows %s the no-access page without reading settings", async (role) => {
    stubs.role = role;
    const page = (await SettingsPage()) as ReactElement;
    expect(page.type).toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: FORBIDDEN_TITLE });
    expect(FORBIDDEN_TITLE).toBe("No access");
    for (const getter of getters) expect(getter).not.toHaveBeenCalled();
  });

  it("reads the Facilities and the clinical settings for an Admin", async () => {
    stubs.role = "admin";
    const page = (await SettingsPage()) as ReactElement;
    expect(page.type).not.toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: "Settings" });
    for (const getter of getters) expect(getter).toHaveBeenCalledTimes(1);
  });
});
