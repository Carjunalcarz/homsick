// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR } from "@/components/form-parts";
import type { PatientRecordData } from "./record-types";

vi.mock("@/server/patients/actions", () => ({ updatePatientAction: vi.fn() }));

const { updatePatientAction } = await import("@/server/patients/actions");
const { PatientRecordScreen, EDIT_BUTTON_ID } = await import("./record-screen");

const RECORD: PatientRecordData = {
  id: "p-1",
  hospitalNumber: "HN-2026-000001",
  name: "DELA CRUZ, Juan Santos",
  lastName: "Dela Cruz",
  firstName: "Juan",
  middleName: "Santos",
  suffix: null,
  sex: "male",
  birthdate: "1985-04-12",
  birthdateLabel: "Apr 12, 1985",
  ageLabel: "41 y",
  addressBarangay: "Poblacion",
  addressMunicipality: "San Jose",
  contactNumber: "09171234567",
  philhealthPin: "12-345678901-2",
  seniorCitizenId: null,
  pwdId: null,
  emergencyContactName: null,
  emergencyContactNumber: null,
  privacyNoticeLabel: "Sep 27, 2026, 10:05 AM",
  deactivated: false,
  updatedAt: "2026-09-27T02:05:00.000Z",
  visits: [],
};

beforeEach(() => {
  vi.mocked(updatePatientAction).mockReset();
});

afterEach(() => {
  cleanup();
});

const byLabel = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const editButton = () => screen.getByRole("button", { name: "Edit details" });
const sheetForm = () => screen.queryByRole("form", { name: "Edit patient details" });
const discardDialog = () => screen.queryByRole("alertdialog", { name: "Discard your changes?" });

