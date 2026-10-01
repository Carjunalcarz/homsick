import { describe, expect, it } from "vitest";
import {
  buildListHref,
  clampPage,
  listDefaults,
  MAX_QUERY_LENGTH,
  parseDateRange,
  parseListParams,
  parsePage,
} from "@/lib/url-query";

describe("parseDateRange", () => {
  it("keeps valid dates, each optional", () => {
    expect(parseDateRange("2026-09-27", "2026-09-28")).toEqual({ from: "2026-09-27", to: "2026-09-28" });
    expect(parseDateRange("2026-09-27", undefined)).toEqual({ from: "2026-09-27", to: "" });
    expect(parseDateRange(undefined, ["2026-09-28", "2026-09-01"])).toEqual({ from: "", to: "2026-09-28" });
  });

  it("swaps a reversed range", () => {
    expect(parseDateRange("2026-09-28", "2026-09-26")).toEqual({ from: "2026-09-26", to: "2026-09-28" });
  });

  it("ignores invalid dates", () => {
    expect(parseDateRange("yesterday", "2026-02-30")).toEqual({ from: "", to: "" });
    expect(parseDateRange("yesterday", "2026-09-26")).toEqual({ from: "", to: "2026-09-26" });
  });

  it("ignores years outside 1900–9998", () => {
    expect(parseDateRange("2026-09-26", "9999-12-31")).toEqual({ from: "2026-09-26", to: "" });
    expect(parseDateRange("1899-12-31", "9998-12-31")).toEqual({ from: "", to: "9998-12-31" });
  });
});

const schema = {
  filters: {
    role: { values: ["all", "nurse", "admin"], default: "all" },
    status: { values: ["active", "deactivated"], default: "active" },
  },
} as const;

describe("parseListParams", () => {
  it("returns the defaults for an empty URL", () => {
    expect(parseListParams({}, schema)).toEqual({
      q: "",
      page: 1,
      role: "all",
      status: "active",
    });
  });

  it("reads whitelisted values", () => {
    expect(
      parseListParams({ q: "ana", page: "3", role: "nurse", status: "deactivated" }, schema)
    ).toEqual({ q: "ana", page: 3, role: "nurse", status: "deactivated" });
  });

  it("falls back to the default for values outside the whitelist", () => {
    const params = parseListParams({ role: "doctor", status: "ACTIVE" }, schema);
    expect(params.role).toBe("all");
    expect(params.status).toBe("active");
  });

  it("trims the search and caps it at 100 characters", () => {
    expect(parseListParams({ q: "  ana  " }, schema).q).toBe("ana");
    const long = "x".repeat(MAX_QUERY_LENGTH + 20);
    expect(parseListParams({ q: long }, schema).q).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("drops a trailing space left by the 100-character cut", () => {
    const q = `${"x".repeat(MAX_QUERY_LENGTH - 1)} tail`;
    expect(parseListParams({ q }, schema).q).toBe("x".repeat(MAX_QUERY_LENGTH - 1));
  });

  it("uses the first value when a parameter repeats", () => {
    expect(parseListParams({ q: ["a", "b"], role: ["admin", "nurse"] }, schema)).toMatchObject({
      q: "a",
      role: "admin",
    });
  });

  it("ignores parameters the schema does not know", () => {
    expect(parseListParams({ sort: "name" }, schema)).not.toHaveProperty("sort");
  });
});

describe("parsePage", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["0", 1],
    ["-2", 1],
    ["1.5", 1],
    ["abc", 1],
    ["2abc", 1],
    ["1e3", 1],
    ["99999999999999999999", 1],
    ["1", 1],
    ["7", 7],
    [" 4 ", 4],
  ])("reads %j as page %i", (input, expected) => {
    expect(parsePage(input)).toBe(expected);
  });
});

describe("clampPage", () => {
  it("keeps a page inside 1..pageCount", () => {
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(0, 5)).toBe(1);
  });

  it("returns page 1 for an empty list", () => {
    expect(clampPage(4, 0)).toBe(1);
  });
});

describe("buildListHref", () => {
  const defaults = listDefaults(schema);

  it("returns the bare path when every value is a default", () => {
    expect(buildListHref("/admin/staff", defaults, defaults)).toBe("/admin/staff");
  });

  it("omits defaults and keeps the rest", () => {
    expect(
      buildListHref("/admin/staff", { ...defaults, q: "ana", role: "nurse", page: 2 }, defaults)
    ).toBe("/admin/staff?q=ana&role=nurse&page=2");
  });

  it("always puts page last", () => {
    expect(buildListHref("/x", { page: 2, q: "a" })).toBe("/x?q=a&page=2");
  });

  it("omits page 1 even without explicit defaults", () => {
    expect(buildListHref("/x", { q: "a", page: 1 })).toBe("/x?q=a");
  });

  it("omits empty and undefined values", () => {
    expect(buildListHref("/x", { q: "", role: undefined, page: 2 })).toBe("/x?page=2");
  });

  it("encodes values", () => {
    expect(buildListHref("/x", { q: "dela cruz & co" })).toBe("/x?q=dela+cruz+%26+co");
  });

  it("round-trips through parseListParams", () => {
    const values = { q: "ana", page: 4, role: "admin", status: "deactivated" } as const;
    const href = buildListHref("/x", values, defaults);
    const search = Object.fromEntries(new URL(href, "http://localhost").searchParams);
    expect(parseListParams(search, schema)).toEqual(values);
  });
});
