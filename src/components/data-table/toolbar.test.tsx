// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTableToolbar, SEARCH_DELAY_MS, type DataTableFilter } from "./toolbar";

/** Every navigation, as "replace <href>" or "push <href>", in order. */
const router = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    replace: (href: string) => calls.push(`replace ${href}`),
    push: (href: string) => calls.push(`push ${href}`),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeAll(() => {
  // Testing Library drains pending work with a setTimeout(0) and advances it
  // only when it sees Jest's fake timers; point it at Vitest's.
  (globalThis as { jest?: unknown }).jest = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };
  // Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.setPointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  // Only the debounce timer: React and Testing Library keep their real scheduling.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  router.calls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function roleFilter(value = "all"): DataTableFilter {
  return {
    name: "role",
    label: "Role",
    defaultValue: "all",
    value,
    options: [
      { value: "all", label: "All" },
      { value: "admin", label: "Admin" },
      { value: "triage_nurse", label: "Triage Nurse" },
    ],
  };
}

function toolbar(q: string, role = "all") {
  return (
    <DataTableToolbar
      basePath="/admin/staff"
      id="staff"
      label="Filter staff"
      searchPlaceholder="Name or username"
      q={q}
      filters={[roleFilter(role)]}
    />
  );
}

const setup = () => userEvent.setup({ delay: null });
const searchBox = () => screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
const pushed = () => [...router.calls];

