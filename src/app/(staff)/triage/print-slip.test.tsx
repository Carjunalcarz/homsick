// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SLIP_MARKER_ATTRIBUTE } from "@/lib/queue-number";
import { PRINT_SLIP_ERROR, PRINT_SLIP_ID, PrintSlipButton } from "./print-slip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const frames = () => [...document.querySelectorAll<HTMLIFrameElement>("iframe[data-print-slip-frame]")];

/** Finish loading the hidden frame: with the slip page's content (or not), and a mocked print(). */
function loadFrame(frame: HTMLIFrameElement, { slip = true } = {}) {
  const print = vi.fn();
  Object.defineProperty(frame.contentWindow!, "print", { value: print, configurable: true });
  const doc = frame.contentDocument!;
  // jsdom doesn't load the src: the frame's document starts empty.
  const root = doc.documentElement ?? doc.appendChild(doc.createElement("html"));
  root.innerHTML = slip
    ? `<body><article ${SLIP_MARKER_ATTRIBUTE}=""><p>CN-014</p></article></body>`
    : "<body><h1>This page could not be found.</h1></body>";
  act(() => {
    fireEvent.load(frame);
  });
  return print;
}

describe("PrintSlipButton", () => {
  it("loads the slip in a hidden iframe and prints it once loaded, staying on the page", async () => {
    const user = userEvent.setup();
    render(<PrintSlipButton entryId="qe-1" />);
    await user.click(screen.getByRole("button", { name: "Print slip" }));

    const [frame] = frames();
    expect(frame).toBeTruthy();
    expect(new URL(frame!.src).pathname).toBe("/print/slip/qe-1");
    expect(frame!.getAttribute("aria-hidden")).toBe("true");
    expect(frame!.style.width).toBe("0px");
    // Until it loads: "Preparing…", and a second press does nothing.
    const button = document.getElementById(PRINT_SLIP_ID)!;
    expect(button.textContent).toBe("Preparing…");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.click(button);
    expect(frames()).toHaveLength(1);

    const print = loadFrame(frame!);
    expect(print).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Print slip");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reprints with a fresh frame when pressed again", async () => {
    const user = userEvent.setup();
    render(<PrintSlipButton entryId="qe-1" />);
    await user.click(screen.getByRole("button", { name: "Print slip" }));
    const first = frames()[0]!;
    expect(loadFrame(first)).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Print slip" }));
    const all = frames();
    expect(all).toHaveLength(1);
    expect(all[0]).not.toBe(first);
    expect(loadFrame(all[0]!)).toHaveBeenCalledTimes(1);
  });

  it("says it couldn't load the slip when the frame loads something else (404, no access)", async () => {
    const user = userEvent.setup();
    render(<PrintSlipButton entryId="nope" />);
    await user.click(screen.getByRole("button", { name: "Print slip" }));
    const print = loadFrame(frames()[0]!, { slip: false });
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(PRINT_SLIP_ERROR);
    expect(frames()).toHaveLength(0);
    // Try again works.
    await user.click(screen.getByRole("button", { name: "Print slip" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadFrame(frames()[0]!)).toHaveBeenCalledTimes(1);
  });

  it("says it couldn't load the slip on a frame error or when loading never finishes", async () => {
    const user = userEvent.setup();
    render(<PrintSlipButton entryId="qe-1" />);
    await user.click(screen.getByRole("button", { name: "Print slip" }));
    act(() => {
      fireEvent.error(frames()[0]!);
    });
    expect(screen.getByRole("alert").textContent).toBe(PRINT_SLIP_ERROR);

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Print slip" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole("alert").textContent).toBe(PRINT_SLIP_ERROR);
    expect(frames()).toHaveLength(0);
  });

  it("removes its frame on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PrintSlipButton entryId="qe-1" />);
    await user.click(screen.getByRole("button", { name: "Print slip" }));
    expect(frames()).toHaveLength(1);
    unmount();
    expect(frames()).toHaveLength(0);
  });
});
