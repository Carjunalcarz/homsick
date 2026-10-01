// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/settings/actions", () => ({ updateUrgencyLevelsAction: vi.fn() }));

const { updateUrgencyLevelsAction } = await import("@/server/settings/actions");
const { UrgencyLevelsSection } = await import("./urgency-levels-section");

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
  vi.mocked(updateUrgencyLevelsAction).mockReset();
});

// jsdom joins "Edit" and the sr-only " Urgency Levels" without the space; browsers keep it.
const EDIT = /^Edit\s*Urgency Levels$/;

const LEVELS = [
  { id: "l-urgent", name: "Urgent", isEr: false, rank: 1 },
  { id: "l-routine", name: "Routine", isEr: false, rank: 2 },
  { id: "l-er", name: "Emergency", isEr: true, rank: null },
];

describe("UrgencyLevelsSection form", () => {
  it("puts a server error keyed levels.3.rank on the 4th row's rank input", async () => {
    vi.mocked(updateUrgencyLevelsAction).mockResolvedValue({
      ok: false,
      error: { code: "rank_taken", message: "Rank already used", fieldErrors: { "levels.3.rank": "Rank already used" } },
    });
    const user = userEvent.setup();
    render(<UrgencyLevelsSection levels={LEVELS} canManage />);

    await user.click(screen.getByRole("button", { name: EDIT }));
    await user.click(await screen.findByRole("button", { name: "Add level" }));
    await user.type(screen.getAllByLabelText("Name")[3]!, "Semi-urgent");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateUrgencyLevelsAction).toHaveBeenCalledTimes(1));
    const ranks = screen.getAllByLabelText("Rank");
    await waitFor(() => expect(ranks[3]!.getAttribute("aria-invalid")).toBe("true"));
    for (const other of [ranks[0], ranks[1], ranks[2]]) expect(other!.getAttribute("aria-invalid")).toBeNull();
    const errorIds = (ranks[3]!.getAttribute("aria-describedby") ?? "").split(" ");
    const error = errorIds.map((id) => document.getElementById(id)).find((el) => el?.id.endsWith("-rank-error"));
    expect(error?.textContent).toBe("Rank already used");
  });

  it("prefills the lowest free rank when adding a level and when unticking ER", async () => {
    const user = userEvent.setup();
    render(<UrgencyLevelsSection levels={LEVELS} canManage />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    await user.click(await screen.findByRole("button", { name: "Add level" }));
    expect((screen.getAllByLabelText("Rank")[3] as HTMLInputElement).value).toBe("3");
    await user.click(screen.getAllByLabelText("ER")[2]!);
    expect((screen.getAllByLabelText("Rank")[2] as HTMLInputElement).value).toBe("4");
  });
});
