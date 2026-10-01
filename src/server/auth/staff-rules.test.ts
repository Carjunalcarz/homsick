import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  isStaffRole,
  normalizeUsername,
  validateFullName,
  validatePassword,
  validateUsername,
} from "./staff-rules";

describe("validateUsername", () => {
  it.each(["ana.cruz", "nurse_01", "j-dela-cruz", "abc", "a".repeat(USERNAME_MAX)])("accepts %s", (u) => {
    expect(validateUsername(u)).toBeNull();
  });

  it.each(["ab", "a".repeat(USERNAME_MAX + 1), "Ana", "ana cruz", "ana@x", "ñora", ""])("rejects %j", (u) => {
    expect(validateUsername(u)).toMatch(/Username must be/);
  });

  it.each([".joy", "joy.", "a..b", "_joy", "joy_", "-joy", "joy-", "..."])(
    "rejects %j, which can't be an email local part",
    (u) => {
      expect(validateUsername(u)).toMatch(/can't start or end/);
    },
  );

  it.each(["admin", "administrator", "root", "superuser", "opd", "staff", "user"])(
    "rejects the shared name %s",
    (u) => {
      expect(validateUsername(u)).toMatch(/shared account/);
    },
  );

  it("normalizes before checking", () => {
    expect(normalizeUsername("  Ana.Cruz ")).toBe("ana.cruz");
    expect(validateUsername(normalizeUsername("ADMIN"))).toMatch(/shared/);
  });
});

describe("validatePassword", () => {
  it("accepts the length limits", () => {
    expect(validatePassword("x".repeat(PASSWORD_MIN))).toBeNull();
    expect(validatePassword("x".repeat(PASSWORD_MAX))).toBeNull();
  });

  it("rejects too short or too long", () => {
    expect(validatePassword("x".repeat(PASSWORD_MIN - 1))).toMatch(/Password must be/);
    expect(validatePassword("x".repeat(PASSWORD_MAX + 1))).toMatch(/Password must be/);
  });
});

describe("validateFullName", () => {
  it("requires a name of at most 100 characters", () => {
    expect(validateFullName("Ana Cruz")).toBeNull();
    expect(validateFullName("   ")).toMatch(/required/);
    expect(validateFullName("a".repeat(101))).toMatch(/at most/);
  });
});

describe("isStaffRole", () => {
  it("accepts only the three Roles", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("triage_nurse")).toBe(true);
    expect(isStaffRole("facility_staff")).toBe(true);
    expect(isStaffRole("user")).toBe(false);
    expect(isStaffRole("")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});
