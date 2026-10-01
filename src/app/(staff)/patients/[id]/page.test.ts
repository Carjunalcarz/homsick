import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ role: "triage_nurse" as string }));

vi.mock("@/server/auth/session", () => ({
  requireStaff: async () => ({ id: "u-1", name: "Joy Santos", username: "joy.santos", role: stubs.role, facilityIds: [] }),
}));
vi.mock("@/server/patients/service", () => ({
  getRecordView: vi.fn((id: string) =>
    id === "p-1"
      ? {
          name: "DELA CRUZ, Juan Santos",
          age: 41,
          visits: [],
          patient: {
            id: "p-1",
            hospitalNumber: "HN-2026-000001",
            lastName: "Dela Cruz",
            firstName: "Juan",
            middleName: "Santos",
            suffix: null,
            sex: "male",
            birthdate: "1985-04-12",
            addressBarangay: "Poblacion",
            addressMunicipality: "San Jose",
            contactNumber: "09171234567",
            philhealthPin: null,
            seniorCitizenId: null,
            pwdId: null,
            emergencyContactName: null,
            emergencyContactNumber: null,
            privacyNoticeAt: "2026-09-27T02:05:00.000Z",
            createdAt: "2026-09-27T02:05:00.000Z",
            updatedAt: "2026-09-27T02:05:00.000Z",
            createdBy: "u-1",
            deactivatedAt: null,
          },
        }
      : null,
  ),
}));

const { getRecordView } = await import("@/server/patients/service");
const { Forbidden, FORBIDDEN_TITLE } = await import("@/components/forbidden");
const { default: RecordPage, generateMetadata } = await import("./page");

type ScreenProps = { record: Record<string, unknown>; canEdit: boolean };

beforeEach(() => {
  vi.mocked(getRecordView).mockClear();
});

describe("/patients/[id]", () => {
  it.each([
    ["triage_nurse", true],
    ["admin", true],
    ["facility_staff", false],
  ])("opens the record for %s (edit: %s), recording the view", async (role, canEdit) => {
    stubs.role = role;
    const page = (await RecordPage({ params: Promise.resolve({ id: "p-1" }) })) as ReactElement<ScreenProps>;
    // The tab never shows the patient's name.
    expect(await generateMetadata()).toEqual({ title: "Patient record" });
    expect(getRecordView).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getRecordView).mock.calls[0]!.slice(0, 2)).toEqual([
      "p-1",
      { type: "staff", id: "u-1", name: "Joy Santos" },
    ]);
    expect(page.props.canEdit).toBe(canEdit);
    expect(page.props.record).toMatchObject({
      id: "p-1",
      name: "DELA CRUZ, Juan Santos",
      hospitalNumber: "HN-2026-000001",
      ageLabel: "41 y",
      birthdateLabel: "Apr 12, 1985",
      deactivated: false,
      visits: [],
    });
    // Manila time (UTC+8).
    expect(page.props.record.privacyNoticeLabel).toMatch(/Sep 27, 2026/);
    expect(page.props.record.privacyNoticeLabel).toMatch(/10:05/);
  });

  it("gives a 404 for an unknown id", async () => {
    stubs.role = "triage_nurse";
    await expect(RecordPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("shows a Role outside patients.view the no-access page without reading or recording", async () => {
    stubs.role = "superuser";
    const page = (await RecordPage({ params: Promise.resolve({ id: "p-1" }) })) as ReactElement;
    expect(page.type).toBe(Forbidden);
    expect(await generateMetadata()).toEqual({ title: FORBIDDEN_TITLE });
    expect(getRecordView).not.toHaveBeenCalled();
  });
});
