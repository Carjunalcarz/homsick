import { describe, expect, it } from "vitest";
import {
  initialToolbarState,
  pendingSearch,
  RECENT_PUSH_LIMIT,
  recordPush,
  sameUrlValues,
  syncToolbarState,
  type ToolbarState,
} from "@/components/data-table/toolbar-state";

const url = (q: string, role = "all") => ({ q, filters: { role } });

const state = (overrides: Partial<ToolbarState>): ToolbarState => ({
  q: "",
  filters: { role: "all" },
  syncedQ: "",
  recentPushes: [],
  ...overrides,
});

describe("initialToolbarState", () => {
  it("starts from the URL with nothing pending", () => {
    const initial = initialToolbarState(url("ana", "nurse"));
    expect(initial).toEqual({
      q: "ana",
      filters: { role: "nurse" },
      syncedQ: "ana",
      recentPushes: [],
    });
    expect(pendingSearch(initial)).toBeNull();
  });
});

describe("sameUrlValues", () => {
  it("compares by value", () => {
    expect(sameUrlValues(url("a"), url("a"))).toBe(true);
    expect(sameUrlValues(url("a"), url("b"))).toBe(false);
    expect(sameUrlValues(url("a", "nurse"), url("a", "admin"))).toBe(false);
    expect(sameUrlValues({ q: "", filters: {} }, url(""))).toBe(false);
  });
});

describe("recordPush", () => {
  it("marks the text as synced and remembers it", () => {
    const next = recordPush(state({ q: "ana" }), "ana");
    expect(next.syncedQ).toBe("ana");
    expect(next.recentPushes).toEqual(["ana"]);
    expect(pendingSearch(next)).toBeNull();
  });

  it(`keeps only the last ${RECENT_PUSH_LIMIT} pushes`, () => {
    let current = state({});
    for (const text of ["a", "b", "c", "d", "e", "f", "g"]) current = recordPush(current, text);
    expect(current.recentPushes).toEqual(["c", "d", "e", "f", "g"]);
  });
});

describe("syncToolbarState", () => {
  it("follows an outside change (back/forward or a link)", () => {
    const initial = initialToolbarState(url("ana", "nurse"));
    expect(syncToolbarState(initial, url("ben", "admin"))).toEqual({
      q: "ben",
      filters: { role: "admin" },
      syncedQ: "ben",
      recentPushes: [],
    });
  });

  it("clears the search box when going back to an unfiltered URL", () => {
    expect(syncToolbarState(initialToolbarState(url("ana")), url("")).q).toBe("");
  });

  it("keeps in-progress typing when its own debounced push lands", () => {
    // Pushed "an", the user kept typing "ana", then the URL catches up to "an".
    const typing = recordPush(state({ q: "ana" }), "an");
    const next = syncToolbarState(typing, url("an"));
    expect(next.q).toBe("ana");
    expect(pendingSearch(next)).toBe("ana");
  });

  it("keeps in-progress typing when an older own push lands after a newer one", () => {
    // Pushed "a", then "an"; the user is typing "ana" when the URL for "a" lands late.
    const typing = recordPush(recordPush(state({ q: "ana" }), "a"), "an");
    const next = syncToolbarState(typing, url("a"));
    expect(next.q).toBe("ana");
    expect(next.syncedQ).toBe("an");
    expect(pendingSearch(next)).toBe("ana");
  });

  it("still syncs an outside change after own pushes, and forgets them", () => {
    const typing = recordPush(recordPush(state({ q: "anx" }), "a"), "an");
    const next = syncToolbarState(typing, url("ben", "nurse"));
    expect(next).toEqual({
      q: "ben",
      filters: { role: "nurse" },
      syncedQ: "ben",
      recentPushes: [],
    });
    expect(pendingSearch(next)).toBeNull();
  });

  it("keeps the box text when only a filter changes from outside", () => {
    const current = state({ q: "an ", syncedQ: "an" });
    const next = syncToolbarState(current, url("an", "nurse"));
    expect(next).toEqual({ q: "an ", filters: { role: "nurse" }, syncedQ: "an", recentPushes: [] });
  });

  it("does not re-push after following an outside change", () => {
    const initial = initialToolbarState(url("ana"));
    expect(pendingSearch(syncToolbarState(initial, url("")))).toBeNull();
  });
});

describe("pendingSearch", () => {
  it("returns the trimmed text when it differs from the URL", () => {
    expect(pendingSearch(state({ q: " ben " }))).toBe("ben");
  });

  it("ignores whitespace-only differences", () => {
    expect(pendingSearch(state({ q: "ben  ", syncedQ: "ben" }))).toBeNull();
  });
});
