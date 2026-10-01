import "server-only";
import { z } from "zod";
import {
  normalizeUsername,
  STAFF_ROLES,
  validateFullName,
  validatePassword,
  validateUsername,
} from "./staff-rules";

/*
 * Input shapes for the staff Server Actions (Zod). The account rules come from
 * `staff-rules.ts`; the Role and Facility rules are the service's.
 */

const staffId = z.string("Choose a staff member.").trim().min(1, "Choose a staff member.").max(64);

/** Runs a staff-rules validator as a Zod check on an already-transformed string. */
function rule(validate: (value: string) => string | null) {
  return (value: string, ctx: z.RefinementCtx) => {
    const message = validate(value);
    if (message) ctx.addIssue({ code: "custom", message });
  };
}

const fullName = z.string("Enter the full name.").trim().superRefine(rule(validateFullName));
const username = z
  .string("Enter a username.")
  .transform(normalizeUsername)
  .superRefine(rule(validateUsername));
// Never trimmed or echoed back: the password is used exactly as typed.
const password = z.string("Enter a temporary password.").superRefine(rule(validatePassword));
const role = z.enum(STAFF_ROLES, "Choose a Role.");
const facilityIds = z
  .array(z.string().trim().min(1).max(64), "Choose Facilities.")
  .max(50)
  .default([])
  .transform((ids) => [...new Set(ids)]);

export const staffIdSchema = z.object({ id: staffId });

export const createStaffSchema = z.object({
  name: fullName,
  username,
  role,
  facilityIds,
  password,
});

export const updateStaffSchema = z.object({
  id: staffId,
  name: fullName,
  role,
  facilityIds,
});

export const setPasswordSchema = z.object({ id: staffId, password });

export type CreateStaffInput = z.output<typeof createStaffSchema>;
export type UpdateStaffInput = z.output<typeof updateStaffSchema>;
export type SetPasswordInput = z.output<typeof setPasswordSchema>;

/** The first message for each top-level field, for errors shown on the form. */
export function staffFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}
