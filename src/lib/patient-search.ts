// Parsing the one patient search box (FR-4). Pure, so the rules are unit
// tested apart from SQL; safe to import in client code.

import { PATIENT_NAME_MAX } from "./patient-name";
import { MAX_QUERY_LENGTH } from "./url-query";
import { isOpdDate } from "./time";

/** Fewer digits than this never match a phone number (too many false hits). */
export const MIN_PHONE_DIGITS = 4;

export type PatientQuery = {
  /** Lowercased (Unicode) name text: spaces collapsed, commas written ", ". "" = no search. */
  name: string;
  /** Uppercased, for a part of the Hospital Number. */
  hospitalNumber: string;
  /** A real date (`YYYY-MM-DD`) when the whole query is a date, else null. */
  birthdate: string | null;
  /**
   * Digit strings to look for in the stored contact number (at least
   * MIN_PHONE_DIGITS each). Empty when the query isn't a phone number.
   */
  phoneDigits: string[];
};

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
/** Only digits and the characters people type in phone numbers; a `+` only before the digits. */
const PHONE_LIKE = /^[\s(]*\+?[\d\s().-]+$/;
/** An international `+63` start, however it is spaced or bracketed: "+63", "+ 63", "(+63)". */
const PLUS_63 = /^[\s(]*\+[\s(]*6[\s.-]*3/;

const pad = (value: string) => value.padStart(2, "0");

/**
 * A whole-query birthdate: `YYYY-MM-DD` or `MM/DD/YYYY`, as `YYYY-MM-DD`,
 * only when it is a real calendar date (02/30/1950 is not). Else null.
 */
export function parseBirthdateQuery(query: string): string | null {
  const text = query.trim();
  let date: string | null = null;
  const iso = ISO_DATE.exec(text);
  if (iso) date = `${iso[1]}-${pad(iso[2]!)}-${pad(iso[3]!)}`;
  const us = US_DATE.exec(text);
  if (us) date = `${us[3]}-${pad(us[1]!)}-${pad(us[2]!)}`;
  return date !== null && isOpdDate(date) ? date : null;
}

/**
 * The digits to look for in a contact number, when the query looks like a
 * phone number (digits, spaces, `+ ( ) - .` only). A `+63` prefix (also "+ 63" or "(+63)") reads as
 * `0` (`+63 917 123 4567` → `09171234567`); a bare `63` prefix is tried both
 * ways. Fewer than MIN_PHONE_DIGITS digits give nothing.
 */
export function parsePhoneQuery(query: string): string[] {
  const text = query.trim();
  if (!PHONE_LIKE.test(text)) return [];
  const digits = text.replace(/\D/g, "");
  const candidates = new Set<string>();
  if (PLUS_63.test(text)) {
    candidates.add(`0${digits.slice(2)}`);
  } else {
    candidates.add(digits);
    if (digits.startsWith("63")) candidates.add(`0${digits.slice(2)}`);
  }
  return [...candidates].filter((value) => value.length >= MIN_PHONE_DIGITS);
}

/** The fewest and most digits a stored contact number has (landlines included). */
export const CONTACT_DIGITS_MIN = 7;
export const CONTACT_DIGITS_MAX = 11;

/**
 * A contact number as stored (Story 3.2): digits only, in the `0…` form.
 * After a `+63` or bare `63` country code, a trunk `0` is dropped and `0`
 * put in front (`+63 917 123 4567`, `(+63) 0917 123 4567` → `09171234567`;
 * `632 8123 4567` → `0281234567`). A 10-digit number starting with 9 is a
 * mobile number missing its `0`. Spaces, dashes, dots and brackets are
 * dropped. Returns null unless the result has 7–11 digits, or for any other
 * `+` country code.
 */
export function normalizeContactNumber(raw: string): string | null {
  const text = raw.trim();
  if (!PHONE_LIKE.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  let national: string | null = null;
  if (PLUS_63.test(text)) national = digits.slice(2);
  else if (text.includes("+")) return null;
  // A bare 63 is a country code only before a full national number (9+ digits), not on a short local number.
  else if (digits.startsWith("63") && digits.length >= 11) national = digits.slice(2);
  if (national !== null) digits = `0${national.replace(/^0/, "")}`;
  else if (digits.length === 10 && digits.startsWith("9")) digits = `0${digits}`;
  return digits.length >= CONTACT_DIGITS_MIN && digits.length <= CONTACT_DIGITS_MAX ? digits : null;
}

/** Letters of any script (ñ included), spaces, `.`, `'` and `-`, with at least one letter. */
export const PERSON_NAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M} .'-]+$/u;

/** "dela cruz" → "Dela Cruz": each word's first letter capitalized (also after - and '). */
function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * The last and first names a finder query looks like, to prefill the
 * registration form: "dela cruz, juan" (last, first) or "juan dela cruz"
 * (first word is the first name, the rest the last name); one word is a last
 * name. Text typed all in lower or upper case is title-cased; mixed case is
 * kept as typed. Null when the query isn't a name (a date, a phone number, a
 * Hospital Number, or other characters).
 */
export function guessNameFromQuery(raw: string): { lastName: string; firstName: string } | null {
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text || /\d/.test(text)) return null;
  const parts = text.split(",");
  if (parts.length > 2) return null;
  if (!parts.every((part) => part.trim() === "" || PERSON_NAME_PATTERN.test(part.trim()))) return null;
  const tidy = (value: string) => {
    const trimmed = value.trim().slice(0, PATIENT_NAME_MAX).trim();
    return trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase() ? titleCase(trimmed) : trimmed;
  };
  if (parts.length === 2) {
    const [last, first] = parts as [string, string];
    if (!last.trim()) return null;
    return { lastName: tidy(last), firstName: tidy(first) };
  }
  const words = text.split(" ");
  if (words.length === 1) return { lastName: tidy(text), firstName: "" };
  return { lastName: tidy(words.slice(1).join(" ")), firstName: tidy(words[0]!) };
}

/** Collapse spaces and write commas as ", " (so "dela cruz,juan" finds "dela cruz, juan"). */
function normalizeNameText(query: string): string {
  return query
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything one search box query can match. */
export function parsePatientQuery(raw: string | undefined): PatientQuery {
  const q = (raw ?? "").trim().slice(0, MAX_QUERY_LENGTH).trim();
  const birthdate = parseBirthdateQuery(q);
  return {
    name: normalizeNameText(q),
    hospitalNumber: q.toUpperCase(),
    birthdate,
    // "1950-03-15" is a date, not the digits 19500315.
    phoneDigits: birthdate ? [] : parsePhoneQuery(q),
  };
}
