import { describe, expect, it } from "vitest";
import { closedReason, formatClockTime, formatHours, formatOpdDate, formatOpenDays } from "./facility-format";

describe("formatOpenDays", () => {
  it.each([
    [[1, 2, 3, 4, 5, 6], "Mon–Sat"],
    [[1, 3, 5], "Mon, Wed, Fri"],
    [[1, 2, 4, 5, 6], "Mon, Tue, Thu–Sat"],
    [[6, 7], "Sat, Sun"],
    [[1, 2, 3, 4, 5, 6, 7], "Every day"],
    [[], "No open days"],
  ])("%j → %s", (days, text) => {
    expect(formatOpenDays(days)).toBe(text);
  });
});

describe("closed tile reasons", () => {
  it("formats the next opening in 12-hour time", () => {
    expect(formatClockTime("07:00")).toBe("7:00 AM");
    expect(formatClockTime("00:15")).toBe("12:15 AM");
    expect(formatClockTime("12:00")).toBe("12:00 PM");
    expect(formatClockTime("13:30")).toBe("1:30 PM");
    const today = "2026-09-28"; // a Monday
    expect(closedReason({ opdDate: "2026-09-28", weekday: 1, time: "07:00" }, today)).toBe("Closed, opens today 7:00 AM");
    expect(closedReason({ opdDate: "2026-09-29", weekday: 2, time: "07:00" }, today)).toBe("Closed, opens tomorrow 7:00 AM");
    expect(closedReason({ opdDate: "2026-10-01", weekday: 4, time: "13:00" }, today)).toBe("Closed, opens Thursday 1:00 PM");
    expect(closedReason({ opdDate: "2026-10-04", weekday: 7, time: "08:30" }, today)).toBe("Closed, opens Sunday 8:30 AM");
    expect(closedReason({ opdDate: "2026-10-05", weekday: 1, time: "07:00" }, today)).toBe("Closed, opens Monday Oct 5, 7:00 AM");
    expect(closedReason(null, today)).toBe("Closed, no open days set");
  });
});

describe("formatHours and formatOpdDate", () => {
  it("formats hours and OPD dates without shifting the day", () => {
    expect(formatHours("07:00", "17:00")).toBe("07:00–17:00");
    const text = formatOpdDate("2026-09-29");
    expect(text).toContain("Sep");
    expect(text).toContain("29");
    expect(text).toContain("Tue");
  });
});
