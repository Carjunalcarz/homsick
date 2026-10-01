// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATIENT_FINDER_INPUT_ID } from "@/lib/keyboard-shortcuts";
import type { PatientFinderRow } from "@/server/patients/actions";
import type { FacilityTile, TriageContext } from "@/server/triage/actions";

vi.mock("@/server/patients/actions", () => ({ searchPatientsAction: vi.fn(), registerPatientAction: vi.fn() }));
vi.mock("@/server/triage/actions", () => ({ getTriageContextAction: vi.fn(), recordTriageAction: vi.fn() }));

const { searchPatientsAction } = await import("@/server/patients/actions");
const { getTriageContextAction, recordTriageAction } = await import("@/server/triage/actions");
const { TriageForm, NEXT_PATIENT_ID } = await import("./triage-form");
const { PRINT_SLIP_ID } = await import("./print-slip");
const { TriageWorkspace } = await import("./triage-workspace");

const LOLA: PatientFinderRow = {
  id: "p-lola",
  hospitalNumber: "HN-2026-000012",
  lastName: "Carmen",
  firstName: "Lola",
  middleName: null,
  suffix: null,
  name: "CARMEN, Lola",
  sex: "female",
  birthdate: "1954-01-01",
  age: 72,
  lastVisit: null,
};

const JUAN: PatientFinderRow = { ...LOLA, id: "p-juan", name: "DELA CRUZ, Juan", sex: "male", age: 41, birthdate: "1985-01-01" };

const LEVELS = [
  { id: "l-urgent", name: "Urgent", isEr: false, rank: 1 },
  { id: "l-routine", name: "Routine", isEr: false, rank: 2 },
  { id: "l-er", name: "Emergency", isEr: true, rank: null },
];

const CATEGORIES = [
  { code: "senior_citizen", name: "Senior Citizen" },
  { code: "pwd", name: "PWD" },
  { code: "pregnant", name: "Pregnant" },
];

const FACILITIES: FacilityTile[] = [
  { id: "f-pn", name: "Prenatal", available: false, paper: false, waiting: 0, reason: "Closed, opens tomorrow 7:00 AM" },
  { id: "f-cn", name: "Consultation", available: true, paper: false, waiting: 3, reason: null },
  { id: "f-ab", name: "Animal Bite Center", available: true, paper: false, waiting: 0, reason: null },
  { id: "f-tr", name: "Treatment", available: true, paper: true, waiting: 0, reason: null },
];

function context(patient: PatientFinderRow, overrides: Partial<TriageContext> = {}): TriageContext {
  return {
    patientId: patient.id,
    name: patient.name,
    sex: patient.sex,
    age: patient.age,
    seniorCitizenIdOnFile: patient.id === LOLA.id,
    pwdIdOnFile: false,
    openVisit: false,
    levels: LEVELS,
    categories: CATEGORIES,
    facilities: FACILITIES,
    ...overrides,
  };
}

const ISSUED = {
  visitId: "v-1",
  opdDate: "2026-09-28",
  outcome: "queued" as const,
  queue: { entryId: "qe-1", facilityId: "f-cn", facilityName: "Consultation", queueNumber: "CN-004", ahead: 0 },
  closedAt: null,
  paperFacility: null,
  patientName: "CARMEN, Lola",
  urgencyName: "Routine",
  urgencyIsEr: false,
  urgencyTone: "routine" as const,
  priorityIdEntered: false,
  priorityCategoryName: "Senior Citizen",
  sortGroup: 2 as const,
  abnormalFields: ["temperatureC" as const],
};

const BANNER_LINE = "Consultation · Next in line";

let contextOverrides: Partial<TriageContext> = {};

