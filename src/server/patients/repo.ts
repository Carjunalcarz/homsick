import "server-only";
import { eq, sql } from "drizzle-orm";
import { DomainError } from "@/server/db/errors";
import type { Tx } from "@/server/db/tx";
import { hospitalNumberCounters, patients, type NewPatientRow } from "./schema";

/*
 * Writes to the `patients` tables. Called inside a transaction (a command's
 * `withCommandTx`, or the demo seed's own), so the number and the patient
 * commit together.
 */

export const PatientError = {
  HospitalNumbersExhausted: "hospital_numbers_exhausted",
  NotFound: "not_found",
  Stale: "stale",
} as const;

const MAX_SEQ = 999_999;

/** `HN-YYYY-NNNNNN`. */
export function formatHospitalNumber(year: number, seq: number): string {
  return `HN-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Issue the next Hospital Number for `year` (the Manila year of
 * registration). The only way a number is issued: the counter row is
 * incremented in `tx`, so numbers are sequential per year and a rolled-back
 * transaction gives its number back.
 */
export function nextHospitalNumber(tx: Tx, year: number): string {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new RangeError(`nextHospitalNumber: invalid year ${year}`);
  }
  const current = tx
    .select({ lastSeq: hospitalNumberCounters.lastSeq })
    .from(hospitalNumberCounters)
    .where(eq(hospitalNumberCounters.year, year))
    .get();
  if (current && current.lastSeq >= MAX_SEQ) {
    throw new DomainError(PatientError.HospitalNumbersExhausted, `No Hospital Numbers left for ${year}.`);
  }
  const row = tx
    .insert(hospitalNumberCounters)
    .values({ year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: hospitalNumberCounters.year,
      set: { lastSeq: sql`${hospitalNumberCounters.lastSeq} + 1` },
    })
    .returning({ lastSeq: hospitalNumberCounters.lastSeq })
    .get();
  return formatHospitalNumber(year, row.lastSeq);
}

type NameParts = Pick<NewPatientRow, "lastName" | "firstName" | "middleName" | "suffix">;

/**
 * The stored `search_text`: the name forms search matches, lowercased with
 * spaces collapsed, one per line ("juan dela cruz", "juan santos dela cruz",
 * "dela cruz, juan santos"). A query never holds a newline, so a match never
 * spans two forms. Every name part is a substring of one of them.
 */
export function patientSearchText({ lastName, firstName, middleName, suffix }: NameParts): string {
  const clean = (value: string | null | undefined) => (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const [last, first, middle, suf] = [clean(lastName), clean(firstName), clean(middleName), clean(suffix)];
  const given = [first, middle, suf].filter(Boolean).join(" ");
  return [
    `${first} ${last}`,
    [first, middle, last, suf].filter(Boolean).join(" "),
    `${last}, ${given}`,
  ]
    .join("\n")
    .toLowerCase();
}

/** Insert one patient row as given (the caller has validated it and issued its number); `search_text` is derived here. */
export function insertPatient(tx: Tx, values: Omit<NewPatientRow, "searchText">): void {
  tx.insert(patients)
    .values({ ...values, searchText: patientSearchText(values) })
    .run();
}

/**
 * Change a patient's stored fields, keeping `search_text` in step with the
 * name and setting `updated_at` (to `now`, unless the changes give one).
 * The Hospital Number, `created_*` and `privacy_notice_at` can't be changed
 * here. Returns false when there is no such patient.
 */
export function updatePatient(
  tx: Tx,
  id: string,
  changes: Partial<
    Omit<NewPatientRow, "id" | "hospitalNumber" | "searchText" | "createdAt" | "createdBy" | "privacyNoticeAt">
  >,
  now: Date = new Date(),
): boolean {
  const current = tx
    .select({
      lastName: patients.lastName,
      firstName: patients.firstName,
      middleName: patients.middleName,
      suffix: patients.suffix,
    })
    .from(patients)
    .where(eq(patients.id, id))
    .get();
  if (!current) return false;
  // Fields left undefined are unchanged (as in Drizzle's `set`).
  const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
  // Never rewritten, even when a caller slips them in at runtime.
  for (const key of ["id", "hospitalNumber", "searchText", "createdAt", "createdBy", "privacyNoticeAt"]) delete defined[key];
  tx.update(patients)
    .set({
      updatedAt: now.toISOString(),
      ...defined,
      searchText: patientSearchText({ ...current, ...defined }),
    })
    .where(eq(patients.id, id))
    .run();
  return true;
}
