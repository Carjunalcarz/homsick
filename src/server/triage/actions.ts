"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { fieldErrorsOf } from "@/lib/field-errors";
import { patientRecordPath } from "@/lib/patient-links";
import { can } from "@/server/auth/permissions";
import { requireStaff } from "@/server/auth/session";
import { isDomainError } from "@/server/db/errors";
import { QueueError } from "@/server/queue/repo";
import { TriageError } from "./repo";
import { triageContextSchema, triageInputSchema } from "./schemas";
import {
  getTriageContext,
  recordTriage,
  TriageFieldError,
  type RecordTriageOutcome,
  type TriageContext,
} from "./service";

export type { IssuedNumber, RecordTriageOutcome, TriageContext } from "./service";
export type { FacilityTile } from "@/server/queue/queries";

const NOT_FOUND = "This patient record no longer exists.";

/**
 * What the triage form loads when a patient is picked: the enabled Priority
 * Categories and active Urgency Levels, the patient's sex and age, whether
 * a Senior Citizen or PWD ID is on file (not the ID itself) and whether a
 * Visit is already open today. Zod, then `requireStaff()`, then
 * `can("triage.record")`. Read-only and not audited.
 */
export async function getTriageContextAction(input: unknown): Promise<ActionResult<TriageContext>> {
  const parsed = triageContextSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: TriageError.NotFound, message: NOT_FOUND } };
  const user = await requireStaff();
  if (!can(user, "triage.record")) {
    return { ok: false, error: { code: "forbidden", message: "You don't have permission to record triage." } };
  }
  try {
    const context = getTriageContext(parsed.data.patientId);
    if (!context) return { ok: false, error: { code: TriageError.NotFound, message: NOT_FOUND } };
    return { ok: true, data: context };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: { code: error.code, message: error.message } };
    console.error("triage context failed:", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: { code: "failed", message: "Couldn't load the triage form. Try again." } };
  }
}

/**
 * Record triage and issue the Queue Number or direct to the ER (Stories 3.4
 * and 3.5): Zod, then `requireStaff()`, then `can("triage.record")`, then
 * `recordTriage`. Failed validation and refusals write nothing. Never logs
 * patient data, Vital Signs or the complaint.
 */
export async function recordTriageAction(input: unknown): Promise<ActionResult<RecordTriageOutcome>> {
  const parsed = triageInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = fieldErrorsOf(parsed.error);
    if (fieldErrors.patientId) return { ok: false, error: { code: TriageError.NotFound, message: NOT_FOUND } };
    return { ok: false, error: { code: "invalid", message: "Check the highlighted fields.", fieldErrors } };
  }
  const user = await requireStaff();
  if (!can(user, "triage.record")) {
    return { ok: false, error: { code: "forbidden", message: "You don't have permission to record triage." } };
  }
  try {
    const outcome = recordTriage(parsed.data, { type: "staff", id: user.id, name: user.name });
    // A typed ID changed the Patient Record: its page must show it.
    if (outcome.priorityIdEntered) revalidatePath(patientRecordPath(parsed.data.patientId));
    return { ok: true, data: outcome };
  } catch (error) {
    if (error instanceof TriageFieldError) {
      return {
        ok: false,
        error: { code: error.code, message: "Check the highlighted fields.", fieldErrors: { [error.field]: error.message } },
      };
    }
    if (isDomainError(error) && error.code === QueueError.FacilityUnavailable) {
      // Tied to the Facility tiles, so the form points there.
      return { ok: false, error: { code: error.code, message: error.message, fieldErrors: { facilityId: error.message } } };
    }
    if (isDomainError(error)) return { ok: false, error: { code: error.code, message: error.message } };
    // The error type only: never the input.
    console.error("triage save failed:", error instanceof Error ? error.name : typeof error);
    return { ok: false, error: { code: "failed", message: "Couldn't save the triage. Try again." } };
  }
}