beforeEach(() => {
  contextOverrides = {};
  vi.mocked(getTriageContextAction).mockReset();
  vi.mocked(getTriageContextAction).mockImplementation(async (input) => {
    const id = (input as { patientId: string }).patientId;
    return { ok: true, data: context(id === LOLA.id ? LOLA : JUAN, contextOverrides) };
  });
  vi.mocked(recordTriageAction).mockReset();
  vi.mocked(recordTriageAction).mockResolvedValue({ ok: true, data: ISSUED });
  vi.mocked(searchPatientsAction).mockReset();
  vi.mocked(searchPatientsAction).mockImplementation(async (input) => {
    const q = (input as { q: string }).q;
    const rows = q === "carmen" ? [LOLA] : [];
    return { ok: true, data: { q, rows, total: rows.length } };
  });
});

afterEach(() => cleanup());

const byLabel = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const radio = (name: RegExp | string) => screen.getByRole("radio", { name });

async function renderForm(patient = LOLA) {
  const props = { onNextPatient: vi.fn(), onDirtyChange: vi.fn() };
  render(<TriageForm patient={patient} autoFocus {...props} />);
  await screen.findByRole("form", { name: "Record triage" });
  return props;
}

async function fillVitals(user: ReturnType<typeof userEvent.setup>) {
  await user.type(byLabel("Temperature"), "37.2");
  await user.type(byLabel("BP systolic"), "120");
  await user.type(byLabel("BP diastolic"), "80");
  await user.type(byLabel("Pulse"), "80");
  await user.type(byLabel("Respiratory rate"), "16");
}

const issueButton = () => screen.getByRole("button", { name: /Issue queue number/ });
const chooseConsultation = (user: ReturnType<typeof userEvent.setup>) => user.click(radio(/Consultation/));

