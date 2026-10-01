// The Patient registration rules (Story 3.2, FR-5). One Zod schema, used by
// the server action and mirrored by the form before it submits. Safe to
// import in client code.

import { z } from "zod";
import { PATIENT_NAME_MAX, PATIENT_SEXES } from "./patient-name";
import { CONTACT_DIGITS_MAX, CONTACT_DIGITS_MIN, normalizeContactNumber, PERSON_NAME_PATTERN } from "./patient-search";
import { isOpdDate, opdDate } from "./time";

export { PATIENT_NAME_MAX };
/** The earliest birthdate accepted (also the date input's `min`). */
export const BIRTHDATE_MIN = "1900-01-01";
export const PATIENT_ADDRESS_MAX = 100;
export const PATIENT_ID_MAX = 30;

export const REGISTRATION_MESSAGES = {
  privacy: "Confirm the privacy notice was explained.",
  birthdateMissing: "Enter the birthdate.",
  birthdateInvalid: "Enter a real date.",
  birthdateTooEarly: "Birthdate must be 1900 or later.",
  birthdateFuture: "Birthdate can't be in the future.",
  sex: "Choose female or male.",
  nameChars: "Use letters, spaces, . ' and - only.",
  phone: `Enter a phone number with ${CONTACT_DIGITS_MIN} to ${CONTACT_DIGITS_MAX} digits.`,
  philhealth: "PhilHealth PIN must be 12 digits.",
  id: `Keep IDs to ${PATIENT_ID_MAX} characters.`,
} as const;

/** A real calendar date written `YYYY-MM-DD`, in any year from 0001 (so a pre-1900 date can be told apart from a typo). */
function isAnyCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(2000, month - 1, day));
  utc.setUTCFullYear(year);
  return year > 0 && utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** Missing, null and blank all mean "not given". */
const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "") ? undefined : value;

function personName(label: string) {
  const length = `${label} must be 1–${PATIENT_NAME_MAX} characters.`;
  return z
    .string(`Enter the ${label.toLowerCase()}.`)
    .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, `Enter the ${label.toLowerCase()}.`)
        .max(PATIENT_NAME_MAX, length)
        .regex(PERSON_NAME_PATTERN, REGISTRATION_MESSAGES.nameChars),
    );
}

function optionalPersonName(label: string) {
  const length = `${label} must be 1–${PATIENT_NAME_MAX} characters.`;
  return z.preprocess(
    blankToUndefined,
    z
      .string(`Enter the ${label.toLowerCase()}.`)
      .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
      .pipe(z.string().max(PATIENT_NAME_MAX, length).regex(PERSON_NAME_PATTERN, REGISTRATION_MESSAGES.nameChars))
      .optional(),
  );
}

function requiredText(missing: string, max: number) {
  return z
    .string(missing)
    .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, missing).max(max, `Keep this to ${max} characters.`));
}

function phone(missing: string) {
  return z.string(missing).transform((value, ctx) => {
    if (value.trim() === "") {
      ctx.addIssue({ code: "custom", message: missing });
      return z.NEVER;
    }
    const digits = normalizeContactNumber(value);
    if (digits === null) {
      ctx.addIssue({ code: "custom", message: REGISTRATION_MESSAGES.phone });
      return z.NEVER;
    }
    return digits;
  });
}

const optionalPhone = z.preprocess(blankToUndefined, phone("Enter a phone number.").optional());

/** 12 digits (spaces and dashes ignored), stored as `XX-XXXXXXXXX-X`. */
const philhealthPin = z.preprocess(
  blankToUndefined,
  z
    .string(REGISTRATION_MESSAGES.philhealth)
    .transform((value, ctx) => {
      const trimmed = value.trim();
      const digits = trimmed.replace(/[\s-]/g, "");
      if (!/^\d{12}$/.test(digits)) {
        ctx.addIssue({ code: "custom", message: REGISTRATION_MESSAGES.philhealth });
        return z.NEVER;
      }
      return `${digits.slice(0, 2)}-${digits.slice(2, 11)}-${digits.slice(11)}`;
    })
    .optional(),
);

const optionalId = z.preprocess(
  blankToUndefined,
  z
    .string(REGISTRATION_MESSAGES.id)
    .transform((value) => value.trim())
    .pipe(z.string().max(PATIENT_ID_MAX, REGISTRATION_MESSAGES.id))
    .optional(),
);

/**
 * The demographic fields a patient has, shared by registering (Story 3.2) and
 * editing (Story 3.3). `today` gives the Manila date that a birthdate may not
 * pass (read at parse time, so a long-lived schema never goes stale).
 */
