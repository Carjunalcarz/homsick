// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEADER_SEARCH_ID,
  isSearchShortcut,
  PATIENT_FINDER_INPUT_ID,
  searchShortcutTargets,
} from "@/lib/keyboard-shortcuts";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { SearchShortcut } = await import("./search-shortcut");

/** jsdom has no layout: an input counts as shown unless marked `data-hidden`. */
const realRects = HTMLElement.prototype.getClientRects;
beforeEach(() => {
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    return (this.dataset.hidden ? [] : [{}]) as unknown as DOMRectList;
  };
});
afterEach(() => {
  HTMLElement.prototype.getClientRects = realRects;
  cleanup();
});

function page({ finder = true, headerHidden = false } = {}) {
  render(
    <>
      <SearchShortcut />
      <input id={HEADER_SEARCH_ID} aria-label="Search patients" data-hidden={headerHidden ? "1" : undefined} />
      {finder && <input id={PATIENT_FINDER_INPUT_ID} aria-label="Find patient" />}
      <button type="button">elsewhere</button>
    </>,
  );
  return {
    header: document.getElementById(HEADER_SEARCH_ID)!,
    finder: document.getElementById(PATIENT_FINDER_INPUT_ID),
  };
}

const ctrlK = () => fireEvent.keyDown(document, { key: "k", ctrlKey: true });

describe("isSearchShortcut", () => {
  it("is Ctrl+K or ⌘K only", () => {
    const key = (init: Partial<KeyboardEvent>) =>
      isSearchShortcut({ key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
    expect(key({ ctrlKey: true })).toBe(true);
    expect(key({ metaKey: true })).toBe(true);
    expect(key({ key: "K", ctrlKey: true })).toBe(true);
    expect(key({})).toBe(false);
    expect(key({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(key({ ctrlKey: true, key: "j" })).toBe(false);
  });

  it("targets the finder on /triage, the header search elsewhere", () => {
    expect(searchShortcutTargets("/triage")).toEqual([PATIENT_FINDER_INPUT_ID, HEADER_SEARCH_ID]);
    expect(searchShortcutTargets("/patients")).toEqual([HEADER_SEARCH_ID]);
    expect(searchShortcutTargets("/triage-old")).toEqual([HEADER_SEARCH_ID]);
  });
});

describe("SearchShortcut", () => {
  it("focuses the Patient finder on /triage", () => {
    nav.pathname = "/triage";
    const { finder } = page();
    expect(ctrlK()).toBe(false); // default prevented
    expect(document.activeElement).toBe(finder);
  });

  it("focuses the header search elsewhere, even when a finder is on the page", () => {
    nav.pathname = "/patients";
    const { header } = page();
    ctrlK();
    expect(document.activeElement).toBe(header);
  });

  it("leaves the key to the browser when the header search is hidden", () => {
    nav.pathname = "/";
    page({ finder: false, headerHidden: true });
    expect(ctrlK()).toBe(true); // not prevented
    expect(document.activeElement).toBe(document.body);
  });
});
