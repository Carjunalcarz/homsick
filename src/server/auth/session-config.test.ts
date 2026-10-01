import { describe, expect, it, vi } from "vitest";
import { sessionTiming } from "./session-config";

describe("sessionTiming", () => {
  it("is 15 minutes, refreshed at most every minute, warned 60 s ahead by default", () => {
    expect(sessionTiming({ NODE_ENV: "development" })).toEqual({ expiresIn: 900, updateAge: 60, warnSeconds: 60 });
  });

  it("ignores the test overrides in production", () => {
    expect(
      sessionTiming({ NODE_ENV: "production", OPD_SESSION_SECONDS: "90", OPD_WARN_SECONDS: "30" }),
    ).toEqual({ expiresIn: 900, updateAge: 60, warnSeconds: 60 });
  });

  it("honors shorter timings outside production", () => {
    expect(sessionTiming({ NODE_ENV: "development", OPD_SESSION_SECONDS: "90", OPD_WARN_SECONDS: "30" })).toEqual({
      expiresIn: 90,
      // Refreshable twice before the warning opens.
      updateAge: 30,
      warnSeconds: 30,
    });
  });

  it("warns once about an invalid value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sessionTiming({ NODE_ENV: "test", OPD_WARN_SECONDS: "soon" });
    sessionTiming({ NODE_ENV: "test", OPD_WARN_SECONDS: "soon" });
    expect(warn.mock.calls.filter(([m]) => String(m).includes("OPD_WARN_SECONDS"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("never lengthens the session and ignores nonsense", () => {
    expect(sessionTiming({ NODE_ENV: "test", OPD_SESSION_SECONDS: "86400" }).expiresIn).toBe(900);
    expect(sessionTiming({ NODE_ENV: "test", OPD_SESSION_SECONDS: "abc", OPD_WARN_SECONDS: "-5" })).toEqual({
      expiresIn: 900,
      updateAge: 60,
      warnSeconds: 60,
    });
  });
});
