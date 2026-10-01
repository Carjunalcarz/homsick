// The triage input rules (Story 3.4, FR-7; the Facility or Direct to ER, Story 3.5). One Zod schema, used by
// `recordTriageAction` and mirrored by the form before it submits. Safe to
// import in client code. Rules that need the patient or the settings (age,
// sex, IDs on file, enabled categories) are checked again by the service.

import { z } from "zod";
import { PATIENT_ID_MAX } from "./patient-registration";
import { checkVital, requiredMessage, type VitalField } from "./vital-signs";

export const COMPLAINT_MAX = 500;

export const TRIAGE_MESSAGES = {
  complaint: "Enter the chief complaint.",
  complaintLength: `Keep the chief complaint to ${COMPLAINT_MAX} characters.`,
  urgency: "Choose an Urgency Level.",
  seniorAge: "Senior Citizen is for patients aged 60 and over.",
  pregnantSex: "Pregnant is for female patients only.",
  categoryUnavailable: "That Priority Category isn't available. Choose another.",
  urgencyUnavailable: "That Urgency Level isn't available any more. Choose another.",
  idLength: `Keep IDs to ${PATIENT_ID_MAX} characters.`,
  seniorId: "Enter the Senior Citizen ID, or tick ID not presented.",
  pwdId: "Enter the PWD ID, or tick ID not presented.",
  facility: "Choose a Facility.",
  facilityUnknown: "That Facility isn't available. Choose another.",
  erOnly: "Direct to ER is only for an ER Urgency Level.",
  erConfirm: "An ER Urgency Level is directed to the ER: confirm Direct to ER. No queue number is issued.",
} as const;

/** The Priority Category codes that need an ID (RA 9994, RA 10754), and the patient field that holds it. */
export const ID_CATEGORIES = { senior_citizen: "seniorCitizenId", pwd: "pwdId" } as const;
export type IdCategory = keyof typeof ID_CATEGORIES;
export type PriorityIdField = (typeof ID_CATEGORIES)[IdCategory];

export function isIdCategory(code: string | null | undefined): code is IdCategory {
  return code === "senior_citizen" || code === "pwd";
}

export const SENIOR_MIN_AGE = 60;

/** How a Senior Citizen or PWD entry's ID was handled (`priority_id_status`). */
export const PRIORITY_ID_STATUSES = ["on_file", "entered", "not_presented"] as const;
export type PriorityIdStatus = (typeof PRIORITY_ID_STATUSES)[number];

const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "") ? undefined : value;

/** A Vital Sign as typed (text) or sent (number): impossible values are refused here. */
function vital(field: VitalField) {
  return z.preprocess(blankToUndefined, z.unknown()).transform((value, ctx) => {
    if (value !== undefined && typeof value !== "string" && typeof value !== "number") {
      ctx.addIssue({ code: "custom", message: requiredMessage(field) });
      return z.NEVER;
    }
    const check = checkVital(field, value as string | number | undefined);
    if (check.status === "invalid") {
      ctx.addIssue({ code: "custom", message: check.message });
      return z.NEVER;
    }
    return check.status === "empty" ? null : check.value;
  });
}

export const triageInputSchema = z
  .object({
    patientId: z.string("Patient not found.").trim().min(1, "Patient not found.").max(64, "Patient not found."),
    chiefComplaint: z
      .string(TRIAGE_MESSAGES.complaint)
      .transform((value) => value.normalize("NFC").trim())
      .pipe(z.string().min(1, TRIAGE_MESSAGES.complaint).max(COMPLAINT_MAX, TRIAGE_MESSAGES.complaintLength)),
    temperatureC: vital("temperatureC"),
    bpSystolic: vital("bpSystolic"),
    bpDiastolic: vital("bpDiastolic"),
    pulse: vital("pulse"),
    respiratoryRate: vital("respiratoryRate"),
    spo2: vital("spo2"),
    weightKg: vital("weightKg"),
    urgencyLevelId: z.string(TRIAGE_MESSAGES.urgency).trim().min(1, TRIAGE_MESSAGES.urgency).max(64, TRIAGE_MESSAGES.urgency),
    /** A Priority Category code; blank or missing is "None". */
    priorityCategory: z.preprocess(blankToUndefined, z.string().trim().max(40).optional()),
    /** The Senior Citizen or PWD ID typed in, when none is on file. */
    priorityId: z.preprocess(
      blankToUndefined,
      z
        .string(TRIAGE_MESSAGES.idLength)
        .transform((value) => value.trim())
        .pipe(z.string().max(PATIENT_ID_MAX, TRIAGE_MESSAGES.idLength))
        .optional(),
    ),
    /** "ID not presented" ticked. */
    idNotPresented: z.boolean().optional(),
    /** The Facility to queue at (non-ER levels only); blank or missing is none. */
    facilityId: z.preprocess(blankToUndefined, z.string().trim().max(64, TRIAGE_MESSAGES.facilityUnknown).optional()),
    /** The confirmed Direct to ER (ER levels only). */
    directToEr: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    // Required vitals are refused by their own field; this is the pair rule.
    if (typeof input.bpSystolic === "number" && typeof input.bpDiastolic === "number") {
      const check = checkVital("bpDiastolic", input.bpDiastolic, { systolic: input.bpSystolic });
      if (check.status === "invalid") ctx.addIssue({ code: "custom", path: ["bpDiastolic"], message: check.message });
    }
  });

export type TriageInput = z.output<typeof triageInputSchema>;

/** The form's fields in visual (and Tab) order: the first one with an error gets focus. */
export const TRIAGE_FIELDS = [
  "chiefComplaint",
  "temperatureC",
  "bpSystolic",
  "bpDiastolic",
  "pulse",
  "respiratoryRate",
  "spo2",
  "weightKg",
  "urgencyLevelId",
  "priorityCategory",
  "priorityId",
  "facilityId",
] as const;

export type TriageField = (typeof TRIAGE_FIELDS)[number];

export function isTriageField(key: string): key is TriageField {
  return (TRIAGE_FIELDS as readonly string[]).includes(key);
}

/** An Urgency Level's badge tone: rank 1 (and ER) `urgent`, the lowest non-ER rank `routine`, anything between `abnormal`. */
export const URGENCY_TONES = ["urgent", "abnormal", "routine"] as const;
export type UrgencyTone = (typeof URGENCY_TONES)[number];

type RankedLevel = { isEr: boolean; rank: number | null };

/**
 * The lowest (least urgent, highest number) rank among the non-ER levels,
 * or null when there are none. The one place this is computed: the badge
 * tone, the form and the queue group (`sortGroupFor`) all use it.
 */
export function lowestNonErRank(levels: readonly RankedLevel[]): number | null {
  let lowest: number | null = null;
  for (const level of levels) {
    if (level.isEr || level.rank === null) continue;
    if (lowest === null || level.rank > lowest) lowest = level.rank;
  }
  return lowest;
}

/**
 * The badge tone of `level` among `levels` (the active ones). Stored with the
 * triage snapshot at save time, so a later settings change never recolours
 * an old Visit.
 */
export function urgencyTone(level: RankedLevel, levels: readonly RankedLevel[]): UrgencyTone {
  if (level.isEr || level.rank === null || level.rank <= 1) return "urgent";
  const lowest = lowestNonErRank([...levels, level]);
  if (lowest !== null && level.rank >= lowest) return "routine";
  return "abnormal";
}
