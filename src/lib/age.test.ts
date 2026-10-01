import { describe, expect, it } from "vitest";
import { ageOn, formatAge } from "./age";

describe("ageOn", () => {
  it("counts whole years", () => {
    expect(ageOn("1990-06-15", "2026-09-27")).toBe(36);
    expect(ageOn("1990-10-01", "2026-09-27")).toBe(35);
  });

  it("adds the year on the birthday itself", () => {
    expect(ageOn("1966-09-27", "2026-09-27")).toBe(60);
    expect(ageOn("1966-09-28", "2026-09-27")).toBe(59);
  });

  it("is 0 on the day of birth", () => {
    expect(ageOn("2026-09-27", "2026-09-27")).toBe(0);
  });

  it("turns a Feb 29 birth a year older on Mar 1 in other years", () => {
    expect(ageOn("2024-02-29", "2025-02-28")).toBe(0);
    expect(ageOn("2024-02-29", "2025-03-01")).toBe(1);
    expect(ageOn("2024-02-29", "2028-02-29")).toBe(4);
    expect(ageOn("2024-02-29", "2028-02-28")).toBe(3);
  });

  it("is null for a future birthdate", () => {
    expect(ageOn("2026-09-28", "2026-09-27")).toBeNull();
    expect(ageOn("2030-01-01", "2026-09-27")).toBeNull();
  });

  it("is null for an invalid date", () => {
    expect(ageOn("2026-02-30", "2026-09-27")).toBeNull();
    expect(ageOn("03/15/1950", "2026-09-27")).toBeNull();
    expect(ageOn("1950-03-15", "yesterday")).toBeNull();
  });
});

describe("formatAge", () => {
  it("shows years, or a dash when unknown", () => {
    expect(formatAge(34)).toBe("34 y");
    expect(formatAge(0)).toBe("0 y");
    expect(formatAge(null)).toBe("—");
  });
});