describe("PatientRecordScreen", () => {
  it("shows the header, sections, the empty Visit history and no delete control", () => {
    render(<PatientRecordScreen record={RECORD} canEdit />);
    expect(screen.getByRole("heading", { level: 1, name: "DELA CRUZ, Juan Santos" })).toBeTruthy();
    expect(screen.getByText("HN-2026-000001")).toBeTruthy();
    expect(screen.getByText("41 y")).toBeTruthy();
    expect(screen.getByText("Apr 12, 1985")).toBeTruthy();
    for (const heading of ["Contact & address", "IDs", "Emergency contact", "Privacy notice", "Visit history"]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeTruthy();
    }
    expect(screen.getByText("No visits yet.")).toBeTruthy();
    expect(screen.getByText("Sep 27, 2026, 10:05 AM")).toBeTruthy();
    // Senior Citizen ID, PWD ID, emergency name and number are missing.
    expect(screen.getAllByText("Not recorded")).toHaveLength(4);
    expect(screen.queryByText("Deactivated")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it("offers Edit details only to editors", () => {
    render(<PatientRecordScreen record={RECORD} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("lists Visits newest first with date, status and Urgency Level (no clinical values)", () => {
    const visits: PatientRecordData["visits"] = [
      {
        id: "v-2",
        opdDate: "2026-09-27",
        dateLabel: "Sep 27, 2026",
        status: "open",
        statusLabel: "Open",
        urgency: { name: "Routine", isEr: false, tone: "routine" },
      },
      { id: "v-1", opdDate: "2026-09-01", dateLabel: "Sep 1, 2026", status: "cancelled", statusLabel: "Cancelled", urgency: null },
    ];
    render(<PatientRecordScreen record={{ ...RECORD, visits }} canEdit={false} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Sep 27, 2026Status: OpenUrgency: Routine",
      "Sep 1, 2026Status: Cancelled—No triage recorded",
    ]);
    expect(screen.queryByText("No visits yet.")).toBeNull();
  });

  it('shows a "Deactivated" badge on a deactivated patient', () => {
    render(<PatientRecordScreen record={{ ...RECORD, deactivated: true }} canEdit={false} />);
    expect(screen.getByText("Deactivated")).toBeTruthy();
  });
});

describe("EditPatientSheet", () => {
  it("opens pre-filled, without a privacy checkbox", async () => {
    const user = userEvent.setup();
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    expect(sheetForm()).toBeTruthy();
    expect(byLabel("Last name").value).toBe("Dela Cruz");
    expect(byLabel("First name").value).toBe("Juan");
    expect(byLabel("Male").checked).toBe(true);
    expect(byLabel("Birthdate").value).toBe("1985-04-12");
    expect(byLabel("Contact number").value).toBe("09171234567");
    expect(byLabel("Barangay").value).toBe("Poblacion");
    // More details opens when an optional field has a value.
    expect(screen.getByRole("button", { name: /More details/ }).getAttribute("aria-expanded")).toBe("true");
    expect(byLabel("Middle name").value).toBe("Santos");
    expect(byLabel("PhilHealth PIN").value).toBe("12-345678901-2");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("focuses the first error on submit and sends nothing", async () => {
    const user = userEvent.setup();
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.clear(byLabel("First name"));
    await user.clear(byLabel("Barangay"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.activeElement).toBe(byLabel("First name")));
    const first = byLabel("First name");
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(first.getAttribute("aria-describedby")!)!.textContent).toBe("Enter the first name.");
    expect(screen.getByText("Enter the barangay.")).toBeTruthy();
    expect(updatePatientAction).not.toHaveBeenCalled();
  });

  it("saves, announces the new name, closes and returns focus to Edit details", async () => {
    const user = userEvent.setup();
    let resolve: (value: Awaited<ReturnType<typeof updatePatientAction>>) => void = () => {};
    vi.mocked(updatePatientAction).mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.clear(byLabel("Barangay"));
    await user.type(byLabel("Barangay"), "San Roque");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(updatePatientAction).mock.calls[0]![0]).toMatchObject({
      id: "p-1",
      expectedUpdatedAt: "2026-09-27T02:05:00.000Z",
      addressBarangay: "San Roque",
      contactNumber: "09171234567",
    });
    expect(vi.mocked(updatePatientAction).mock.calls[0]![0]).not.toHaveProperty("privacyNoticeExplained");
    resolve({ ok: true, data: { status: "updated", changed: true, name: "DELA CRUZ, Juan Santos" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved changes to DELA CRUZ, Juan Santos."));
    await waitFor(() => expect(sheetForm()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(EDIT_BUTTON_ID)));
    expect(discardDialog()).toBeNull();
  });

  it('says "No changes." for a save without edits', async () => {
    const user = userEvent.setup();
    vi.mocked(updatePatientAction).mockResolvedValue({
      ok: true,
      data: { status: "updated", changed: false, name: "DELA CRUZ, Juan Santos" },
    });
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("No changes."));
  });

  it("shows the Possible match card; Save anyway confirms the ids shown", async () => {
    const user = userEvent.setup();
    const match = {
      id: "p-7",
      hospitalNumber: "HN-2026-000007",
      lastName: "Reyes",
      firstName: "Ana",
      middleName: null,
      suffix: null,
      name: "REYES, Ana",
      sex: "female" as const,
      birthdate: "1985-04-12",
      age: 41,
      lastVisit: null,
    };
    vi.mocked(updatePatientAction)
      .mockResolvedValueOnce({ ok: true, data: { status: "possible_match", matches: [match] } })
      .mockResolvedValueOnce({ ok: true, data: { status: "updated", changed: true, name: "REYES, Ana Santos" } });
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.clear(byLabel("Last name"));
    await user.type(byLabel("Last name"), "Reyes");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const heading = await screen.findByRole("heading", { name: "Possible match" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText("HN-2026-000007")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this record" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(vi.mocked(updatePatientAction).mock.calls[1]![0]).toMatchObject({ confirmedMatchIds: ["p-7"] });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved changes to REYES, Ana Santos."));
  });

  it("shows a refusal in the alert region", async () => {
    const user = userEvent.setup();
    vi.mocked(updatePatientAction).mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "This patient record no longer exists." },
    });
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("This patient record no longer exists."),
    );
    expect(sheetForm()).toBeTruthy();
  });

  it("shows a stale refusal with a Reload button", async () => {
    const user = userEvent.setup();
    const STALE = "This record changed since you opened it. Reload to see the latest details.";
    vi.mocked(updatePatientAction).mockResolvedValue({ ok: false, error: { code: "stale", message: STALE } });
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.type(byLabel("Barangay"), " Norte");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(STALE));
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(sheetForm()).toBeTruthy();
  });

  it("shows a network failure in the alert region and enables Save again", async () => {
    const user = userEvent.setup();
    vi.mocked(updatePatientAction).mockRejectedValue(new Error("offline"));
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(NETWORK_ERROR));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    expect(sheetForm()).toBeTruthy();
  });

  it("ignores Esc and Cancel while a save is pending", async () => {
    const user = userEvent.setup();
    let resolve: (value: Awaited<ReturnType<typeof updatePatientAction>>) => void = () => {};
    vi.mocked(updatePatientAction).mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.type(byLabel("Barangay"), " Norte");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saving…" });
    await user.keyboard("{Escape}");
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    await user.click(cancel);
    expect(sheetForm()).toBeTruthy();
    expect(discardDialog()).toBeNull();
    resolve({ ok: true, data: { status: "updated", changed: true, name: "DELA CRUZ, Juan Santos" } });
    await waitFor(() => expect(sheetForm()).toBeNull());
    expect(discardDialog()).toBeNull();
  });

  it("asks before discarding changes: Keep editing keeps them, Discard closes", async () => {
    const user = userEvent.setup();
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.type(byLabel("Barangay"), " Norte");
    await user.keyboard("{Escape}");
    expect(discardDialog()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(discardDialog()).toBeNull());
    expect(sheetForm()).toBeTruthy();
    expect(byLabel("Barangay").value).toBe("Poblacion Norte");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(discardDialog()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(sheetForm()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(EDIT_BUTTON_ID)));
    expect(updatePatientAction).not.toHaveBeenCalled();

    // Reopened: the details are as stored again.
    await user.click(editButton());
    expect(byLabel("Barangay").value).toBe("Poblacion");
  });

  it("closes without asking when nothing changed", async () => {
    const user = userEvent.setup();
    render(<PatientRecordScreen record={RECORD} canEdit />);
    await user.click(editButton());
    await user.keyboard("{Escape}");
    expect(discardDialog()).toBeNull();
    await waitFor(() => expect(sheetForm()).toBeNull());
  });
});
