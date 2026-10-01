import { describe, expect, it } from "vitest";
import {
  addOpdDays,
  formatManila,
  formatSlipDateTime,
  isOpdDate,
  manilaDayStart,
  manilaMinutes,
  manilaWeekday,
  nextOpdDate,
  opdDate,
} from "./time";

describe("isOpdDate", () => {
  it("accepts real YYYY-MM-DD dates only", () => {
    expect(isOpdDate("2026-09-27")).toBe(true);
    expect(isOpdDate("2028-02-29")).toBe(true);
    expect(isOpdDate("2026-02-29")).toBe(false);
    expect(isOpdDate("2026-02-30")).toBe(false);
    expect(isOpdDate("2026-13-01")).toBe(false);
    expect(isOpdDate("2026-9-27")).toBe(false);
    expect(isOpdDate("yesterday")).toBe(false);
    expect(isOpdDate("")).toBe(false);
    expect(isOpdDate(undefined)).toBe(false);
  });

  it("accepts only the years 1900–9998", () => {
    expect(isOpdDate("1900-01-01")).toBe(true);
    expect(isOpdDate("9998-12-31")).toBe(true);
    expect(isOpdDate("1899-12-31")).toBe(false);
    expect(isOpdDate("9999-12-31")).toBe(false);
    expect(isOpdDate("0202-09-27")).toBe(false);
    // The day after the last accepted date still has a valid start instant.
    expect(manilaDayStart(addOpdDays("9998-12-31", 1))).toBe("9998-12-31T16:00:00.000Z");
  });
});

describe("manilaDayStart", () => {
  it("is 16:00 UTC on the previous calendar day", () => {
    expect(manilaDayStart("2026-09-27")).toBe("2026-09-26T16:00:00.000Z");
    expect(manilaDayStart("2027-01-01")).toBe("2026-12-31T16:00:00.000Z");
    expect(manilaDayStart("2028-03-01")).toBe("2028-02-29T16:00:00.000Z");
  });

  it("agrees with opdDate at the boundary", () => {
    const start = manilaDayStart("2026-09-27");
    expect(opdDate(start)).toBe("2026-09-27");
    expect(opdDate(new Date(new Date(start).getTime() - 1))).toBe("2026-09-26");
  });

  it("rejects invalid dates", () => {
    expect(() => manilaDayStart("2026-02-30")).toThrow(RangeError);
    expect(() => manilaDayStart("yesterday")).toThrow(RangeError);
  });
});

describe("manilaWeekday and manilaMinutes", () => {
  it("reads the Manila clock, not UTC", () => {
    // 2026-09-27 is a Sunday; 15:59:59Z is 23:59 Sunday in Manila.
    expect(manilaWeekday("2026-09-27T15:59:59Z")).toBe(7);
    expect(manilaMinutes("2026-09-27T15:59:59Z")).toBe(23 * 60 + 59);
    // 16:00Z is Monday 00:00 in Manila.
    expect(manilaWeekday("2026-09-27T16:00:00Z")).toBe(1);
    expect(manilaMinutes("2026-09-27T16:00:00Z")).toBe(0);
  });
});

describe("addOpdDays and nextOpdDate", () => {
  it("crosses month and year ends", () => {
    expect(addOpdDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addOpdDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("turns over at Manila midnight", () => {
    expect(nextOpdDate("2026-09-27T15:59:59Z")).toBe("2026-09-28");
    expect(nextOpdDate("2026-09-27T16:00:00Z")).toBe("2026-09-29");
  });
});

describe("opdDate", () => {
  it("is still the previous day one second before Manila midnight", () => {
    expect(opdDate(new Date("2026-09-25T15:59:59Z"))).toBe("2026-09-25");
  });

  it("turns over at Manila midnight (16:00 UTC)", () => {
    expect(opdDate(new Date("2026-09-25T16:00:00Z"))).toBe("2026-09-26");
  });

  it("accepts ISO strings and handles year ends", () => {
    expect(opdDate("2026-12-31T16:00:00.000Z")).toBe("2027-01-01");
  });

  it("rejects invalid instants", () => {
    expect(() => opdDate("not a date")).toThrow(RangeError);
  });
});

describe("formatManila", () => {
  it("shows Manila local time", () => {
    const text = formatManila(new Date("2026-09-25T16:05:00Z"));
    expect(text).toContain("26");
    expect(text).toMatch(/12:05/);
  });
});

describe("formatSlipDateTime", () => {
  it("shows the Manila date and time, e.g. Sep 28, 2026 · 8:14 AM", () => {
    expect(formatSlipDateTime("2026-09-28T00:14:00.000Z")).toBe("Sep 28, 2026 · 8:14 AM");
    // 23:30 UTC is already the next day in Manila.
    expect(formatSlipDateTime("2026-09-28T23:30:00.000Z")).toBe("Sep 29, 2026 · 7:30 AM");
    expect(formatSlipDateTime("2026-09-28T05:05:00.000Z")).toBe("Sep 28, 2026 · 1:05 PM");
  });
});