function demographicFields(today: () => string) {
  return {
    lastName: personName("Last name"),
    firstName: personName("First name"),
    middleName: optionalPersonName("Middle name"),
    suffix: optionalPersonName("Suffix"),
    sex: z.enum(PATIENT_SEXES, REGISTRATION_MESSAGES.sex),
    birthdate: z.string(REGISTRATION_MESSAGES.birthdateMissing).transform((value, ctx) => {
      const date = value.trim();
      if (date === "") {
        ctx.addIssue({ code: "custom", message: REGISTRATION_MESSAGES.birthdateMissing });
        return z.NEVER;
      }
      if (!isOpdDate(date)) {
        // A real date before 1900 gets its own message.
        const typed = value.trim();
        const early = typed < BIRTHDATE_MIN && isAnyCalendarDate(typed);
        ctx.addIssue({ code: "custom", message: early ? REGISTRATION_MESSAGES.birthdateTooEarly : REGISTRATION_MESSAGES.birthdateInvalid });
        return z.NEVER;
      }
      if (date > today()) {
        ctx.addIssue({ code: "custom", message: REGISTRATION_MESSAGES.birthdateFuture });
        return z.NEVER;
      }
      return date;
    }),
    addressBarangay: requiredText("Enter the barangay.", PATIENT_ADDRESS_MAX),
    addressMunicipality: requiredText("Enter the municipality.", PATIENT_ADDRESS_MAX),
    contactNumber: phone("Enter a contact number."),
    philhealthPin,
    seniorCitizenId: optionalId,
    pwdId: optionalId,
    emergencyContactName: optionalPersonName("Emergency contact name"),
    emergencyContactNumber: optionalPhone,
    /**
     * "Create anyway" / "Save anyway": the ids of the possible matches shown
     * on the card. A match found at save time that isn't listed asks again.
     */
    confirmedMatchIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  };
}

/** The registration input: the demographic fields plus the privacy notice checkbox. */
export function makeRegistrationSchema(today: () => string = () => opdDate()) {
  return z.object({
    ...demographicFields(today),
    privacyNoticeExplained: z.literal(true, REGISTRATION_MESSAGES.privacy),
  });
}

export const patientRegistrationSchema = makeRegistrationSchema();

export type PatientRegistrationInput = z.output<typeof patientRegistrationSchema>;

export const STALE_MESSAGE = "This record changed since you opened it. Reload to see the latest details.";

/**
 * The edit input (Story 3.3): the same demographic rules, the patient's id,
 * and no privacy checkbox (`privacy_notice_at` never changes). The Hospital
 * Number and the `created_*` columns are not part of it.
 */
export function makePatientEditSchema(today: () => string = () => opdDate()) {
  return z.object({
    id: z.string("Patient not found.").trim().min(1, "Patient not found.").max(64, "Patient not found."),
    /**
     * The record's `updated_at` when the form opened. A save is refused
     * (`stale`) when the record has changed since, so one editor never
     * silently reverts another's save.
     */
    expectedUpdatedAt: z.string(STALE_MESSAGE).min(1, STALE_MESSAGE).max(40, STALE_MESSAGE),
    ...demographicFields(today),
  });
}

export const patientEditSchema = makePatientEditSchema();

export type PatientEditInput = z.output<typeof patientEditSchema>;

/** The demographic fields an edit may change, in the order they are compared and audited. */
export const PATIENT_EDIT_FIELDS = [
  "lastName",
  "firstName",
  "middleName",
  "suffix",
  "sex",
  "birthdate",
  "addressBarangay",
  "addressMunicipality",
  "contactNumber",
  "philhealthPin",
  "seniorCitizenId",
  "pwdId",
  "emergencyContactName",
  "emergencyContactNumber",
] as const;

export type PatientEditField = (typeof PATIENT_EDIT_FIELDS)[number];

/** The form's fields in visual order: the first one with an error gets focus. */
export const REGISTRATION_FIELDS = [
  "lastName",
  "firstName",
  "sex",
  "birthdate",
  "contactNumber",
  "addressBarangay",
  "addressMunicipality",
  "middleName",
  "suffix",
  "philhealthPin",
  "seniorCitizenId",
  "pwdId",
  "emergencyContactName",
  "emergencyContactNumber",
  "privacyNoticeExplained",
] as const;

export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];

/** The optional fields, collapsed under "More details". */
export const OPTIONAL_REGISTRATION_FIELDS: readonly RegistrationField[] = [
  "middleName",
  "suffix",
  "philhealthPin",
  "seniorCitizenId",
  "pwdId",
  "emergencyContactName",
  "emergencyContactNumber",
];
