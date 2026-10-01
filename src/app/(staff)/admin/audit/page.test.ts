import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ role: "admin" }));

vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => ({ id: "u-1", name: "Ana Cruz", username: "ana.cruz", role: stubs.role, facilityIds: [] }),
}));
vi.mock("@/server/audit/queries", () => ({
  listAudit: vi.fn(() => ({ rows: [], total: 0, page: 1, pageCount: 1, pageSize: 25 })),
}));
vi.mock("@/server/audit/views", () => ({ recordAuditView: vi.fn() }));

const { listAudit } = await import("@/server/audit/queries");
const { recordAuditView } = await import("@/server/audit/views");
const { Forbidden, FORBIDDEN_TITLE } = await import("@/components/forbidden");
const { default: AuditPage, generateMetadata } = await import("./page");

beforeEach(() => {
  vi.mocked(listAudit).mockClear();
  vi.mocked(recordAuditView).mockClear();
});

describe("/admin/audit", () => {
  it.each(["triage_nurse", "facility_staff"])(
    "shows %s the no-access page without reading rows or recording a view",
    async (role) => {
      stubs.role = role;
      const page = (await AuditPage({ searchParams: Promise.resolve({}) })) as ReactElement;
      expect(page.type).toBe(Forbidden);
      expect(await generateMetadata()).toEqual({ title: FORBIDDEN_TITLE });
      expect(listAudit).not.toHaveBeenCalled();
      expect(recordAuditView).not.toHaveBeenCalled();
    },
  );

  it("records the view, then reads the list from the URL, for an Admin", async () => {
    stubs.role = "admin";
    const page = (await AuditPage({
      searchParams: Promise.resolve({
        q: " joy ",
        action: "staff.created",
        entity: "user",
        from: "2026-09-28",
        to: "2026-09-26",
        page: "2",
      }),
    })) as ReactElement;
    expect(page.type).not.toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: "Audit log" });
    expect(recordAuditView).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuditView).mock.calls[0]).toEqual([
      { type: "staff", id: "u-1", name: "Ana Cruz" },
      { q: "joy", action: "staff.created", entity: "user", from: "2026-09-26", to: "2026-09-28", requestedPage: 2 },
    ]);
    expect(vi.mocked(listAudit).mock.calls[0]?.[0]).toEqual({
      q: "joy",
      action: "staff.created",
      entity: "user",
      from: "2026-09-26",
      to: "2026-09-28",
      page: 2,
      pageSize: 25,
    });
    // The view row is written before the list is read, so it is in the list.
    expect(vi.mocked(recordAuditView).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(listAudit).mock.invocationCallOrder[0]!,
    );
  });

  it("maps rows for the screen and passes the filters through", async () => {
    stubs.role = "admin";
    vi.mocked(listAudit).mockReturnValueOnce({
      rows: [
        {
          id: "r-1",
          at: "2026-09-27T16:00:05.000Z",
          actorType: "system",
          actorId: null,
          actorName: "unlock-user CLI",
          action: "auth.unlocked",
          entity: "user",
          entityId: "u-joy",
          changes: null,
        },
        {
          id: "r-2",
          at: "2026-09-27T03:04:05.000Z",
          actorType: "staff",
          actorId: "u-1",
          actorName: "Ana Cruz",
          action: "staff.updated",
          entity: "user",
          entityId: "u-joy",
          changes: { username: "joy.santos", role: { old: "triage_nurse", new: "facility_staff" } },
        },
        {
          id: "r-3",
          at: "2026-09-26T16:00:00.000Z",
          actorType: "staff",
          actorId: null,
          actorName: null,
          action: "auth.sign_in_failed",
          entity: "user",
          entityId: null,
          changes: "{not json",
        },
      ],
      total: 3,
      page: 1,
      pageCount: 1,
      pageSize: 25,
    });
    const page = (await AuditPage({
      searchParams: Promise.resolve({ q: "joy", action: "all", entity: "user", from: "2026-09-26", to: "2026-09-28" }),
    })) as ReactElement<{ rows: Record<string, unknown>[] } & Record<string, unknown>>;
    const { props } = page;
    expect(props).toMatchObject({
      q: "joy",
      action: "all",
      entity: "user",
      from: "2026-09-26",
      to: "2026-09-28",
      total: 3,
      page: 1,
      pageCount: 1,
    });
    const [system, staff, unknown] = props.rows;
    expect(system).toMatchObject({
      actor: "System",
      action: "auth.unlocked",
      actionLabel: "Account unlocked",
      entityLabel: "Staff account",
      changes: { kind: "none" },
    });
    // Manila time (UTC+8) with seconds.
    expect(system!.time).toMatch(/Sep 28, 2026/);
    expect(system!.time).toMatch(/12:00:05/);
    expect(staff).toMatchObject({
      actor: "Ana Cruz",
      actionLabel: "Staff account updated",
      entityId: "u-joy",
      changes: {
        kind: "fields",
        lines: [
          { field: "username", kind: "value", value: "joy.santos" },
          { field: "role", kind: "diff", old: "triage_nurse", new: "facility_staff" },
        ],
      },
    });
    expect(staff!.time).toMatch(/11:04:05/);
    expect(unknown).toMatchObject({
      actor: "Unknown",
      actionLabel: "Sign-in failed",
      entityId: null,
      changes: { kind: "raw", text: "{not json" },
    });
  });

  it("falls back to the defaults for bad params", async () => {
    stubs.role = "admin";
    await AuditPage({ searchParams: Promise.resolve({ action: "nope", entity: "patients", from: "yesterday", page: "abc" }) });
    expect(vi.mocked(listAudit).mock.calls[0]?.[0]).toEqual({
      q: "",
      action: "all",
      entity: "all",
      from: "",
      to: "",
      page: 1,
      pageSize: 25,
    });
  });
});
