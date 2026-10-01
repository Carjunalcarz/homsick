"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { fieldErrorsOf } from "@/lib/field-errors";
import type { Actor } from "@/server/audit/service";
import { can, type Action } from "@/server/auth/permissions";
import { requireStaff, type StaffUser } from "@/server/auth/session";
import { isDomainError } from "@/server/db/errors";
import {
  NAME_TAKEN,
  PREFIX_TAKEN,
  facilityIdSchema,
  setPriorityCategoryEnabledSchema,
  updateClinicalScheduleSchema,
  updateFacilitySchema,
  updateOpdThresholdsSchema,
  updateUrgencyLevelsSchema,
} from "./schemas";
import {
  deactivateFacility,
  FacilityError,
  FieldDomainError,
  reactivateFacility,
  setPriorityCategoryEnabled,
  updateClinicalSchedule,
  updateFacility,
  updateOpdThresholds,
  updateUrgencyLevels,
  type CommandOutcome,
} from "./service";

/** What the settings page needs back after a Facility command. */
export type FacilityActionData = { changed: boolean; name: string };

const SETTINGS_PATH = "/admin/settings";

const FORBIDDEN = { code: "forbidden", message: "You don't have permission to change OPD settings." };
const INVALID = "Check the highlighted fields.";
const SAVE_FAILED = "Couldn't save the change. Try again.";

function actorOf(user: StaffUser): Actor {
  return { type: "staff", id: user.id, name: user.name };
}

/**
 * The AD-3 command pipeline: validate, identify, authorize, then run one
 * service command. Expected failures come back as results, never throws.
 */
/** A SQLite UNIQUE violation on the active-name index (a race past the service's own check). */
function isNameUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE" && /facilities_active_name_unique|facilities\.name/.test(e.message)) {
      return true;
    }
  }
  return false;
}

async function runCommand<S extends z.ZodType<{ id: string }>>(
  schema: S,
  raw: unknown,
  action: Action,
  command: (input: z.output<S>, actor: Actor) => CommandOutcome,
): Promise<ActionResult<FacilityActionData>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid", message: INVALID, fieldErrors: fieldErrorsOf(parsed.error) } };
  }
  const user = await requireStaff();
  if (!can(user, action, parsed.data.id)) return { ok: false, error: FORBIDDEN };

  try {
    const outcome = command(parsed.data, actorOf(user));
    // Even when nothing changed: the page may be showing stale state.
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: { changed: outcome.changed, name: outcome.facility.name } };
  } catch (error) {
    if (isNameUniqueViolation(error)) {
      return {
        ok: false,
        error: { code: FacilityError.NameTaken, message: NAME_TAKEN, fieldErrors: { name: NAME_TAKEN } },
      };
    }
    if (!isDomainError(error)) throw error;
    switch (error.code) {
      case FacilityError.PrefixTaken:
        return {
          ok: false,
          error: { code: error.code, message: error.message, fieldErrors: { prefix: PREFIX_TAKEN } },
        };
      case FacilityError.NameTaken:
        return {
          ok: false,
          error: { code: error.code, message: error.message, fieldErrors: { name: NAME_TAKEN } },
        };
      default:
        return { ok: false, error: { code: error.code, message: error.message } };
    }
  }
}

/** Save the Facility form (Admins only). */
export async function updateFacilityAction(input: unknown): Promise<ActionResult<FacilityActionData>> {
  return runCommand(updateFacilitySchema, input, "settings.facilities.manage", (data, actor) =>
    updateFacility(data, actor),
  );
}

/** Deactivate a Facility (Admins only). */
export async function deactivateFacilityAction(input: unknown): Promise<ActionResult<FacilityActionData>> {
  return runCommand(facilityIdSchema, input, "settings.facilities.manage", (data, actor) =>
    deactivateFacility(data.id, actor),
  );
}

/** Reactivate a Facility (Admins only). */
export async function reactivateFacilityAction(input: unknown): Promise<ActionResult<FacilityActionData>> {
  return runCommand(facilityIdSchema, input, "settings.facilities.manage", (data, actor) =>
    reactivateFacility(data.id, actor),
  );
}

/* ---------- Clinical settings (FR-24) ---------- */

/** What the settings page needs back after a clinical settings command. */
export type ClinicalActionData = { changed: boolean };

/**
 * The AD-3 pipeline for the clinical settings commands: validate (field
 * errors keyed by their full path, e.g. `levels.1.rank`), identify,
 * authorize `settings.clinical.manage`, then run one command.
 */
async function runClinicalCommand<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  command: (input: z.output<S>, actor: Actor) => { changed: boolean },
): Promise<ActionResult<ClinicalActionData>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid", message: INVALID, fieldErrors: fieldErrorsOf(parsed.error, true) } };
  }
  const user = await requireStaff();
  if (!can(user, "settings.clinical.manage")) return { ok: false, error: FORBIDDEN };

  try {
    const outcome = command(parsed.data, actorOf(user));
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: { changed: outcome.changed } };
  } catch (error) {
    if (error instanceof FieldDomainError) {
      return { ok: false, error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } };
    }
    if (isDomainError(error)) return { ok: false, error: { code: error.code, message: error.message } };
    // Unexpected (e.g. SQLite busy or a constraint): log the error type and message only, never the input.
    console.error("settings action failed:", error instanceof Error ? `${error.name}: ${error.message}` : typeof error);
    return { ok: false, error: { code: "failed", message: SAVE_FAILED } };
  }
}

/** Save the whole Urgency Levels list (Admins only). */
export async function updateUrgencyLevelsAction(input: unknown): Promise<ActionResult<ClinicalActionData>> {
  return runClinicalCommand(updateUrgencyLevelsSchema, input, (data, actor) => updateUrgencyLevels(data, actor));
}

/** Turn a Priority Category on or off (Admins only; legally required ones need `confirmLegal`). */
export async function setPriorityCategoryEnabledAction(input: unknown): Promise<ActionResult<ClinicalActionData>> {
  return runClinicalCommand(setPriorityCategoryEnabledSchema, input, (data, actor) =>
    setPriorityCategoryEnabled(data, actor),
  );
}

/** Save an Animal Bite Center dose schedule (Admins only). */
export async function updateClinicalScheduleAction(input: unknown): Promise<ActionResult<ClinicalActionData>> {
  return runClinicalCommand(updateClinicalScheduleSchema, input, (data, actor) => updateClinicalSchedule(data, actor));
}

/** Save the prenatal target, No-show threshold and pre-close warning (Admins only). */
export async function updateOpdThresholdsAction(input: unknown): Promise<ActionResult<ClinicalActionData>> {
  return runClinicalCommand(updateOpdThresholdsSchema, input, (data, actor) => updateOpdThresholds(data, actor));
}
