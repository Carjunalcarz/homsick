// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATIENT_FINDER_INPUT_ID } from "@/lib/keyboard-shortcuts";
import type { PatientFinderRow } from "@/server/patients/actions";

vi.mock("@/server/patients/actions", () => ({ searchPatientsAction: vi.fn(), registerPatientAction: vi.fn() }));

const { registerPatientAction, searchPatientsAction } = await import("@/server/patients/actions");
const { RegistrationForm } = await import("./registration-form");
const { TriageWorkspace, SELECTED_HEADING_ID } = await import("./triage-workspace");
const { FINDER_DELAY_MS } = await import("./patient-finder");

function patient(overrides: Partial<PatientFinderRow> = {}): PatientFinderRow {
  return {
    id: "p-43",
    hospitalNumber: "HN-2026-000043",
    lastName: "Dela Cruz",
    firstName: "Juan",
    middleName: null,
    suffix: null,
    name: "DELA CRUZ, Juan",
    sex: "male",
    birthdate: "1985-04-12",
    age: 41,
    lastVisit: null,
    ...overrides,
  };
}

const EXISTING = patient({ id: "p-7", hospitalNumber: "HN-2026-000007" });

// Testing Library advances fake timers only when it sees Jest's; point it at Vitest's.
(globalThis as { jest?: unknown }).jest = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };

