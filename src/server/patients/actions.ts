"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { fieldErrorsOf } from "@/lib/field-errors";
import { patientRecordPath } from "@/lib/patient-links";
import { can } from "@/server/auth/permissions";
import { requireStaff } from "@/server/auth/session";
import { isDomainError } from "@/server/db/errors";
import { searchPatients, toFinderRow, type PatientFinderRow } from "./queries";
import { PatientError } from "./repo";
import { FINDER_LIMIT, patientEditSchema, patientRegistrationSchema, patientSearchSchema } from "./schemas";
import { createPatient, updatePatient, type CreatePatientOutcome, type UpdatePatientOutcome } from "./service";

export type { PatientFinderRow } from "./queries";

export type PatientFinderData = {
  /** The trimmed query these results are for. */
  q: string;
  rows: PatientFinderRow[];
  /** All matches, so the finder can say when there are more than it shows. */
  total: number;
};

/**
 * The Patient finder's search (on /triage): Zod, then `requireStaff()`,
 * then `can("patients.view")`. Read-only and not audited. Never logs the query.
 */
export async function searchPatientsAction(input: unknown): Promise<ActionResult<PatientFinderData>> {
  const parsed = patientSearchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid", message: "Type a name, Hospital Number, birthdate or phone." } };
  }
  const user = await requireStaff();
  if (!can(user, "patients.view")) {
    return { ok: false, error: { code: "forbidden", message: "You don't have permission to find patients." } };
  }
  const { q } = parsed.data;
  if (!q) return { ok: true, data: { q, rows: [], total: 0 } };
  try {
    const result = searchPatients({ q, page: 1, pageSize: FINDER_LIMIT });
    return { ok: true, data: { q, rows: result.rows.map(toFinderRow), total: result.total } };
  } catch (error) {
    // The error type and message only: never the query or patient data.
    console.error("patient search failed:", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: { code: "failed", message: "Couldn't search patients. Try again." } };
  }
}

/**
 * What registering returns: the new patient (the finder row), or the
 * possible matches when some aren't in the input's `confirmedMatchIds`.
 */
export type RegisterPatientData = CreatePatientOutcome;

/**
 * Register a new patient (Story 3.2): Zod, then `requireStaff()`, then
 * `can("patients.register")`, then `createPatient`. Failed validation is
 * not audited. Never logs patient data.
 */
export async function registerPatientAction(input: unknown): Promise<ActionResult<RegisterPatientData>> {
  const parsed = patientRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid", message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) },
    };
  }
  const user = await requireStaff();
  if (!can(user, "patients.register")) {
    return { ok: false, error: { code: "forbidden", message: "You don't have permission to register patients." } };
  }
  try {
    const outcome = createPatient(parsed.data, { type: "staff", id: user.id, name: user.name });
    return { ok: true, data: outcome };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: { code: error.code, message: error.message } };
    // The error type only: never the input.
    console.error("patient registration failed:", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: { code: "failed", message: "Couldn't register the patient. Try again." } };
  }
}

/**
 * What saving an edit returns: whether anything changed and the (new)
 * display name, or the possible matches when a new name and birthdate match
 * another active patient not in `confirmedMatchIds`.
 */
export type UpdatePatientData = UpdatePatientOutcome;

/**
 * Edit a patient's demographics (Story 3.3): Zod, then `requireStaff()`,
 * then `can("patients.edit")`, then `updatePatient`. Failed validation and
 * refusals are not audited. Never logs patient data. There is no delete.
 */
export async function updatePatientAction(input: unknown): Promise<ActionResult<UpdatePatientData>> {
  const parsed = patientEditSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = fieldErrorsOf(parsed.error);
    if (fieldErrors.id) return { ok: false, error: { code: PatientError.NotFound, message: fieldErrors.id } };
    if (fieldErrors.expectedUpdatedAt) {
      return { ok: false, error: { code: PatientError.Stale, message: fieldErrors.expectedUpdatedAt } };
    }
    return { ok: false, error: { code: "invalid", message: "Check the highlighted fields.", fieldErrors } };
  }
  const user = await requireStaff();
  if (!can(user, "patients.edit")) {
    return { ok: false, error: { code: "forbidden", message: "You don't have permission to edit patient records." } };
  }
  try {
    const outcome = updatePatient(parsed.data, { type: "staff", id: user.id, name: user.name });
    // Only a real change re-renders the page: each render writes a `patient.viewed` row.
    if (outcome.status === "updated" && outcome.changed) revalidatePath(patientRecordPath(parsed.data.id));
    return { ok: true, data: outcome };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: { code: error.code, message: error.message } };
    // The error type only: never the input.
    console.error("patient update failed:", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: { code: "failed", message: "Couldn't save the changes. Try again." } };
  }
}
