// Age is always calculated from the birthdate, never stored or typed (FR-4).
// Safe to import in client code.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: string) {
  const match = DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year, monthDay: month * 100 + day };
}

/**
 * Whole years from `birthdate` to `today` (both `YYYY-MM-DD`; pass `opdDate()`
 * for today in Manila). The birthday counts on the day itself; a Feb 29 birth
 * turns a year older on Mar 1 in other years. `null` for a birthdate after
 * today or an invalid date.
 */
export function ageOn(birthdate: string, today: string): number | null {
  const birth = parts(birthdate);
  const now = parts(today);
  if (!birth || !now) return null;
  if (birthdate > today) return null;
  return now.year - birth.year - (now.monthDay < birth.monthDay ? 1 : 0);
}

/** An age for display: "34 y", or "—" when unknown. */
export function formatAge(age: number | null): string {
  return age === null ? "—" : `${age} y`;
}
