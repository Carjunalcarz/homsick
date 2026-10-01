// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/settings/actions", () => ({ setPriorityCategoryEnabledAction: vi.fn() }));

const { setPriorityCategoryEnabledAction } = await import("@/server/settings/actions");
const { PriorityCategoriesSection } = await import("./priority-categories-section");

beforeAll(() => {
  // Radix uses pointer capture and scrollIntoView, which jsdom lacks.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.setPointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.mocked(setPriorityCategoryEnabledAction).mockReset();
});

const CATEGORIES = [
  { id: "c-senior", name: "Senior Citizen", legalBasis: "RA 9994", legallyRequired: true, enabled: true },
  { id: "c-pwd", name: "PWD", legalBasis: "RA 10754", legallyRequired: true, enabled: true },
  { id: "c-pregnant", name: "Pregnant", legalBasis: "Hospital policy", legallyRequired: false, enabled: true },
];

describe("PriorityCategoriesSection", () => {
  it("asks before turning off a legally required category, then sends confirmLegal", async () => {
    vi.mocked(setPriorityCategoryEnabledAction).mockResolvedValue({ ok: true, data: { changed: true } });
    const user = userEvent.setup();
    render(<PriorityCategoriesSection categories={CATEGORIES} canManage />);

    await user.click(screen.getByRole("switch", { name: "PWD" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Turn off PWD priority?");
    expect(dialog.textContent).toContain("Legally required (RA 9994 / RA 10754)");
    expect(setPriorityCategoryEnabledAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Turn off PWD" }));
    await waitFor(() =>
      expect(setPriorityCategoryEnabledAction).toHaveBeenCalledWith({ id: "c-pwd", enabled: false, confirmLegal: true }),
    );
  });

  it("turns off Pregnant directly, without a dialog", async () => {
    vi.mocked(setPriorityCategoryEnabledAction).mockResolvedValue({ ok: true, data: { changed: true } });
    const user = userEvent.setup();
    render(<PriorityCategoriesSection categories={CATEGORIES} canManage />);

    await user.click(screen.getByRole("switch", { name: "Pregnant" }));
    await waitFor(() =>
      expect(setPriorityCategoryEnabledAction).toHaveBeenCalledWith({
        id: "c-pregnant",
        enabled: false,
        confirmLegal: false,
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
