import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  class RedirectSignal extends Error {}
  return { RedirectSignal, role: "facility_staff" as string | null };
});

vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => {
    if (!stubs.role) throw new stubs.RedirectSignal("/sign-in?next=%2Fpatients");
    return { id: "u-1", name: "Joy Santos", username: "joy.santos", role: stubs.role, facilityIds: [] };
  },
}));
vi.mock("@/server/patients/queries", () => ({
  searchPatients: vi.fn(() => ({
    rows: [
      {
        id: "p-1",
        hospitalNumber: "HN-2026-000001",
        name: "DELA CRUZ, Juan Santos",
        sex: "male",
        birthdate: "1985-04-12",
        age: 41,
        addressBarangay: "Poblacion",
        addressMunicipality: "San Jose",
        lastVisit: null,
      },
    ],
    total: 30,
    page: 2,
    pageCount: 2,
    pageSize: 25,
  })),
}));

const { searchPatients } = await import("@/server/patients/queries");
const { Forbidden, FORBIDDEN_TITLE } = await import("@/components/forbidden");
const { default: PatientsPage, generateMetadata } = await import("./page");

beforeEach(() => {
  vi.mocked(searchPatients).mockClear();
});

describe("/patients", () => {
  it.each(["admin", "triage_nurse", "facility_staff"])("lists patients from the URL for %s", async (role) => {
    stubs.role = role;
    const page = (await PatientsPage({
      searchParams: Promise.resolve({ q: " cruz ", page: "2" }),
    })) as ReactElement<Record<string, unknown>>;
    expect(await generateMetadata()).toEqual({ title: "Patients" });
    expect(vi.mocked(searchPatients).mock.calls[0]?.[0]).toEqual({ q: "cruz", page: 2, pageSize: 25 });
    expect(page.props).toMatchObject({
      q: "cruz",
      total: 30,
      page: 2,
      pageCount: 2,
      rows: [
        {
          id: "p-1",
          name: "DELA CRUZ, Juan Santos",
          hospitalNumber: "HN-2026-000001",
          age: 41,
          sex: "male",
          birthdate: "1985-04-12",
          lastVisit: null,
        },
      ],
    });
    // No contact or address data goes to the list.
    expect(Object.keys((page.props.rows as object[])[0]!)).not.toContain("addressBarangay");
  });

  it("falls back to page 1 for a bad page", async () => {
    stubs.role = "triage_nurse";
    await PatientsPage({ searchParams: Promise.resolve({ page: "abc" }) });
    expect(vi.mocked(searchPatients).mock.calls[0]?.[0]).toEqual({ q: "", page: 1, pageSize: 25 });
  });

  it("shows a Role outside patients.view the no-access page without searching", async () => {
    stubs.role = "superuser";
    const page = (await PatientsPage({ searchParams: Promise.resolve({ q: "cruz" }) })) as ReactElement;
    expect(page.type).toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: FORBIDDEN_TITLE });
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign-in without searching", async () => {
    stubs.role = null;
    await expect(PatientsPage({ searchParams: Promise.resolve({ q: "cruz" }) })).rejects.toBeInstanceOf(
      stubs.RedirectSignal,
    );
    expect(searchPatients).not.toHaveBeenCalled();
  });
});
