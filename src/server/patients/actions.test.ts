import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return { RedirectSignal, user: null as null | { id: string; name: string; username: string; role: string; facilityIds: string[] } };
});

// requireStaff() redirects to sign-in when nobody is signed in.
vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => {
    if (!stubs.user) throw new stubs.RedirectSignal("/sign-in?next=%2Ftriage");
    return stubs.user;
  },
}));
vi.mock("./queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queries")>()),
  searchPatients: vi.fn(() => ({ rows: [{ id: "p-1", hospitalNumber: "HN-2026-000001", lastName: "Cruz", firstName: "Jose", middleName: null, suffix: null, name: "CRUZ, Jose", sex: "male", birthdate: "1978-02-14", age: 48, lastVisit: null, addressBarangay: "Poblacion", addressMunicipality: "San Jose", contactNumber: "09175550101" }], total: 12, page: 1, pageCount: 2, pageSize: 8 })),
}));

const { searchPatients } = await import("./queries");
const { searchPatientsAction } = await import("./actions");

beforeEach(() => {
  vi.mocked(searchPatients).mockClear();
  stubs.user = null;
});

describe("searchPatientsAction", () => {
  it("rejects an unauthenticated call without searching", async () => {
    await expect(searchPatientsAction({ q: "cruz" })).rejects.toBeInstanceOf(stubs.RedirectSignal);
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it("rejects an unknown Role without searching", async () => {
    stubs.user = { id: "u-1", name: "X", username: "x", role: "superuser", facilityIds: [] };
    const result = await searchPatientsAction({ q: "cruz" });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it("validates before identifying", async () => {
    const result = await searchPatientsAction({ q: 42 });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it.each(["admin", "triage_nurse", "facility_staff"])("searches for %s, at most 8 results", async (role) => {
    stubs.user = { id: "u-1", name: "Joy Santos", username: "joy.santos", role, facilityIds: [] };
    const result = await searchPatientsAction({ q: "  cruz " });
    expect(result).toStrictEqual({ ok: true, data: { q: "cruz", rows: [{ id: "p-1", hospitalNumber: "HN-2026-000001", lastName: "Cruz", firstName: "Jose", middleName: null, suffix: null, name: "CRUZ, Jose", sex: "male", birthdate: "1978-02-14", age: 48, lastVisit: null }], total: 12 } });
    expect(vi.mocked(searchPatients).mock.calls[0]?.[0]).toEqual({ q: "cruz", page: 1, pageSize: 8 });
  });

  it("cuts an over-long query instead of rejecting it", async () => {
    stubs.user = { id: "u-1", name: "Joy Santos", username: "joy.santos", role: "triage_nurse", facilityIds: [] };
    const result = await searchPatientsAction({ q: "cruz" + "x".repeat(2000) });
    expect(result.ok).toBe(true);
    expect(vi.mocked(searchPatients).mock.calls[0]?.[0]?.q).toHaveLength(100);
  });

  it("returns nothing for an empty query without searching", async () => {
    stubs.user = { id: "u-1", name: "Joy Santos", username: "joy.santos", role: "triage_nurse", facilityIds: [] };
    expect(await searchPatientsAction({ q: "   " })).toEqual({ ok: true, data: { q: "", rows: [], total: 0 } });
    expect(searchPatients).not.toHaveBeenCalled();
  });
});