beforeEach(() => {
  vi.mocked(registerPatientAction).mockReset();
  vi.mocked(searchPatientsAction).mockReset();
  vi.mocked(searchPatientsAction).mockImplementation(async (input) => {
    const q = (input as { q: string }).q;
    return { ok: true, data: { q, rows: [], total: 0 } };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const byLabel = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

function renderForm(initialName = { lastName: "", firstName: "" }) {
  const props = { onRegistered: vi.fn(), onUseExisting: vi.fn(), onCancel: vi.fn() };
  render(<RegistrationForm initialName={initialName} {...props} />);
  return props;
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  if (!byLabel("Last name").value) await user.type(byLabel("Last name"), "Dela Cruz");
  if (!byLabel("First name").value) await user.type(byLabel("First name"), "Juan");
  await user.click(byLabel("Male"));
  fireEvent.change(byLabel("Birthdate"), { target: { value: "1985-04-12" } });
  await user.type(byLabel("Contact number"), "+63 917 123 4567");
  await user.type(byLabel("Barangay"), "Poblacion");
  await user.type(byLabel("Municipality"), "San Jose");
  await user.click(byLabel("Privacy notice explained to the patient"));
}

describe("RegistrationForm", () => {
  it("focuses the first empty required field and keeps optional fields collapsed", () => {
    renderForm({ lastName: "Reyes", firstName: "Ana" });
    expect(byLabel("Last name").value).toBe("Reyes");
    expect(byLabel("First name").value).toBe("Ana");
    expect(document.activeElement).toBe(byLabel("Female"));
    const toggle = screen.getByRole("button", { name: /More details/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)!.hidden).toBe(true);
    expect(screen.queryByRole("textbox", { name: "PhilHealth PIN" })).toBeNull();
  });

  it("opens More details on click", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(document.activeElement).toBe(byLabel("Last name"));
    await user.click(screen.getByRole("button", { name: /More details/ }));
    expect(screen.getByRole("button", { name: /More details/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("textbox", { name: "PhilHealth PIN" })).toBeTruthy();
  });

  it("focuses the first error on submit, with errors tied to their fields, and sends nothing", async () => {
    const user = userEvent.setup();
    renderForm({ lastName: "Reyes", firstName: "" });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.activeElement).toBe(byLabel("First name")));
    const first = byLabel("First name");
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(first.getAttribute("aria-describedby")!)!.textContent).toBe("Enter the first name.");
    expect(screen.getByText("Confirm the privacy notice was explained.")).toBeTruthy();
    expect(byLabel("Privacy notice explained to the patient").getAttribute("aria-describedby")).toContain(
      "reg-privacyNoticeExplained-error",
    );
    expect(byLabel("Last name").hasAttribute("aria-invalid")).toBe(false);
    expect(registerPatientAction).not.toHaveBeenCalled();
  });

  it("opens More details to show an error in an optional field", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /More details/ }));
    await user.type(byLabel("PhilHealth PIN"), "1234");
    await user.click(screen.getByRole("button", { name: /More details/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.activeElement).toBe(byLabel("PhilHealth PIN")));
    expect(screen.getByText("PhilHealth PIN must be 12 digits.")).toBeTruthy();
    expect(registerPatientAction).not.toHaveBeenCalled();
  });

  it("shows the server's field errors", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPatientAction).mockResolvedValue({
      ok: false,
      error: { code: "invalid", message: "Check the highlighted fields.", fieldErrors: { birthdate: "Birthdate can't be in the future." } },
    });
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.activeElement).toBe(byLabel("Birthdate")));
    expect(screen.getByText("Birthdate can't be in the future.")).toBeTruthy();
  });

  it("saves and reports the new patient; Save is disabled while pending", async () => {
    const user = userEvent.setup();
    let resolve: (value: Awaited<ReturnType<typeof registerPatientAction>>) => void = () => {};
    vi.mocked(registerPatientAction).mockImplementation(() => new Promise((r) => (resolve = r)));
    const props = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saving = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(vi.mocked(registerPatientAction).mock.calls[0]![0]).toMatchObject({
      lastName: "Dela Cruz",
      firstName: "Juan",
      sex: "male",
      birthdate: "1985-04-12",
      contactNumber: "+63 917 123 4567",
      privacyNoticeExplained: true,
    });
    expect(vi.mocked(registerPatientAction).mock.calls[0]![0]).not.toHaveProperty("confirmDuplicate");
    await act(async () => resolve({ ok: true, data: { status: "created", patient: patient() } }));
    expect(props.onRegistered).toHaveBeenCalledWith(patient());
  });

  it("shows the Possible match card: Use this record", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPatientAction).mockResolvedValue({ ok: true, data: { status: "possible_match", matches: [EXISTING] } });
    const props = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const heading = await screen.findByRole("heading", { name: "Possible match" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText("HN-2026-000007")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Use this record" }));
    expect(props.onUseExisting).toHaveBeenCalledWith(EXISTING);
    expect(props.onRegistered).not.toHaveBeenCalled();
  });

  it("shows the Possible match card: Create anyway confirms the ids shown, and asks again for a new match", async () => {
    const user = userEvent.setup();
    const LATER = patient({ id: "p-9", hospitalNumber: "HN-2026-000009" });
    vi.mocked(registerPatientAction)
      .mockResolvedValueOnce({ ok: true, data: { status: "possible_match", matches: [EXISTING] } })
      .mockResolvedValueOnce({ ok: true, data: { status: "possible_match", matches: [EXISTING, LATER] } })
      .mockResolvedValueOnce({ ok: true, data: { status: "created", patient: patient() } });
    const props = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Create anyway" }));
    expect(vi.mocked(registerPatientAction).mock.calls[1]![0]).toMatchObject({ confirmedMatchIds: ["p-7"] });

    // A match the nurse hadn't seen: the card shows both and nothing is created yet.
    await screen.findByText("HN-2026-000009");
    expect(screen.getAllByRole("button", { name: "Use this record" })).toHaveLength(2);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Possible match" })));
    expect(props.onRegistered).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create anyway" }));
    expect(vi.mocked(registerPatientAction).mock.calls[2]![0]).toMatchObject({ confirmedMatchIds: ["p-7", "p-9"] });
    await waitFor(() => expect(props.onRegistered).toHaveBeenCalledWith(patient()));
  });

  it("shows a failed save in the alert region and enables Save again", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPatientAction).mockResolvedValue({
      ok: false,
      error: { code: "failed", message: "Couldn't register the patient. Try again." },
    });
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Couldn't register the patient. Try again."),
    );
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a network failure in the alert region and enables Save again", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPatientAction).mockRejectedValue(new Error("offline"));
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the server. Try again."),
    );
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports whether anything was typed", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <RegistrationForm
        initialName={{ lastName: "Reyes", firstName: "Ana" }}
        onRegistered={vi.fn()}
        onUseExisting={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await user.type(byLabel("Barangay"), "P");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.clear(byLabel("Barangay"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("limits the birthdate to 1900 through today", () => {
    renderForm();
    expect(byLabel("Birthdate").min).toBe("1900-01-01");
    expect(byLabel("Birthdate").max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("drops the Possible match card when the name changes", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPatientAction).mockResolvedValue({ ok: true, data: { status: "possible_match", matches: [EXISTING] } });
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Possible match" });
    await user.type(byLabel("First name"), "a");
    expect(screen.queryByRole("heading", { name: "Possible match" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("Esc and Cancel close the form", async () => {
    const user = userEvent.setup();
    const props = renderForm();
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("TriageWorkspace registration", () => {
  const setup = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const finder = () => document.getElementById(PATIENT_FINDER_INPUT_ID) as HTMLInputElement;

  async function openFromFinder(user: ReturnType<typeof setup>, q: string) {
    await user.type(finder(), q);
    await act(async () => {
      vi.advanceTimersByTime(FINDER_DELAY_MS);
    });
    await user.keyboard("{ArrowDown}{Enter}");
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it('opens the form from "New patient" with the name prefilled (Reyes, Ana)', async () => {
    const user = setup();
    render(<TriageWorkspace canRegister />);
    await openFromFinder(user, "Reyes, Ana");
    expect(screen.getByRole("heading", { name: "New patient" })).toBeTruthy();
    expect(byLabel("Last name").value).toBe("Reyes");
    expect(byLabel("First name").value).toBe("Ana");
    expect(screen.getByRole("button", { name: /More details/ }).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(byLabel("Female"));
  });

  it("Esc closes the form and returns focus to the finder", async () => {
    const user = setup();
    render(<TriageWorkspace canRegister />);
    await openFromFinder(user, "zzz");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("form", { name: "Register a new patient" })).toBeNull();
    expect(document.activeElement).toBe(finder());
    expect(screen.getByRole("heading", { name: "Selected patient" })).toBeTruthy();
  });

  it("selects the new patient, announces it and focuses the card heading", async () => {
    const user = setup();
    vi.mocked(registerPatientAction).mockResolvedValue({ ok: true, data: { status: "created", patient: patient() } });
    render(<TriageWorkspace canRegister />);
    await openFromFinder(user, "juan dela cruz");
    expect(byLabel("Last name").value).toBe("Dela Cruz");
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Registered DELA CRUZ, Juan · HN-2026-000043")).toBeTruthy());
    expect(screen.queryByRole("form", { name: "Register a new patient" })).toBeNull();
    expect(document.activeElement).toBe(document.getElementById(SELECTED_HEADING_ID));
    expect(screen.getAllByText("HN-2026-000043").length).toBeGreaterThan(0);
  });

  it("Use this record selects the existing patient", async () => {
    const user = setup();
    vi.mocked(registerPatientAction).mockResolvedValue({ ok: true, data: { status: "possible_match", matches: [EXISTING] } });
    render(<TriageWorkspace canRegister />);
    await openFromFinder(user, "juan dela cruz");
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Use this record" }));
    expect(screen.getByRole("heading", { name: "Selected patient" })).toBeTruthy();
    expect(screen.getByText("Selected DELA CRUZ, Juan.")).toBeTruthy();
    expect(document.activeElement).toBe(document.getElementById(SELECTED_HEADING_ID));
  });

  it("has no New patient row without the register permission", async () => {
    const user = setup();
    render(<TriageWorkspace canRegister={false} />);
    await user.type(finder(), "zzz");
    await act(async () => {
      vi.advanceTimersByTime(FINDER_DELAY_MS);
    });
    await user.keyboard("{ArrowDown}");
    expect(screen.queryByRole("option", { name: "New patient" })).toBeNull();
  });
});

describe("TriageWorkspace: discarding a half-filled registration", () => {
  const setup = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const finder = () => document.getElementById(PATIENT_FINDER_INPUT_ID) as HTMLInputElement;
  const OTHER = patient({ id: "p-3", hospitalNumber: "HN-2026-000003", name: "CRUZ, Miguel", lastName: "Cruz", firstName: "Miguel" });

  async function search(user: ReturnType<typeof setup>, q: string) {
    await user.clear(finder());
    await user.type(finder(), q);
    await act(async () => {
      vi.advanceTimersByTime(FINDER_DELAY_MS);
    });
  }

  async function openDirtyForm(user: ReturnType<typeof setup>) {
    render(<TriageWorkspace canRegister />);
    await search(user, "zzz");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(byLabel("Barangay"), "Poblacion");
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.mocked(searchPatientsAction).mockImplementation(async (input) => {
      const q = (input as { q: string }).q;
      const rows = q === "cruz" ? [OTHER] : [];
      return { ok: true, data: { q, rows, total: rows.length } };
    });
  });

  const form = () => screen.queryByRole("form", { name: "Register a new patient" });
  const dialog = () => screen.queryByRole("alertdialog", { name: "Discard this registration?" });

  it("asks on Esc; Keep editing returns to the field, Discard closes and focuses the finder", async () => {
    const user = setup();
    await openDirtyForm(user);
    await user.keyboard("{Escape}");
    expect(dialog()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(form()).toBeTruthy();
    expect(byLabel("Barangay").value).toBe("Poblacion");
    await waitFor(() => expect(document.activeElement).toBe(byLabel("Barangay")));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(form()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(finder()));
  });

  it("asks before a finder result replaces the form", async () => {
    const user = setup();
    await openDirtyForm(user);
    await user.click(finder());
    await search(user, "cruz");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(dialog()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(form()).toBeNull());
    expect(screen.getByRole("heading", { name: "Selected patient" })).toBeTruthy();
    expect(screen.getByText("CRUZ, Miguel", { selector: "p" })).toBeTruthy();
  });

  it("asks before New patient starts a fresh form", async () => {
    const user = setup();
    await openDirtyForm(user);
    await user.click(finder());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(dialog()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(byLabel("Barangay").value).toBe("Poblacion");
    await waitFor(() => expect(document.activeElement).toBe(finder()));

    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(byLabel("Barangay").value).toBe("");
  });

  it("does not ask when nothing was typed", async () => {
    const user = setup();
    render(<TriageWorkspace canRegister />);
    await search(user, "Reyes, Ana");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog()).toBeNull();
    expect(form()).toBeNull();
  });

  it("ignores a save that finishes after the form was closed", async () => {
    const user = setup();
    let resolve: (value: Awaited<ReturnType<typeof registerPatientAction>>) => void = () => {};
    vi.mocked(registerPatientAction).mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<TriageWorkspace canRegister />);
    await search(user, "juan dela cruz");
    await user.keyboard("{ArrowDown}{Enter}");
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(registerPatientAction).toHaveBeenCalledTimes(1);

    // Pick another patient while the save is in flight, and discard the form.
    await user.click(finder());
    await search(user, "cruz");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(form()).toBeNull());

    await act(async () => resolve({ ok: true, data: { status: "created", patient: patient() } }));
    expect(screen.queryByText(/^Registered /)).toBeNull();
    expect(screen.getByText("CRUZ, Miguel", { selector: "p" })).toBeTruthy();
    expect(document.activeElement).not.toBe(document.getElementById(SELECTED_HEADING_ID));
  });
});