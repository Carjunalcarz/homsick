import { describe, expect, it } from "vitest";
import {
  guessNameFromQuery,
  normalizeContactNumber,
  parseBirthdateQuery,
  parsePatientQuery,
  parsePhoneQuery,
} from "./patient-search";
import { formatPatientName } from "./patient-name";

describe("parseBirthdateQuery", () => {
  it("reads YYYY-MM-DD and MM/DD/YYYY as the same date", () => {
    expect(parseBirthdateQuery("1950-03-15")).toBe("1950-03-15");
    expect(parseBirthdateQuery("03/15/1950")).toBe("1950-03-15");
    expect(parseBirthdateQuery(" 3/5/1950 ")).toBe("1950-03-05");
  });

  it("treats an impossible date as text", () => {
    expect(parseBirthdateQuery("02/30/1950")).toBeNull();
    expect(parseBirthdateQuery("1950-02-30")).toBeNull();
    expect(parseBirthdateQuery("13/01/1950")).toBeNull();
    expect(parseBirthdateQuery("2023-02-29")).toBeNull();
    expect(parseBirthdateQuery("2024-02-29")).toBe("2024-02-29");
  });

  it("needs the whole query to be a date", () => {
    expect(parseBirthdateQuery("born 1950-03-15")).toBeNull();
    expect(parseBirthdateQuery("1950")).toBeNull();
    expect(parseBirthdateQuery("15/03/1950")).toBeNull();
  });
});

describe("parsePhoneQuery", () => {
  it("reads +63 as 0", () => {
    expect(parsePhoneQuery("+63 917 123 4567")).toEqual(["09171234567"]);
    expect(parsePhoneQuery("+63-917")).toEqual(["0917"]);
    expect(parsePhoneQuery("(+63) 917 123 4567")).toEqual(["09171234567"]);
    expect(parsePhoneQuery("+ 63 917 123 4567")).toEqual(["09171234567"]);
    expect(parsePhoneQuery("917+63")).toEqual([]);
  });

  it("tries a bare 63 prefix both ways", () => {
    expect(parsePhoneQuery("639171234567")).toEqual(["639171234567", "09171234567"]);
  });

  it("keeps the digits of a local number", () => {
    expect(parsePhoneQuery("0917-123-4567")).toEqual(["09171234567"]);
    expect(parsePhoneQuery("(0917) 123")).toEqual(["0917123"]);
    expect(parsePhoneQuery("4567")).toEqual(["4567"]);
  });

  it("needs at least 4 digits", () => {
    expect(parsePhoneQuery("12")).toEqual([]);
    expect(parsePhoneQuery("123")).toEqual([]);
    expect(parsePhoneQuery("+639")).toEqual([]);
  });

  it("ignores queries with letters or other characters", () => {
    expect(parsePhoneQuery("hn-2026-000001")).toEqual([]);
    expect(parsePhoneQuery("juan 0917")).toEqual([]);
    expect(parsePhoneQuery("03/15/1950")).toEqual([]);
  });
});

describe("parsePatientQuery", () => {
  it("normalizes the name text", () => {
    expect(parsePatientQuery("  PEÑA  ").name).toBe("peña");
    expect(parsePatientQuery("Dela   Cruz,Juan").name).toBe("dela cruz, juan");
    expect(parsePatientQuery("dela cruz ,  juan").name).toBe("dela cruz, juan");
  });

  it("uppercases the Hospital Number part", () => {
    expect(parsePatientQuery("hn-2026-00001").hospitalNumber).toBe("HN-2026-00001");
  });

  it("does not read a date's digits as a phone number", () => {
    expect(parsePatientQuery("1950-03-15")).toMatchObject({ birthdate: "1950-03-15", phoneDigits: [] });
  });

  it("is empty for an empty query", () => {
    expect(parsePatientQuery(undefined)).toEqual({ name: "", hospitalNumber: "", birthdate: null, phoneDigits: [] });
    expect(parsePatientQuery("   ").name).toBe("");
  });
});

