"use server";
import "server-only";
import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { ActionError, ActionResult } from "@/lib/action-result";
import { isDomainError } from "@/server/db/errors";
import { can } from "./permissions";
import { requireStaff, sessionHeaders, type StaffUser } from "./session";
import {
  createStaffSchema,
  setPasswordSchema,
  staffFieldErrors,
  staffIdSchema,
  updateStaffSchema,
} from "./staff-schemas";
import {
  createStaff,
  deactivateStaff,
  reactivateStaff,
  setTemporaryPassword,
  StaffError,
  unlockStaff,
  updateStaff,
  type StaffActor,
  type StaffOutcome,
} from "./staff-service";

/** What the staff page needs back after a command. */
export type StaffActionData = { changed: boolean; name: string };

const STAFF_PATH = "/admin/staff";

const FORBIDDEN: ActionError = { code: "forbidden", message: "You don't have permission to manage staff accounts." };
const INVALID = "Check the highlighted fields.";
const FAILED = "Couldn't save the change. Try again.";

function actorOf(user: StaffUser): StaffActor {
  return { type: "staff", id: user.id, name: user.name };
}

/** Which form field a domain error belongs to, if any. */
const ERROR_FIELD: Record<string, string> = {
  [StaffError.UsernameTaken]: "username",
  [StaffError.UsernameInvalid]: "username",
  [StaffError.FacilitiesRequired]: "facilityIds",
  [StaffError.FacilitiesNotAllowed]: "facilityIds",
  [StaffError.FacilityUnavailable]: "facilityIds",
};

/**
 * The AD-3 command pipeline: validate, identify, authorize, then run one
 * service command. Expected failures come back as results, never throws.
 * `roleField` puts a guard-rail error (self, last Admin) on the Role field
 * of the edit form.
 */
async function runCommand<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  command: (input: z.output<S>, actor: StaffActor, headers: Headers) => StaffOutcome | Promise<StaffOutcome>,
  options: { roleField?: boolean } = {},
): Promise<ActionResult<StaffActionData>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid", message: INVALID, fieldErrors: staffFieldErrors(parsed.error) } };
  }
  const user = await requireStaff();
  if (!can(user, "staff.manage")) return { ok: false, error: FORBIDDEN };

  try {
    const outcome = await command(parsed.data, actorOf(user), await sessionHeaders());
    // Even when nothing changed: the page may be showing stale state.
    revalidatePath(STAFF_PATH);
    return { ok: true, data: { changed: outcome.changed, name: outcome.member.name } };
  } catch (error) {
    if (isDomainError(error)) {
      // The refusal may come from state the page doesn't show yet.
      revalidatePath(STAFF_PATH);
      let field = ERROR_FIELD[error.code];
      if (!field && options.roleField && (error.code === StaffError.LastAdmin || error.code === StaffError.SelfAction)) {
        field = "role";
      }
      return {
        ok: false,
        error: { code: error.code, message: error.message, ...(field ? { fieldErrors: { [field]: error.message } } : {}) },
      };
    }
    if (isAPIError(error)) {
      // Better Auth refused (e.g. the session ended mid-request). Never echo input.
      return { ok: false, error: { code: "auth_error", message: FAILED } };
    }
    // Unexpected: log the error type and message only (no input, no patient data).
    console.error("staff action failed:", error instanceof Error ? `${error.name}: ${error.message}` : typeof error);
    return { ok: false, error: { code: "failed", message: FAILED } };
  }
}

/** Create a staff account with a temporary password (Admins only). */
export async function createStaffAction(input: unknown): Promise<ActionResult<StaffActionData>> {
  return runCommand(createStaffSchema, input, (data, actor, headers) => createStaff(data, actor, headers));
}

/** Save a staff member's name, Role and Facilities (Admins only). */
export async function updateStaffAction(input: unknown): Promise<ActionResult<StaffActionData>> {
  return runCommand(updateStaffSchema, input, (data, actor, headers) => updateStaff(data, actor, headers), {
    roleField: true,
  });
}

/** Set a new temporary password (Admins only). */
export async function setTemporaryPasswordAction(input: unknown): Promise<ActionResult<StaffActionData>> {
  return runCommand(setPasswordSchema, input, (data, actor, headers) => setTemporaryPassword(data, actor, headers));
}

/** Unlock an account locked after failed sign-ins (Admins only). */
export async function unlockStaffAction(input: unknown): Promise<ActionResult<StaffActionData>> {
  return runCommand(staffIdSchema, input, (data, actor) => unlockStaff(data.id, actor));
}

/** Deactivate an account: it can't sign in and its sessions end (Admins only). */
export async function deactivateStaffAction(input: unknown): Promise<ActionResult<StaffActionData>> {
  return runCommand(staffIdSchema, input, (data, actor, headers) => deactivateStaff(data.id, actor, headers));
}

/** Reactivate a deactivated account (Admins only). */
export async function reactivateStaffAction(input: unknown): Promise<ActionResult<StaffActionData>> {
  return runCommand(staffIdSchema, input, (data, actor, headers) => reactivateStaff(data.id, actor, headers));
}