describe("DataTableToolbar", () => {
  it("replaces the URL with the search once, after the debounce", async () => {
    const user = setup();
    render(toolbar(""));
    await user.type(searchBox(), "joy");
    expect(pushed()).toEqual([]);
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS - 1));
    expect(pushed()).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(pushed()).toEqual(["replace /admin/staff?q=joy"]);
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 3));
    expect(pushed()).toHaveLength(1);
  });

  it("keeps what is being typed when its own earlier search lands in the URL", async () => {
    const user = setup();
    const { rerender } = render(toolbar(""));
    await user.type(searchBox(), "jo");
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(pushed()).toEqual(["replace /admin/staff?q=jo"]);

    await user.type(searchBox(), "y s");
    // The URL now says "jo" (the page re-rendered with it) while "joy s" is typed.
    rerender(toolbar("jo"));
    expect(searchBox().value).toBe("joy s");
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(pushed()).toEqual(["replace /admin/staff?q=jo", "replace /admin/staff?q=joy+s"]);
  });

  it("pushes the trimmed search with page 1 when a filter changes", async () => {
    const user = setup();
    render(toolbar(""));
    await user.type(searchBox(), "  ana ");
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    // A history entry at once, not after the debounce; page 1 is the default and left out.
    expect(pushed()).toEqual(["push /admin/staff?q=ana&role=admin"]);
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
    expect(pushed()).toHaveLength(1);
  });

  it("clears the search and filters", async () => {
    const user = setup();
    render(toolbar("ana", "admin"));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(pushed()).toEqual(["push /admin/staff"]);
    expect(searchBox().value).toBe("");
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
    expect(pushed()).toHaveLength(1);
  });

  describe("date filters", () => {
    function auditToolbar(q: string, from = "", to = "") {
      return (
        <DataTableToolbar
          basePath="/admin/audit"
          id="audit"
          label="Filter audit log"
          q={q}
          filters={[roleFilter()]}
          dateFilters={[
            { name: "from", label: "From", value: from },
            { name: "to", label: "To", value: to },
          ]}
        />
      );
    }
    const dateInput = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

    it("labels each date input", () => {
      render(auditToolbar(""));
      expect(dateInput("From").type).toBe("date");
      expect(dateInput("To").type).toBe("date");
    });

    it("pushes a picked date once, after the debounce, with the trimmed search", async () => {
      const user = setup();
      render(auditToolbar(""));
      await user.type(searchBox(), " joy ");
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-27" } });
      expect(dateInput("From").value).toBe("2026-09-27");
      expect(pushed()).toEqual([]);
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS - 1));
      expect(pushed()).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      // One history entry carrying both the search and the date, back on page 1.
      expect(pushed()).toEqual(["push /admin/audit?q=joy&from=2026-09-27"]);
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 3));
      expect(pushed()).toHaveLength(1);
    });

    it("pushes once for several quick segment changes", () => {
      render(auditToolbar("", "", "2026-09-28"));
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-01" } });
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS - 50));
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-02" } });
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS - 50));
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-27" } });
      expect(pushed()).toEqual([]);
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(pushed()).toEqual(["push /admin/audit?from=2026-09-27&to=2026-09-28"]);
    });

    it("never pushes a year still being typed", () => {
      render(auditToolbar("", "", "2026-09-28"));
      fireEvent.change(dateInput("From"), { target: { value: "0202-09-27" } });
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
      expect(pushed()).toEqual([]);
      expect(dateInput("From").value).toBe("0202-09-27");
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-27" } });
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(pushed()).toEqual(["push /admin/audit?from=2026-09-27&to=2026-09-28"]);
    });

    it("pushes a cleared date after the debounce", () => {
      render(auditToolbar("", "2026-09-27", "2026-09-28"));
      fireEvent.change(dateInput("To"), { target: { value: "" } });
      expect(pushed()).toEqual([]);
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(pushed()).toEqual(["push /admin/audit?from=2026-09-27"]);
    });

    it("keeps a date being typed when its own push lands in the URL", () => {
      const { rerender } = render(auditToolbar("", ""));
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-27" } });
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
      fireEvent.change(dateInput("To"), { target: { value: "2026-09-28" } });
      rerender(auditToolbar("", "2026-09-27"));
      expect(dateInput("To").value).toBe("2026-09-28");
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
      expect(pushed()).toEqual([
        "push /admin/audit?from=2026-09-27",
        "push /admin/audit?from=2026-09-27&to=2026-09-28",
      ]);
    });

    it("sends a pending date along with a select change, without a second push", async () => {
      const user = setup();
      render(auditToolbar(""));
      fireEvent.change(dateInput("From"), { target: { value: "2026-09-27" } });
      await user.click(screen.getByRole("combobox", { name: "Role" }));
      await user.click(await screen.findByRole("option", { name: "Admin" }));
      expect(pushed()).toEqual(["push /admin/audit?role=admin&from=2026-09-27"]);
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
      expect(pushed()).toHaveLength(1);
    });

    it("counts dates as filters, and Clear resets them", async () => {
      const user = setup();
      render(auditToolbar("", "2026-09-27"));
      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      // At once, not after the debounce.
      expect(pushed()).toEqual(["push /admin/audit"]);
      expect(dateInput("From").value).toBe("");
      expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
      expect(pushed()).toHaveLength(1);
    });

    it("keeps the dates when a select changes", async () => {
      const user = setup();
      render(auditToolbar("", "2026-09-26", "2026-09-28"));
      await user.click(screen.getByRole("combobox", { name: "Role" }));
      await user.click(await screen.findByRole("option", { name: "Admin" }));
      expect(pushed()).toEqual(["push /admin/audit?role=admin&from=2026-09-26&to=2026-09-28"]);
    });

    it("follows an outside URL change", () => {
      const { rerender } = render(auditToolbar("", "2026-09-27"));
      rerender(auditToolbar("", "", "2026-09-30"));
      expect(dateInput("From").value).toBe("");
      expect(dateInput("To").value).toBe("2026-09-30");
      act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
      expect(pushed()).toEqual([]);
    });
  });

  it("follows an outside URL change (back/forward or a link)", () => {
    const { rerender } = render(toolbar("joy", "admin"));
    expect(searchBox().value).toBe("joy");
    rerender(toolbar("ana", "triage_nurse"));
    expect(searchBox().value).toBe("ana");
    expect(screen.getByRole("combobox", { name: "Role" }).textContent).toContain("Triage Nurse");
    // Following the URL is not a new search.
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
    expect(pushed()).toEqual([]);
  });
});
