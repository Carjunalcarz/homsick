import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/triage", "/triage"],
    ["/patients?q=ana&page=2", "/patients?q=ana&page=2"],
    ["/", "/"],
  ])("keeps the relative path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "triage",
    "",
    "/sign-in",
    "/sign-in?next=%2Ftriage",
    "/sign-in/",
    "/Sign-In",
    "/SIGN-IN/?next=%2F",
    "/..//evil.example",
    "/.//evil.example",
    "/%2e%2e//evil.example",
    "/a/..//evil.example",
  ])("falls back to / for %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("falls back for non-strings", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(["/triage"])).toBe("/");
  });
});
