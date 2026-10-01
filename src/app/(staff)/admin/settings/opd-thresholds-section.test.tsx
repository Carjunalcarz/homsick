// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/settings/actions", () => ({ updateOpdThresholdsAction: vi.fn() }));

const { updateOpdThresholdsAction } = await import("@/server/settings/actions");
const { OpdThresholdsSection } = await import("./opd-thresholds-section");

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
  vi.mocked(updateOpdThresholdsAction).mockReset();
});

const THRESHOLDS = { prenatalTarget: 8, noShowThreshold: 3, preCloseWarningMinutes: 30, hospitalName: "Hospital OPD" };
const LABEL = "Hospital name (printed on slips)";

describe("OpdThresholdsSection: hospital name (Story 3.6)", () => {
  it("shows the hospital name and sends an edit with the thresholds", async () => {
    vi.mocked(updateOpdThresholdsAction).mockResolvedValue({ ok: true, data: { changed: true } });
    const user = userEvent.setup();
    render(<OpdThresholdsSection thresholds={THRESHOLDS} canManage />);
    expect(screen.getByText(LABEL)).toBeTruthy();
    expect(screen.getByText("Hospital OPD")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const field = (await screen.findByLabelText(LABEL)) as HTMLInputElement;
    expect(field.value).toBe("Hospital OPD");
    expect(field.maxLength).toBe(80);
    await user.clear(field);
    await user.type(field, "Ospital ng Maynila");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateOpdThresholdsAction).toHaveBeenCalledWith({
        prenatalTarget: "8",
        noShowThreshold: "3",
        preCloseWarningMinutes: "30",
        hospitalName: "Ospital ng Maynila",
      }),
    );
    expect(await screen.findByText("Queue and prenatal settings saved.")).toBeTruthy();
  });

  it("ties a refused name's error to the field and focuses it", async () => {
    vi.mocked(updateOpdThresholdsAction).mockResolvedValue({
      ok: false,
      error: {
        code: "invalid",
        message: "Check the highlighted fields.",
        fieldErrors: { hospitalName: "Hospital name must be 2–80 characters." },
      },
    });
    const user = userEvent.setup();
    render(<OpdThresholdsSection thresholds={THRESHOLDS} canManage />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const field = (await screen.findByLabelText(LABEL)) as HTMLInputElement;
    await user.clear(field);
    await user.type(field, "H");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const error = await screen.findByText("Hospital name must be 2–80 characters.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(error.id);
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("shows the name read-only without Edit for a non-Admin", () => {
    render(<OpdThresholdsSection thresholds={THRESHOLDS} canManage={false} />);
    expect(screen.getByText("Hospital OPD")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });
});
