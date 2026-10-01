/**
 * One clock (AD-7): timestamps are stored as UTC ISO text, the OPD day is the
 * calendar date in Manila, and display always uses Manila time.
 */
export const OPD_TIME_ZONE = "Asia/Manila";

type Instant = Date | string | number;

function toDate(instant: Instant): Date {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`);
  return date;
}

// en-CA formats dates as YYYY-MM-DD.
const opdDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The OPD day (`YYYY-MM-DD`, Asia/Manila) an instant falls on. */
export function opdDate(instant: Instant = new Date()): string {
  return opdDateFormat.format(toDate(instant));
}

/** The OPD date `days` days after `date` (negative goes back); `YYYY-MM-DD` in and out. */
export function addOpdDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid OPD date: ${date}`);
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/** The years `isOpdDate` accepts: 9998 keeps the day after any date a four-digit year. */
export const OPD_YEAR_MIN = 1900;
export const OPD_YEAR_MAX = 9998;

/**
 * Whether `value` is a real calendar date written `YYYY-MM-DD` (e.g. not
 * 2026-02-30) in the years 1900–9998.
 */
export function isOpdDate(value: unknown): value is string {
  return isCalendarDate(value, OPD_YEAR_MAX);
}

function isCalendarDate(value: unknown, maxYear: number): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < OPD_YEAR_MIN || year > maxYear) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/**
 * The UTC instant (ISO text, as stored) at which the Manila date `date`
 * begins. Manila is UTC+8 all year (no DST), so 2026-09-27 starts at
 * 2026-09-26T16:00:00.000Z. Accepts year 9999 too, so the exclusive end of
 * a range ending on 9998-12-31 has a start.
 */
export function manilaDayStart(date: string): string {
  if (!isCalendarDate(date, 9999)) throw new RangeError(`Invalid OPD date: ${date}`);
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

/** The OPD day after the one `instant` falls on. */
export function nextOpdDate(instant: Instant = new Date()): string {
  return addOpdDays(opdDate(instant), 1);
}

const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: OPD_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const ISO_WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function manilaParts(instant: Instant) {
  const parts = clockFormat.formatToParts(toDate(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

/** The ISO weekday (1 = Monday … 7 = Sunday) of `instant` in Manila. */
export function manilaWeekday(instant: Instant = new Date()): number {
  const day = ISO_WEEKDAYS[manilaParts(instant).weekday];
  if (!day) throw new RangeError(`Unknown weekday for ${String(instant)}`);
  return day;
}

/** Minutes since Manila midnight (0–1439) at `instant`. */
export function manilaMinutes(instant: Instant = new Date()): number {
  const { hour, minute } = manilaParts(instant);
  return hour * 60 + minute;
}

const displayFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: OPD_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A date and time in Manila for display, e.g. "Sep 26, 2026, 3:05 PM". */
export function formatManila(instant: Instant, options?: Intl.DateTimeFormatOptions): string {
  const format = options
    ? new Intl.DateTimeFormat("en-PH", { ...options, timeZone: OPD_TIME_ZONE })
    : displayFormat;
  return format.format(toDate(instant));
}

/** A queue slip's issue date and time in Manila, e.g. "Sep 28, 2026 · 8:14 AM". */
export function formatSlipDateTime(instant: Instant): string {
  const date = formatManila(instant, { year: "numeric", month: "short", day: "numeric" });
  const time = formatManila(instant, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}