describe("TriageForm", () => {
  it("focuses the complaint and Tabs through the fields in order", async () => {
    const user = userEvent.setup();
    await renderForm();
    expect(document.activeElement).toBe(byLabel("Chief complaint"));
    const order = [
      byLabel("Temperature"),
      byLabel("BP systolic"),
      byLabel("BP diastolic"),
      byLabel("Pulse"),
      byLabel("Respiratory rate"),
      byLabel(/^SpO₂/),
      byLabel(/^Weight/),
      radio(/Urgent/),
    ];
    for (const element of order) {
      await user.tab();
      expect(document.activeElement).toBe(element);
    }
    await user.tab();
    expect(document.activeElement).toBe(radio("None"));
    // Then the Facility tiles (the first selectable one), then the button.
    await user.tab();
    expect(document.activeElement).toBe(radio(/Consultation/));
    await user.tab();
    expect(document.activeElement).toBe(issueButton());
  });

  it("picks an Urgency Level with number keys only while the group has focus", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(byLabel("Chief complaint"), "2");
    expect(byLabel("Chief complaint").value).toBe("2");
    expect(LEVELS.some((l) => radio(new RegExp(l.name)).getAttribute("aria-checked") === "true")).toBe(false);

    radio(/Urgent/).focus();
    await user.keyboard("2");
    expect(radio(/Routine/).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio(/Routine/));
    await user.keyboard("3");
    expect(radio(/Emergency/).getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{ArrowLeft}");
    expect(radio(/Routine/).getAttribute("aria-checked")).toBe("true");
    // The ER level is last.
    expect(screen.getAllByRole("radio").slice(0, 3).map((r) => r.textContent)).toEqual([
      "1Urgency: Urgent",
      "2Urgency: Routine",
      "3Urgency: Emergency",
    ]);
  });

  it("flags an abnormal value amber with a hint, and an impossible one red, blocking the save", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(byLabel("Temperature"), "37.8");
    expect(byLabel("Temperature").dataset.state).toBe("abnormal");
    expect(screen.getByText("Above normal (37.5 °C max)")).toBeTruthy();
    expect(byLabel("Temperature").getAttribute("aria-invalid")).toBeNull();

    await user.clear(byLabel("Temperature"));
    await user.type(byLabel("Temperature"), "93.2");
    // Shown once the field is left.
    expect(screen.queryByText("Temperature must be between 30 and 45 °C.")).toBeNull();
    await user.tab();
    expect(byLabel("Temperature").dataset.state).toBe("impossible");
    expect(byLabel("Temperature").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Temperature must be between 30 and 45 °C.")).toBeTruthy();

    await user.type(byLabel("Chief complaint"), "Fever");
    await user.click(issueButton());
    expect(recordTriageAction).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(byLabel("Temperature")));
  });

  it("shows diastolic ≥ systolic as an error on diastolic", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(byLabel("BP systolic"), "120");
    await user.type(byLabel("BP diastolic"), "130");
    await user.tab();
    expect(screen.getByText("Diastolic BP must be lower than systolic.")).toBeTruthy();
  });

  it("offers Pregnant only for a female patient", async () => {
    await renderForm(JUAN);
    expect(screen.queryByRole("radio", { name: "Pregnant" })).toBeNull();
    expect(radio("PWD")).toBeTruthy();
    cleanup();
    await renderForm(LOLA);
    expect(radio("Pregnant")).toBeTruthy();
  });

  it("asks for a missing PWD ID or ID not presented, and notes an ID on file", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(radio("Senior Citizen"));
    expect(screen.getByText("Senior Citizen ID on file.")).toBeTruthy();
    expect(screen.queryByLabelText("ID not presented")).toBeNull();

    await user.click(radio("PWD"));
    expect(byLabel("PWD ID")).toBeTruthy();
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await chooseConsultation(user);
    await user.click(issueButton());
    expect(recordTriageAction).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the PWD ID, or tick ID not presented.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(byLabel("PWD ID")));

    await user.click(byLabel("ID not presented"));
    await user.click(issueButton());
    expect(recordTriageAction).toHaveBeenCalledWith(
      expect.objectContaining({ priorityCategory: "pwd", idNotPresented: true, priorityId: "" }),
    );
  });

  it("refuses Senior Citizen for a patient under 60", async () => {
    const user = userEvent.setup();
    contextOverrides = { age: 45 };
    await renderForm({ ...LOLA, age: 45 });
    await user.click(radio("Senior Citizen"));
    expect(screen.getByText("Senior Citizen is for patients aged 60 and over.")).toBeTruthy();
  });

  it("says when the patient already has an open Visit today, with no form", async () => {
    contextOverrides = { openVisit: true };
    render(<TriageForm patient={LOLA} onNextPatient={vi.fn()} />);
    expect(await screen.findByText("CARMEN, Lola already has an open Visit today.")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Record triage" })).toBeNull();
  });

  it("issues with Ctrl+Enter, shows the cyan banner, and Esc goes to the next patient", async () => {
    const user = userEvent.setup();
    const { onNextPatient } = await renderForm();
    await user.type(byLabel("Chief complaint"), "Dizziness");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(radio("Senior Citizen"));
    await chooseConsultation(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(recordTriageAction).toHaveBeenCalledWith({
      patientId: LOLA.id,
      chiefComplaint: "Dizziness",
      temperatureC: "37.2",
      bpSystolic: "120",
      bpDiastolic: "80",
      pulse: "80",
      respiratoryRate: "16",
      spo2: "",
      weightKg: "",
      urgencyLevelId: "l-routine",
      priorityCategory: "senior_citizen",
      priorityId: "",
      idNotPresented: false,
      facilityId: "f-cn",
      directToEr: false,
    });
    const banner = await screen.findByTestId("queue-issued-banner");
    expect(banner.querySelector(".text-queue-number-issued")?.textContent).toBe("CN-004");
    expect(screen.getByText(BANNER_LINE)).toBeTruthy();
    expect(screen.getByText("Senior Citizen")).toBeTruthy();
    expect(banner.textContent).toContain("Urgency: Routine");
    // Print slip is focused (Story 3.6); Esc is still Next patient.
    await waitFor(() => expect(document.activeElement?.id).toBe(PRINT_SLIP_ID));
    expect(screen.getByRole("button", { name: "Next patient" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onNextPatient).toHaveBeenCalledTimes(1);
  });

  it("Enter after issuing prints the slip through a hidden iframe, without leaving the page (Story 3.6)", async () => {
    const user = userEvent.setup();
    const { onNextPatient } = await renderForm();
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await chooseConsultation(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByTestId("queue-issued-banner");
    await waitFor(() => expect(document.activeElement?.id).toBe(PRINT_SLIP_ID));

    await user.keyboard("{Enter}");
    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-print-slip-frame]");
    expect(frame).toBeTruthy();
    expect(new URL(frame!.src).pathname).toBe("/print/slip/qe-1");
    expect(screen.getByRole("button", { name: "Preparing…" })).toBeTruthy();

    const print = vi.fn();
    Object.defineProperty(frame!.contentWindow!, "print", { value: print, configurable: true });
    // jsdom doesn't load the src: fill the frame's empty document with the slip.
    const doc = frame!.contentDocument!;
    const root = doc.documentElement ?? doc.appendChild(doc.createElement("html"));
    root.innerHTML = '<body><article data-queue-slip=""></article></body>';
    act(() => {
      fireEvent.load(frame!);
    });
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Print slip" })).toBeTruthy();
    // Still on the banner; Esc is Next patient.
    expect(onNextPatient).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onNextPatient).toHaveBeenCalledTimes(1);
  });

  it("the ER and paper-number outcomes offer no Print slip", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: true,
      data: {
        ...ISSUED,
        outcome: "paper_number",
        queue: null,
        closedAt: null,
        paperFacility: { id: "f-tr", name: "Treatment" },
      },
    });
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Wound dressing");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(radio(/Treatment/));
    await user.click(screen.getByRole("button", { name: /Record triage \(paper number\)/ }));
    await screen.findByTestId("paper-number-panel");
    expect(screen.queryByRole("button", { name: "Print slip" })).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("the banner says how many are ahead", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: true,
      data: { ...ISSUED, priorityCategoryName: null, queue: { ...ISSUED.queue, queueNumber: "CN-1000", ahead: 2 } },
    });
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await chooseConsultation(user);
    await user.click(issueButton());
    expect(await screen.findByText("Consultation · 2 ahead")).toBeTruthy();
    expect(screen.getByText("CN-1000")).toBeTruthy();
    expect(screen.getByText("No Priority Category")).toBeTruthy();
  });

  it("shows the Facility tiles with waiting counts; a closed tile is disabled with the reason; a not-live one offers a paper number", async () => {
    await renderForm();
    const group = screen.getByRole("radiogroup", { name: "Facility" });
    expect(group).toBeTruthy();
    expect((radio(/Prenatal/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Closed, opens tomorrow 7:00 AM")).toBeTruthy();
    expect((radio(/Treatment/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("Paper number (not live yet)")).toBeTruthy();
    expect((radio(/Consultation/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("3 waiting")).toBeTruthy();
    expect(screen.getByText("0 waiting")).toBeTruthy();
    // The reason is tied to the radio, not only shown.
    expect(radio(/Prenatal/).getAttribute("aria-describedby")).toBe("triage-facility-f-pn-detail");
  });

  it("asks for a Facility before issuing", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(issueButton());
    expect(recordTriageAction).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a Facility.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(radio(/Consultation/)));
    // Arrow keys move within the group.
    await user.keyboard("{ArrowDown}");
    expect((radio(/Animal Bite Center/) as HTMLInputElement).checked).toBe(true);
    await user.click(issueButton());
    expect(recordTriageAction).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "f-ab", directToEr: false }));
  });

  it("an ER level hides the tiles, turns the button into Direct to ER and asks to confirm", async () => {
    const user = userEvent.setup();
    const { onNextPatient } = await renderForm();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: true,
      data: {
        ...ISSUED,
        outcome: "directed_to_er",
        queue: null,
        closedAt: "2026-09-28T02:05:00.000Z",
        urgencyName: "Emergency",
        urgencyIsEr: true,
        urgencyTone: "urgent",
        sortGroup: null,
      },
    });
    await user.type(byLabel("Chief complaint"), "Chest pain");
    await fillVitals(user);
    await chooseConsultation(user);
    radio(/Urgent/).focus();
    await user.keyboard("3");
    expect(screen.queryByRole("radiogroup", { name: "Facility" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Issue queue number/ })).toBeNull();
    const erButton = screen.getByRole("button", { name: /Direct to ER/ });

    // Cancel: nothing sent, focus back on the button.
    await user.click(erButton);
    const dialog = await screen.findByRole("alertdialog", { name: "Direct CARMEN, Lola to the Emergency Room?" });
    expect(dialog.textContent).toContain("No queue number will be issued and the Visit closes.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(recordTriageAction).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Direct to ER/ })));

    // Ctrl+Enter also asks; Confirm sends Direct to ER with no Facility.
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(recordTriageAction).toHaveBeenCalledTimes(1);
    expect(recordTriageAction).toHaveBeenCalledWith(
      expect.objectContaining({ urgencyLevelId: "l-er", facilityId: "", directToEr: true }),
    );
    const panel = await screen.findByTestId("directed-to-er-panel");
    expect(panel.textContent).toContain("Directed to ER · Visit closed 10:05 AM");
    expect(panel.textContent).toContain("Senior Citizen");
    expect(screen.queryByTestId("queue-issued-banner")).toBeNull();
    expect(screen.queryByRole("button", { name: "Print slip" })).toBeNull();
    await waitFor(() => expect(document.activeElement?.id).toBe(NEXT_PATIENT_ID));
    await user.keyboard("{Escape}");
    expect(onNextPatient).toHaveBeenCalledTimes(1);
  });

  it("on facility_unavailable, reloads the tiles: the refused one is disabled with its reason and focus moves on", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: false,
      error: {
        code: "facility_unavailable",
        message: "Consultation isn't taking patients now.",
        fieldErrors: { facilityId: "Consultation isn't taking patients now." },
      },
    });
    await renderForm();
    expect(getTriageContextAction).toHaveBeenCalledTimes(1);
    // Consultation has closed since the form loaded.
    contextOverrides = {
      facilities: FACILITIES.map((f) =>
        f.id === "f-cn" ? { ...f, available: false, reason: "Closed, opens tomorrow 7:00 AM" } : f,
      ),
    };
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await chooseConsultation(user);
    await user.click(issueButton());
    expect(await screen.findByText("Consultation isn't taking patients now.")).toBeTruthy();
    expect(getTriageContextAction).toHaveBeenCalledTimes(2);
    await waitFor(() => expect((radio(/Consultation/) as HTMLInputElement).disabled).toBe(true));
    expect((radio(/Consultation/) as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(radio(/Animal Bite Center/)));
  });

  it("reloads the tiles when the window regains focus", async () => {
    await renderForm();
    expect(screen.getByText("3 waiting")).toBeTruthy();
    contextOverrides = { facilities: FACILITIES.map((f) => (f.id === "f-cn" ? { ...f, waiting: 5 } : f)) };
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("5 waiting")).toBeTruthy();
  });

  it("a not-live tile records triage for a paper number", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: true,
      data: { ...ISSUED, outcome: "paper_number", queue: null, paperFacility: { id: "f-tr", name: "Treatment" } },
    });
    const { onNextPatient } = await renderForm();
    await user.type(byLabel("Chief complaint"), "Wound dressing");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(radio(/Treatment/));
    const button = screen.getByRole("button", { name: /Record triage \(paper number\)/ });
    expect(screen.queryByRole("button", { name: /Issue queue number/ })).toBeNull();
    await user.click(button);
    expect(recordTriageAction).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "f-tr", directToEr: false }));
    const panel = await screen.findByTestId("paper-number-panel");
    expect(panel.textContent).toContain("Triage recorded · Give a paper number for Treatment");
    expect(panel.textContent).toContain("Senior Citizen");
    await waitFor(() => expect(document.activeElement?.id).toBe(NEXT_PATIENT_ID));
    await user.keyboard("{Escape}");
    expect(onNextPatient).toHaveBeenCalledTimes(1);
  });

  it("with no Facility taking patients, says so and asks for a Facility without calling the server", async () => {
    const user = userEvent.setup();
    contextOverrides = {
      facilities: FACILITIES.map((f) => ({ ...f, available: false, paper: false, reason: "Closed, opens tomorrow 7:00 AM" })),
    };
    await renderForm();
    expect(screen.getByText("No Facility is taking patients now.")).toBeTruthy();
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(issueButton());
    expect(recordTriageAction).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a Facility.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.id).toBe("triage-facilityId"));
  });

  it("switching from an ER level back to a non-ER one brings back the tiles and Issue queue number", async () => {
    const user = userEvent.setup();
    await renderForm();
    radio(/Urgent/).focus();
    await user.keyboard("3");
    expect(screen.queryByRole("radiogroup", { name: "Facility" })).toBeNull();
    expect(screen.getByRole("button", { name: /Direct to ER/ })).toBeTruthy();
    await user.keyboard("2");
    expect(screen.getByRole("radiogroup", { name: "Facility" })).toBeTruthy();
    expect(issueButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Direct to ER/ })).toBeNull();
  });

  it("shows the server's ER-confirmation refusal and returns focus to Direct to ER", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: false,
      error: {
        code: "invalid",
        message: "An ER Urgency Level is directed to the ER: confirm Direct to ER. No queue number is issued.",
      },
    });
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Chest pain");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("3");
    await user.click(screen.getByRole("button", { name: /Direct to ER/ }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByText("An ER Urgency Level is directed to the ER: confirm Direct to ER. No queue number is issued."),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Direct to ER/ })));
  });

  it("never saves on plain Enter in a field; the complaint keeps its newline", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Cough{Enter}Fever");
    expect(byLabel("Chief complaint").value).toBe("Cough\nFever");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(byLabel("Pulse"));
    await user.keyboard("{Enter}");
    await user.click(radio("None"));
    await user.keyboard("{Enter}");
    await user.click(radio("PWD"));
    await user.click(byLabel("PWD ID"));
    await user.keyboard("PWD-1{Enter}");
    await chooseConsultation(user);
    await user.keyboard("{Enter}");
    expect(recordTriageAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Enter the PWD ID, or tick ID not presented.")).toBeNull();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(recordTriageAction).toHaveBeenCalledTimes(1);
  });

  it("focuses the refused Priority Category option on a server error", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: false,
      error: {
        code: "invalid",
        message: "Check the highlighted fields.",
        fieldErrors: { priorityCategory: "That Priority Category isn't available. Choose another." },
      },
    });
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await user.click(radio("Pregnant"));
    await chooseConsultation(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("That Priority Category isn't available. Choose another.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(radio("Pregnant")));
  });

  it("ignores Esc outside the triage workspace once saved", async () => {
    const user = userEvent.setup();
    const onNextPatient = vi.fn();
    render(
      <>
        <input aria-label="Search patients" />
        <div data-triage-workspace>
          <TriageForm patient={LOLA} autoFocus onNextPatient={onNextPatient} />
        </div>
      </>,
    );
    await screen.findByRole("form", { name: "Record triage" });
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await chooseConsultation(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByText(BANNER_LINE);
    await user.click(byLabel("Search patients"));
    await user.keyboard("{Escape}");
    expect(onNextPatient).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Next patient" }).focus();
    await user.keyboard("{Escape}");
    expect(onNextPatient).toHaveBeenCalledTimes(1);
  });

  it("shows a server refusal such as visit_already_open", async () => {
    const user = userEvent.setup();
    vi.mocked(recordTriageAction).mockResolvedValue({
      ok: false,
      error: { code: "visit_already_open", message: "CARMEN, Lola already has an open Visit today." },
    });
    await renderForm();
    await user.type(byLabel("Chief complaint"), "Dizziness");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("1");
    await chooseConsultation(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("CARMEN, Lola already has an open Visit today.")).toBeTruthy();
  });
});

