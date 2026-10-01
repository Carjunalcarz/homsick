"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SLIP_MARKER_ATTRIBUTE, slipPath } from "@/lib/queue-number";

/*
 * Print slip (Story 3.6, UX-DR17): loads `/print/slip/{entryId}` in a hidden
 * iframe and calls `print()` on it once loaded, so the nurse never leaves
 * /triage. Pressing it again reprints (a fresh load). Nothing but the slip
 * page is printed: a load that isn't the slip (404, no access, sign-in) is
 * reported as a failure.
 */

export const PRINT_SLIP_ID = "triage-print-slip";
export const PRINT_SLIP_ERROR = "Couldn't load the slip. Try again.";
/** Give up on a load that never finishes. */
const LOAD_TIMEOUT_MS = 20_000;

type State = "idle" | "loading" | "error";

export function PrintSlipButton({ entryId, className }: { entryId: string; className?: string }) {
  const [state, setState] = useState<State>("idle");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  function cleanup() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    frameRef.current?.remove();
    frameRef.current = null;
  }

  // The last frame stays until the next print (removing it during print() can cancel the job) or unmount.
  useEffect(() => cleanup, []);

  function print() {
    if (state === "loading") return;
    cleanup();
    setState("loading");

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Queue slip";
    frame.dataset.printSlipFrame = "";
    // Not display:none: some browsers won't print a frame that isn't rendered.
    Object.assign(frame.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
      visibility: "hidden",
    });

    const fail = () => {
      if (frameRef.current !== frame) return;
      cleanup();
      setState("error");
    };

    frame.addEventListener("load", () => {
      if (frameRef.current !== frame) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      const win = frame.contentWindow;
      let isSlip = false;
      try {
        isSlip = frame.contentDocument?.querySelector(`[${SLIP_MARKER_ATTRIBUTE}]`) != null;
      } catch {
        isSlip = false;
      }
      if (!win || !isSlip) {
        fail();
        return;
      }
      setState("idle");
      try {
        win.print();
      } catch {
        fail();
        return;
      }
      // Back on the button, so Enter reprints.
      buttonRef.current?.focus();
    });
    frame.addEventListener("error", fail);

    frame.src = slipPath(entryId);
    frameRef.current = frame;
    timerRef.current = setTimeout(fail, LOAD_TIMEOUT_MS);
    document.body.appendChild(frame);
  }

  const loading = state === "loading";
  return (
    <div className="flex flex-col gap-1">
      <Button
        ref={buttonRef}
        id={PRINT_SLIP_ID}
        type="button"
        className={className}
        aria-disabled={loading || undefined}
        aria-describedby={state === "error" ? `${PRINT_SLIP_ID}-error` : undefined}
        onClick={print}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Printer aria-hidden="true" />
        )}
        {loading ? "Preparing…" : "Print slip"}
      </Button>
      {state === "error" && (
        <p id={`${PRINT_SLIP_ID}-error`} role="alert" className="text-sm font-medium">
          {PRINT_SLIP_ERROR}
        </p>
      )}
    </div>
  );
}