describe("formatPatientName", () => {
  it("shows LAST, First Middle Suffix", () => {
    expect(formatPatientName({ lastName: "Dela Cruz", firstName: "Juan", middleName: "Santos" })).toBe(
      "DELA CRUZ, Juan Santos",
    );
    expect(formatPatientName({ lastName: "Peña", firstName: "Maria", middleName: null, suffix: null })).toBe(
      "PEÑA, Maria",
    );
    expect(
      formatPatientName({ lastName: "Reyes", firstName: "Jose", middleName: "Garcia", suffix: "Jr." }),
    ).toBe("REYES, Jose Garcia Jr.");
  });
});

describe("patient display", () => {
  it("formats a birthdate as a calendar date and the last visit", async () => {
    const { formatBirthdate, formatLastVisit } = await import("./patient-display");
    expect(formatBirthdate("1950-03-15")).toBe("Mar 15, 1950");
    expect(formatBirthdate("2016-02-29")).toBe("Feb 29, 2016");
    expect(formatLastVisit(null)).toBe("No visits");
    // An impossible stored date is shown as stored, not rolled over to Mar 2.
    expect(formatBirthdate("2026-02-30")).toBe("2026-02-30");
  });
});

describe("normalizeContactNumber", () => {
  it("stores +63 and 63 as 0, digits only", () => {
    expect(normalizeContactNumber("+63 917 123 4567")).toBe("09171234567");
    expect(normalizeContactNumber("(+63) 917-123-4567")).toBe("09171234567");
    expect(normalizeContactNumber("639171234567")).toBe("09171234567");
    expect(normalizeContactNumber("0917.123.4567")).toBe("09171234567");
  });

  it("drops a trunk 0 after the country code and adds a missing 0 to a mobile number", () => {
    expect(normalizeContactNumber("(+63) 0917 123 4567")).toBe("09171234567");
    expect(normalizeContactNumber("63 0917 123 4567")).toBe("09171234567");
    expect(normalizeContactNumber("632 8123 4567")).toBe("0281234567");
    expect(normalizeContactNumber("+63 2 8123 4567")).toBe("0281234567");
    expect(normalizeContactNumber("917 123 4567")).toBe("09171234567");
    // A short local number starting with 63 is left alone.
    expect(normalizeContactNumber("631 2345")).toBe("6312345");
  });

  it("accepts 7 to 11 digits, landlines included", () => {
    expect(normalizeContactNumber("123 4567")).toBe("1234567");
    expect(normalizeContactNumber("(02) 8123-4567")).toBe("0281234567");
    expect(normalizeContactNumber("123456")).toBeNull();
    expect(normalizeContactNumber("091712345678")).toBeNull();
  });

  it("refuses letters and other country codes", () => {
    expect(normalizeContactNumber("0917 CALL ME")).toBeNull();
    expect(normalizeContactNumber("+1 555 123 4567")).toBeNull();
    expect(normalizeContactNumber("")).toBeNull();
  });
});

describe("guessNameFromQuery", () => {
  it('reads "last, first" and "first last"', () => {
    expect(guessNameFromQuery("Reyes, Ana")).toEqual({ lastName: "Reyes", firstName: "Ana" });
    expect(guessNameFromQuery("dela cruz, juan")).toEqual({ lastName: "Dela Cruz", firstName: "Juan" });
    expect(guessNameFromQuery("juan dela cruz")).toEqual({ lastName: "Dela Cruz", firstName: "Juan" });
    expect(guessNameFromQuery("PEÑA,MARIA")).toEqual({ lastName: "Peña", firstName: "Maria" });
    expect(guessNameFromQuery("McArthur, Ana")).toEqual({ lastName: "McArthur", firstName: "Ana" });
  });

  it("normalizes a decomposed ñ to NFC", () => {
    expect(guessNameFromQuery("peña, ana")).toEqual({ lastName: "Peña", firstName: "Ana" });
    expect(parsePatientQuery("PEÑA").name).toBe("peña");
  });

  it("reads one word as a last name", () => {
    expect(guessNameFromQuery("reyes")).toEqual({ lastName: "Reyes", firstName: "" });
  });

  it("is null for dates, phones, Hospital Numbers and other text", () => {
    for (const q of ["", "1950-03-15", "03/15/1950", "0917 123 4567", "HN-2026-000001", "a, b, c", ", ana", "cruz!"]) {
      expect(guessNameFromQuery(q)).toBeNull();
    }
  });
});