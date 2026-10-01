// Patient search and list display text, shared by /patients and the Patient finder.

import { MIN_PHONE_DIGITS } from "./patient-search";
import { isOpdDate } from "./time";

export const PATIENT_SEARCH_PLACEHOLDER = "Name, Hospital Number, birthdate or phone";

/** How to widen a search that found nothing. */
export const PATIENT_SEARCH_HINT =
  `Check the spelling of the name, or try part of it. A Hospital Number looks like HN-2026-000123. ` +
  `Type a birthdate as YYYY-MM-DD or MM/DD/YYYY, and a phone number with at least ${MIN_PHONE_DIGITS} digits.`;

const birthdateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A `YYYY-MM-DD` birthdate for display, e.g. "Mar 15, 1950" (a calendar date: no time zone shift). */
export function formatBirthdate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  // Not a real date (e.g. 2026-02-30): shown as stored, never rolled over.
  if (!match || !isOpdDate(date)) return date;
  return birthdateFormat.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

/** The last Visit's OPD date, or "No visits". */
export function formatLastVisit(date: string | null): string {
  return date === null ? "No visits" : formatBirthdate(date);
}
