// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEADER_SEARCH_ID, PATIENT_FINDER_INPUT_ID } from "@/lib/keyboard-shortcuts";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
// next/form needs the App Router context; a plain form keeps the real input inside.
vi.mock("next/form", () => ({
  default: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement> & { action: string }) => (
    <form {...props}>{children}</form>
  ),
}));
vi.mock("@/server/auth/session", () => ({ requireStaff: vi.fn() }));
vi.mock("@/server/auth/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/server/patients/actions", () => ({ searchPatientsAction: vi.fn() }));

const { AppHeader } = await import("./app-header");
const { PatientFinder } = await import("@/app/(staff)/triage/patient-finder");

/** jsdom has no layout: every element counts as shown. */
const realRects = HTMLElement.prototype.getClientRects;
beforeEach(() => {
  HTMLElement.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});
afterEach(() => {
  HTMLElement.prototype.getClientRects = realRects;
  cleanup();
});

const user = { name: "Joy Santos", role: "triage_nurse" };
const ctrlK = () => fireEvent.keyDown(document, { key: "k", ctrlKey: true });

describe("AppHeader", () => {
  it("mounts the Ctrl+K shortcut, which reaches the real header search", () => {
    nav.pathname = "/patients";
    render(<AppHeader user={user} />);
    const header = screen.getByRole("searchbox", { name: "Search patients" });
    expect(header.id).toBe(HEADER_SEARCH_ID);
    expect(ctrlK()).toBe(false);
    expect(document.activeElement).toBe(header);
  });

  it("sends Ctrl+K to the real Patient finder on /triage", () => {
    nav.pathname = "/triage";
    render(
      <>
        <AppHeader user={user} />
        <PatientFinder onSelect={vi.fn()} />
      </>,
    );
    const finder = screen.getByRole("combobox", { name: "Find patient" });
    expect(finder.id).toBe(PATIENT_FINDER_INPUT_ID);
    ctrlK();
    expect(document.activeElement).toBe(finder);
  });
});
