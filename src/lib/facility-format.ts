/** Display helpers for Facility settings. Pure; safe on the client. */

/** ISO weekday (1 = Monday … 7 = Sunday) → short English name. */
export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const;

const SHORT = new Map<number, string>(WEEKDAYS.map((d) => [d.value, d.short]));

/**
 * Open days as text: runs of 3+ consecutive days become ranges.
 * `[1,2,3,4,5,6]` → "Mon–Sat"; `[1,3,5]` → "Mon, Wed, Fri".
 */
export function formatOpenDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => SHORT.has(d)).sort((a, b) => a - b);
  if (sorted.length === 0) return "No open days";
  if (sorted.length === 7) return "Every day";
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === sorted[i - 1]! + 1) continue;
    const run = sorted.slice(start, i);
    if (run.length >= 3) parts.push(`${SHORT.get(run[0]!)}–${SHORT.get(run[run.length - 1]!)}`);
    else parts.push(...run.map((d) => SHORT.get(d)!));
    start = i;
  }
  return parts.join(", ");
}

/** Opening hours as `HH:MM–HH:MM` (Manila time). */
export function formatHours(openTime: string, closeTime: string): string {
  return `${openTime}–${closeTime}`;
}

/** A Manila `HH:MM` as a 12-hour clock time: "07:00" → "7:00 AM", "13:30" → "1:30 PM". */
export function formatClockTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]) % 24;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${suffix}`;
}

/** The weekday's full name for an ISO weekday (1 = Monday … 7 = Sunday). */
export function weekdayName(weekday: number): string {
  return WEEKDAYS.find((d) => d.value === weekday)?.long ?? "";
}

const shortDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/**
 * A closed Facility tile's reason, in Manila time, relative to the OPD day
 * `today` (`YYYY-MM-DD`): "Closed, opens today 7:00 AM", "… tomorrow 7:00 AM",
 * "… Wednesday 7:00 AM", and with the date when it is a week away
 * ("… Monday Oct 5, 7:00 AM"). Null opening: no open days at all.
 */
export function closedReason(
  opening: { opdDate: string; weekday: number; time: string } | null,
  today: string,
): string {
  if (!opening) return "Closed, no open days set";
  const time = formatClockTime(opening.time);
  const days = Math.round((Date.parse(`${opening.opdDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return `Closed, opens today ${time}`;
  if (days === 1) return `Closed, opens tomorrow ${time}`;
  const day = weekdayName(opening.weekday);
  if (days >= 7) return `Closed, opens ${day} ${shortDateFormat.format(new Date(`${opening.opdDate}T12:00:00Z`))}, ${time}`;
  return `Closed, opens ${day} ${time}`;
}

/** A live-but-not-yet Facility tile's label: selectable while open, the nurse gives a paper number. */
export const PAPER_NUMBER_LABEL = "Paper number (not live yet)";

const opdDateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** An OPD date (`YYYY-MM-DD`) for display, e.g. "Tue, Sep 29, 2026". */
export function formatOpdDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return opdDateFormat.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
}
