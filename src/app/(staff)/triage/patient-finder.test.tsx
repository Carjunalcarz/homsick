// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatientFinderRow } from "@/server/patients/actions";

vi.mock("@/server/patients/actions", () => ({ searchPatientsAction: vi.fn() }));

const { searchPatientsAction } = await import("@/server/patients/actions");
const { FINDER_DELAY_MS, NEW_PATIENT_OPTION_ID, PatientFinder } = await import("./patient-finder");

function row(n: number, name: string): PatientFinderRow {
  return {
    id: `p-${n}`,
    hospitalNumber: `HN-2026-${String(n).padStart(6, "0")}`,
    lastName: name.split(",")[0]!,
    firstName: "X",
    middleName: null,
    suffix: null,
    name,
    sex: n % 2 ? "male" : "female",
    birthdate: "1985-04-12",
    age: 41,
    lastVisit: null,
  };
}

const CRUZ = [row(1, "CRUZ, Jose Bautista Jr."), row(2, "CRUZ, Miguel"), row(3, "DELA CRUZ, Juan Santos")];

beforeAll(() => {
  // Testing Library drains pending work with a setTimeout(0) and advances it
  // only when it sees Jest's fake timers; point it at Vitest's.
  (globalThis as { jest?: unknown }).jest = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(searchPatientsAction).mockReset();
  vi.mocked(searchPatientsAction).mockImplementation(async (input) => {
    const q = (input as { q: string }).q;
    const rows = q === "cruz" ? CRUZ : [];
    return { ok: true, data: { q, rows, total: rows.length } };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = () => userEvent.setup({ delay: null });
const combobox = () => screen.getByRole("combobox", { name: "Find patient" }) as HTMLInputElement;

/** Let the debounce fire and the action's promise settle. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(FINDER_DELAY_MS);
  });
}

function renderFinder() {
  const onSelect = vi.fn();
  render(<PatientFinder onSelect={onSelect} />);
  return onSelect;
}

describe("PatientFinder", () => {
  it("searches once, 300 ms after the last keystroke", async () => {
    const user = setup();
    renderFinder();
    await user.type(combobox(), "cruz");
    expect(searchPatientsAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(FINDER_DELAY_MS - 1));
    expect(searchPatientsAction).not.toHaveBeenCalled();
    await settle();
    expect(searchPatientsAction).toHaveBeenCalledTimes(1);
    expect(searchPatientsAction).toHaveBeenCalledWith({ q: "cruz" });
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toContain("3 patients found.");
  });

  it("shows name, age, sex, Hospital Number and No visits in each result", async () => {
    const user = setup();
    renderFinder();
    await user.type(combobox(), "cruz");
    await settle();
    const first = screen.getAllByRole("option")[0]!;
    expect(first.textContent).toContain("CRUZ, Jose Bautista Jr.");
    expect(first.textContent).toContain("41 y");
    expect(first.textContent).toContain("Male");
    expect(first.textContent).toContain("HN-2026-000001");
    expect(first.textContent).toContain("No visits");
  });

  it("wires the combobox to the listbox and the highlighted option", async () => {
    const user = setup();
    renderFinder();
    const input = combobox();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    await user.type(input, "cruz");
    await settle();
    const listbox = screen.getByRole("listbox", { name: "Matching patients" });
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);

    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[2]!.id);

    await user.keyboard("{ArrowUp}");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(options[2]!.getAttribute("aria-selected")).toBe("false");
  });

  it("↓ ↓ Enter selects the second match", async () => {
    const user = setup();
    const onSelect = renderFinder();
    await user.type(combobox(), "cruz");
    await settle();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(CRUZ[1]);
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("Selected CRUZ, Miguel.");
  });

  it("Enter without a highlight selects nothing", async () => {
    const user = setup();
    const onSelect = renderFinder();
    await user.type(combobox(), "cruz");
    await settle();
    await user.keyboard("{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Esc clears the query and the results", async () => {
    const user = setup();
    renderFinder();
    await user.type(combobox(), "cruz");
    await settle();
    await user.keyboard("{ArrowDown}{Escape}");
    expect(combobox().value).toBe("");
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(combobox().hasAttribute("aria-activedescendant")).toBe(false);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("says when nothing matches, with suggestions", async () => {
    const user = setup();
    renderFinder();
    await user.type(combobox(), "zzz");
    await settle();
    expect(screen.getByRole("status").textContent).toContain('No patients match "zzz".');
    expect(screen.getByText(/YYYY-MM-DD or MM\/DD\/YYYY/)).toBeTruthy();
  });

  it("ignores an answer for an older query", async () => {
    const user = setup();
    let resolveFirst: (value: Awaited<ReturnType<typeof searchPatientsAction>>) => void = () => {};
    vi.mocked(searchPatientsAction).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    renderFinder();
    await user.type(combobox(), "cru");
    act(() => vi.advanceTimersByTime(FINDER_DELAY_MS));
    await user.type(combobox(), "z");
    await settle();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await act(async () => resolveFirst({ ok: true, data: { q: "cru", rows: [row(9, "OLD, Result")], total: 1 } }));
    expect(screen.queryByText("OLD, Result")).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("does not search an empty query", async () => {
    const user = setup();
    renderFinder();
    await user.type(combobox(), "   ");
    await settle();
    expect(searchPatientsAction).not.toHaveBeenCalled();
  });

  it("closes the list when focus leaves the combobox, but not on an option click", async () => {
    const user = setup();
    const onSelect = vi.fn();
    render(
      <>
        <PatientFinder onSelect={onSelect} />
        <button type="button">Next field</button>
      </>,
    );
    await user.type(combobox(), "cruz");
    await settle();
    await user.click(screen.getAllByRole("option")[2]!);
    expect(onSelect).toHaveBeenCalledWith(CRUZ[2]);
    expect(document.activeElement).toBe(combobox());

    await user.keyboard("{ArrowDown}");
    expect(combobox().getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Next field" }));
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(combobox().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("links to all results on /patients when more than 8 match", async () => {
    const user = setup();
    vi.mocked(searchPatientsAction).mockImplementation(async (input) => {
      const q = (input as { q: string }).q;
      return { ok: true, data: { q, rows: CRUZ, total: 27 } };
    });
    renderFinder();
    await user.type(combobox(), "dela cruz");
    await settle();
    const link = screen.getByRole("link", { name: "See all 27 results" });
    expect(link.getAttribute("href")).toBe("/patients?q=dela+cruz");
  });

  it("has no See all link when every match is shown", async () => {
    const user = setup();
    renderFinder();
    await user.type(combobox(), "cruz");
    await settle();
    expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
  });

  describe("New patient row", () => {
    function renderWithNew() {
      const onSelect = vi.fn();
      const onNewPatient = vi.fn();
      render(<PatientFinder onSelect={onSelect} onNewPatient={onNewPatient} />);
      return { onSelect, onNewPatient };
    }

    it("is the last option after the results, reachable with ↓ and Enter", async () => {
      const user = setup();
      const { onSelect, onNewPatient } = renderWithNew();
      await user.type(combobox(), "cruz");
      await settle();
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(4);
      expect(options[3]!.textContent).toBe("New patient");
      expect(options[3]!.id).toBe(NEW_PATIENT_OPTION_ID);

      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(combobox().getAttribute("aria-activedescendant")).toBe(NEW_PATIENT_OPTION_ID);
      expect(options[3]!.getAttribute("aria-selected")).toBe("true");
      await user.keyboard("{Enter}");
      expect(onNewPatient).toHaveBeenCalledWith("cruz");
      expect(onSelect).not.toHaveBeenCalled();
      expect(combobox().getAttribute("aria-expanded")).toBe("false");
    });

    it("is the only option when nothing matches", async () => {
      const user = setup();
      const { onNewPatient } = renderWithNew();
      await user.type(combobox(), "Reyes, Ana");
      await settle();
      const options = screen.getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual(["New patient"]);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onNewPatient).toHaveBeenCalledWith("Reyes, Ana");
    });

    it("opens on ↓ with an empty query, and not before", async () => {
      const user = setup();
      const { onNewPatient } = renderWithNew();
      await user.click(combobox());
      expect(combobox().getAttribute("aria-expanded")).toBe("false");
      await user.keyboard("{ArrowDown}");
      expect(combobox().getAttribute("aria-expanded")).toBe("true");
      await user.keyboard("{Enter}");
      expect(onNewPatient).toHaveBeenCalledWith("");
    });

    it("can be clicked", async () => {
      const user = setup();
      const { onNewPatient } = renderWithNew();
      await user.type(combobox(), "zzz");
      await settle();
      await user.click(screen.getByRole("option", { name: "New patient" }));
      expect(onNewPatient).toHaveBeenCalledWith("zzz");
    });

    it("is not shown without the register permission (e.g. Facility Staff)", async () => {
      const user = setup();
      renderFinder();
      await user.type(combobox(), "cruz");
      await settle();
      expect(screen.queryByRole("option", { name: "New patient" })).toBeNull();
      await user.clear(combobox());
      await user.type(combobox(), "zzz");
      await settle();
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
  });
});