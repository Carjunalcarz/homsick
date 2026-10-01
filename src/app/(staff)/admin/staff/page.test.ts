import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ role: "admin" }));

vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => ({ id: "u-1", name: "Test User", username: "test.user", role: stubs.role, facilityIds: [] }),
}));
vi.mock("@/server/auth/staff-queries", () => ({
  STAFF_STATUSES: ["active", "locked", "deactivated"],
  listStaff: vi.fn(() => ({ rows: [], total: 0, page: 1, pageCount: 1, pageSize: 25 })),
}));
vi.mock("@/server/settings/queries", () => ({ listFacilities: vi.fn(() => []) }));

const { listStaff } = await import("@/server/auth/staff-queries");
const { listFacilities } = await import("@/server/settings/queries");
const { Forbidden, FORBIDDEN_TITLE } = await import("@/components/forbidden");
const { default: StaffPage, generateMetadata } = await import("./page");

beforeEach(() => {
  vi.mocked(listStaff).mockClear();
  vi.mocked(listFacilities).mockClear();
});

describe("/admin/staff", () => {
  it.each(["triage_nurse", "facility_staff"])("shows %s the no-access page without reading staff", async (role) => {
    stubs.role = role;
    const page = (await StaffPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(page.type).toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: FORBIDDEN_TITLE });
    expect(listStaff).not.toHaveBeenCalled();
    expect(listFacilities).not.toHaveBeenCalled();
  });

  it("reads the list from the URL for an Admin", async () => {
    stubs.role = "admin";
    const page = (await StaffPage({
      searchParams: Promise.resolve({ q: " joy ", role: "facility_staff", status: "bogus", page: "2" }),
    })) as ReactElement;
    expect(page.type).not.toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: "Staff" });
    expect(vi.mocked(listStaff).mock.calls[0]?.[0]).toEqual({
      q: "joy",
      role: "facility_staff",
      status: "all",
      page: 2,
      pageSize: 25,
    });
  });
});
