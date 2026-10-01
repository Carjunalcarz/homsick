import { describe, expect, it, vi } from "vitest";

// The map needs no request; only requirePermission reads the session.
vi.mock("@/server/auth/session", () => ({ requireStaff: vi.fn() }));

const { allowedAdminNav, allowedNav } = await import("./nav-permissions");
const { ADMIN_NAV } = await import("./nav-items");

describe("allowedNav", () => {
  it("gives a Triage Nurse Triage but not Queues", () => {
    const hrefs = allowedNav({ role: "triage_nurse" });
    expect(hrefs).toContain("/triage");
    expect(hrefs).not.toContain("/queues");
    expect(hrefs).toEqual(["/", "/triage", "/patients", "/appointments", "/directory"]);
  });

  it("gives Facility Staff Queues but not Triage", () => {
    const hrefs = allowedNav({ role: "facility_staff", facilityIds: ["f-1"] });
    expect(hrefs).toContain("/queues");
    expect(hrefs).not.toContain("/triage");
    expect(hrefs).toEqual(["/", "/queues", "/patients", "/appointments", "/directory"]);
  });

  it("gives an Admin every item", () => {
    expect(allowedNav({ role: "admin" })).toEqual([
      "/",
      "/triage",
      "/queues",
      "/patients",
      "/appointments",
      "/directory",
    ]);
  });

  it("gives an unknown Role nothing", () => {
    expect(allowedNav({ role: "superuser" })).toEqual([]);
  });
});

describe("allowedAdminNav", () => {
  it.each(["triage_nurse", "facility_staff", "superuser"])("gives %s no Admin pages", (role) => {
    expect(allowedAdminNav({ role })).toEqual([]);
  });

  it("gives an Admin Staff, Settings and the audit log", () => {
    expect(allowedAdminNav({ role: "admin" })).toEqual(["/admin/staff", "/admin/settings", "/admin/audit"]);
  });

  it("never prefetches the audit log (each render records a view)", () => {
    const audit = ADMIN_NAV.find((item) => item.href === "/admin/audit");
    expect(audit).toMatchObject({ action: "audit.view", name: "Admin: Audit log", menuLabel: "Audit log", prefetch: false });
  });
});
