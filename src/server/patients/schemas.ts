import "server-only";
import { z } from "zod";
import { MAX_QUERY_LENGTH } from "@/lib/url-query";

/** Input of the Patient finder's search action. Longer text is cut, like the list URL. */
export const patientSearchSchema = z.object({
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_QUERY_LENGTH).trim()),
});

export type PatientSearchActionInput = z.input<typeof patientSearchSchema>;

/** The most results the Patient finder shows. */
export const FINDER_LIMIT = 8;

/**
 * Input of `registerPatientAction`: the shared rules in
 * `src/lib/patient-registration.ts`, which the form mirrors before it submits.
 */
export { patientRegistrationSchema, type PatientRegistrationInput } from "@/lib/patient-registration";

/**
 * Input of `updatePatientAction` (Story 3.3): the same rules without the
 * privacy checkbox, plus the patient's id.
 */
export { patientEditSchema, type PatientEditInput } from "@/lib/patient-registration";
