import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ role: "admin" }));

vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => ({ id: "u-1", name: "Joy Santos", username: "joy.santos", role: stubs.role, facilityIds: [] }),
}));

const { Forbidden, FORBIDDEN_TITLE } = await import("@/components/forbidden");
const { default: TriagePage, generateMetadata } = await import("./page");

describe("/triage", () => {
  it.each(["admin", "triage_nurse"])("shows %s the Patient finder", async (role) => {
    stubs.role = role;
    const page = (await TriagePage()) as ReactElement;
    expect(page.type).not.toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: "Triage" });
    // The workspace gets the "New patient" row (patients.register).
    const children = (page.props as { children: ReactElement[] }).children;
    const workspace = children.find((child) => (child?.props as { canRegister?: boolean })?.canRegister !== undefined);
    expect((workspace?.props as { canRegister: boolean }).canRegister).toBe(true);
  });

  it("shows Facility Staff the no-access page", async () => {
    stubs.role = "facility_staff";
    const page = (await TriagePage()) as ReactElement;
    expect(page.type).toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: FORBIDDEN_TITLE });
  });
});