describe("TriageWorkspace with the triage form", () => {
  it("picking a patient in the finder fills the form; the AC flow saves and Next patient returns to the finder", async () => {
    const user = userEvent.setup();
    render(<TriageWorkspace canRegister canRecord />);
    await user.type(screen.getByRole("combobox", { name: "Find patient" }), "carmen");
    await screen.findByRole("option", { name: /CARMEN, Lola/ }, { timeout: 2000 });
    await user.keyboard("{ArrowDown}{Enter}");

    // The form is for the picked patient, with focus on the complaint.
    await screen.findByRole("form", { name: "Record triage" });
    expect(getTriageContextAction).toHaveBeenCalledWith({ patientId: LOLA.id });
    expect(screen.getByRole("heading", { name: "Triage" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(byLabel("Chief complaint")));

    await user.keyboard("Dizziness");
    await user.tab();
    await user.keyboard("37.8");
    expect(byLabel("Temperature").dataset.state).toBe("abnormal");
    for (const value of ["120", "80", "80", "16"]) {
      await user.tab();
      await user.keyboard(value);
    }
    await user.tab(); // SpO₂
    await user.tab(); // Weight
    await user.tab(); // Urgency
    await user.keyboard("2");
    expect(radio(/Routine/).getAttribute("aria-checked")).toBe("true");
    await user.click(radio("Senior Citizen"));
    // Tab from the category group reaches the Facility tiles; arrows move within them.
    await user.tab();
    expect(document.activeElement).toBe(radio(/Consultation/));
    await user.keyboard(" ");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(recordTriageAction).toHaveBeenCalledWith(
      expect.objectContaining({
        temperatureC: "37.8",
        urgencyLevelId: "l-routine",
        priorityCategory: "senior_citizen",
        facilityId: "f-cn",
      }),
    );
    // The AC: the banner shows the next CN- number with Next in line.
    await screen.findByText(BANNER_LINE);
    expect(screen.getByText("CN-004")).toBeTruthy();

    await waitFor(() => expect(document.activeElement?.id).toBe(PRINT_SLIP_ID));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement?.id).toBe(PATIENT_FINDER_INPUT_ID));
    expect((screen.getByRole("combobox", { name: "Find patient" }) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("form", { name: "Record triage" })).toBeNull();
  });

  it("after a save, picking another patient asks nothing and opens the new form", async () => {
    const user = userEvent.setup();
    vi.mocked(searchPatientsAction).mockImplementation(async (input) => {
      const q = (input as { q: string }).q;
      const rows = q === "carmen" ? [LOLA] : q === "juan" ? [JUAN] : [];
      return { ok: true, data: { q, rows, total: rows.length } };
    });
    render(<TriageWorkspace canRecord />);
    const finder = () => screen.getByRole("combobox", { name: "Find patient" });
    await user.type(finder(), "carmen");
    await screen.findByRole("option", { name: /CARMEN, Lola/ }, { timeout: 2000 });
    await user.keyboard("{ArrowDown}{Enter}");
    await screen.findByRole("form", { name: "Record triage" });
    await user.type(byLabel("Chief complaint"), "Cough");
    await fillVitals(user);
    radio(/Urgent/).focus();
    await user.keyboard("2");
    await chooseConsultation(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByText(BANNER_LINE);

    await user.clear(finder());
    await user.type(finder(), "juan");
    await screen.findByRole("option", { name: /DELA CRUZ, Juan/ }, { timeout: 2000 });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("alertdialog", { name: "Discard this triage?" })).toBeNull();
    await waitFor(() => expect(getTriageContextAction).toHaveBeenLastCalledWith({ patientId: JUAN.id }));
    await screen.findByRole("form", { name: "Record triage" });
    expect(document.getElementById("selected-patient-name")?.textContent).toBe("DELA CRUZ, Juan");
    expect(byLabel("Chief complaint").value).toBe("");
  });

  it("asks before discarding an entered triage when another patient is picked", async () => {
    const user = userEvent.setup();
    render(<TriageWorkspace canRecord />);
    await user.type(screen.getByRole("combobox", { name: "Find patient" }), "carmen");
    await screen.findByRole("option", { name: /CARMEN, Lola/ }, { timeout: 2000 });
    await user.keyboard("{ArrowDown}{Enter}");
    await screen.findByRole("form", { name: "Record triage" });
    await user.type(byLabel("Chief complaint"), "Cough");

    screen.getByRole("combobox", { name: "Find patient" }).focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("alertdialog", { name: "Discard this triage?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(byLabel("Chief complaint").value).toBe("Cough");
  });
});
