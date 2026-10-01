import { describe, expect, it } from "vitest";
import { formatCountdown, formatDuration, keepAliveMoved, nextGuardState, shouldAnnounce } from "./session-guard";

const NOW = 1_800_000_000_000;
const s = (seconds: number) => seconds * 1000;

describe("nextGuardState", () => {
  it("stays active with 61 s left", () => {
    expect(nextGuardState(NOW, NOW + s(61), 0, NOW)).toEqual({
      phase: "active",
      secondsLeft: 61,
      shouldKeepAlive: false,
    });
  });

  it("warns with exactly 60 s left", () => {
    expect(nextGuardState(NOW, NOW + s(60), 0, 0)).toMatchObject({ phase: "warning", secondsLeft: 60 });
  });

  it("rounds a partial second up, so 60.5 s left is not yet the warning", () => {
    expect(nextGuardState(NOW, NOW + 60_500, 0, 0).phase).toBe("active");
  });

  it("expires with 0 s left and after", () => {
    expect(nextGuardState(NOW, NOW, 0, 0)).toEqual({ phase: "expired", secondsLeft: 0, shouldKeepAlive: false });
    expect(nextGuardState(NOW, NOW - s(5), 0, 0)).toMatchObject({ phase: "expired", secondsLeft: 0 });
  });

  it("honors a shorter warning lead time", () => {
    expect(nextGuardState(NOW, NOW + s(31), 0, 0, { warnSeconds: 30 }).phase).toBe("active");
    expect(nextGuardState(NOW, NOW + s(30), 0, 0, { warnSeconds: 30 }).phase).toBe("warning");
  });

  describe("activity throttling", () => {
    const expiresAt = NOW + s(600);

    it("keeps alive after activity once 60 s have passed since the last keep-alive", () => {
      expect(nextGuardState(NOW, expiresAt, NOW - s(1), NOW - s(60)).shouldKeepAlive).toBe(true);
    });

    it("waits when the last keep-alive was under 60 s ago", () => {
      expect(nextGuardState(NOW, expiresAt, NOW - s(1), NOW - s(59)).shouldKeepAlive).toBe(false);
    });

    it("does nothing without activity since the last keep-alive (polling is not activity)", () => {
      expect(nextGuardState(NOW, expiresAt, NOW - s(120), NOW - s(90)).shouldKeepAlive).toBe(false);
      expect(nextGuardState(NOW, expiresAt, 0, 0).shouldKeepAlive).toBe(false);
    });

    it("keeps activity pending after a keep-alive that didn't move the expiry, and retries once the session can refresh", () => {
      const session = 900;
      // The session was refreshed 30 s ago (e.g. by a page load), so a
      // keep-alive now would be a no-op: expiresAt stays put.
      const expires = NOW + s(session - 30);
      expect(keepAliveMoved(expires, expires)).toBe(false);
      // lastKeepAlive is not advanced, so the activity is still pending...
      const opts = { sessionSeconds: session, lastAttempt: NOW };
      expect(nextGuardState(NOW + s(1), expires, NOW - s(1), NOW - s(120), opts).shouldKeepAlive).toBe(false);
      // ...until updateAge has passed since the session's own refresh.
      expect(nextGuardState(NOW + s(29), expires, NOW - s(1), NOW - s(120), opts).shouldKeepAlive).toBe(false);
      expect(nextGuardState(NOW + s(30), expires, NOW - s(1), NOW - s(120), opts).shouldKeepAlive).toBe(true);
      expect(keepAliveMoved(expires, expires + s(30))).toBe(true);
    });

    it("spaces out retries after an attempt", () => {
      expect(
        nextGuardState(NOW, NOW + s(600), NOW - s(1), NOW - s(120), { lastAttempt: NOW - s(2) }).shouldKeepAlive,
      ).toBe(false);
    });

    it("never keeps alive during the warning; only Stay signed in does", () => {
      expect(nextGuardState(NOW, NOW + s(30), NOW, NOW - s(300)).shouldKeepAlive).toBe(false);
    });
  });
});

describe("countdown helpers", () => {
  it("phrases durations in minutes or seconds", () => {
    expect(formatDuration(900)).toBe("15 minutes");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(90)).toBe("90 seconds");
    expect(formatDuration(30)).toBe("30 seconds");
    expect(formatDuration(1)).toBe("1 second");
  });

  it("formats minutes and seconds", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(-3)).toBe("0:00");
  });

  it("announces at the start and at a few points, not every second", () => {
    expect(shouldAnnounce(60)).toBe(true);
    expect(shouldAnnounce(59)).toBe(false);
    expect(shouldAnnounce(10)).toBe(true);
    expect(shouldAnnounce(30, 30)).toBe(true);
  });
});
