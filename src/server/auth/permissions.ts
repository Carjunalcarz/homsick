import "server-only";
import { requireStaff, type StaffUser } from "./session";
import { isStaffRole, type StaffRole } from "./staff-rules";

/**
 * The single Role × action map (AD-4). Anything not listed here is denied.
 * Hiding UI is cosmetic only: every page and Server Action checks `can()`.
 *
 * Each action declares its Facility scope:
 * - "none": the Role alone decides.
 * - "facility": the action is about one Facility, passed to `can()`. Admins
 *   may act on any Facility; other Roles only on their assigned Facilities
 *   (`StaffUser.facilityIds`: active Facilities only).
 *
 * `nav.*` actions decide which top-nav items a Role sees. Hiding them is
 * cosmetic: each page checks its own action. They mirror the PRD FR2 matrix.
 *
 * Later stories add their actions here, with tests.
 */
export const PERMISSIONS = {
  /** Open the Admin OPD Settings page. */
  "settings.view": { roles: ["admin"], scope: "none" },
  /** Edit, deactivate and reactivate Facilities. */
  "settings.facilities.manage": { roles: ["admin"], scope: "none" },
  /** Edit Urgency Levels, Priority Categories, dose schedules and OPD thresholds. */
  "settings.clinical.manage": { roles: ["admin"], scope: "none" },
  /** Open the Admin Staff page. */
  "staff.view": { roles: ["admin"], scope: "none" },
  /** Create staff accounts, edit name/Role/Facilities, set a temporary password, unlock, deactivate, reactivate. */
  "staff.manage": { roles: ["admin"], scope: "none" },
  /** Open the read-only Admin audit log page (each view is itself audited). */
  "audit.view": { roles: ["admin"], scope: "none" },
  /** Find patients: the /patients list and the Patient finder on /triage (searching isn't audited). */
  "patients.view": { roles: ["admin", "triage_nurse", "facility_staff"], scope: "none" },
  /** Register a new Patient Record (the "New patient" row and form on /triage). */
  "patients.register": { roles: ["admin", "triage_nurse"], scope: "none" },
  /** Edit a Patient Record's demographics (the "Edit details" sheet on /patients/[id]). Viewing needs only `patients.view`. */
  "patients.edit": { roles: ["admin", "triage_nurse"], scope: "none" },
  /** Open /triage (the Patient finder and the triage form). */
  "triage.view": { roles: ["admin", "triage_nurse"], scope: "none" },
  /** Record triage for a patient, opening their Visit (the triage form on /triage). */
  "triage.record": { roles: ["admin", "triage_nurse"], scope: "none" },
  "nav.overview": { roles: ["admin", "triage_nurse", "facility_staff"], scope: "none" },
  "nav.triage": { roles: ["admin", "triage_nurse"], scope: "none" },
  "nav.queues": { roles: ["admin", "facility_staff"], scope: "none" },
  "nav.patients": { roles: ["admin", "triage_nurse", "facility_staff"], scope: "none" },
  "nav.appointments": { roles: ["admin", "triage_nurse", "facility_staff"], scope: "none" },
  "nav.directory": { roles: ["admin", "triage_nurse", "facility_staff"], scope: "none" },
} as const satisfies Record<string, { roles: readonly StaffRole[]; scope: "none" | "facility" }>;

export type Action = keyof typeof PERMISSIONS;
export type PermissionScope = "none" | "facility";

/** Who is asking: a Role, and the active Facilities they are assigned to. */
export type PermissionSubject = {
  role: StaffRole | string;
  facilityIds?: readonly string[];
};

/** Whether `user` may perform `action` (on `facilityId`, for Facility-scoped actions). */
export function can(
  user: PermissionSubject | null | undefined,
  action: Action,
  facilityId?: string,
): boolean {
  if (!user || !isStaffRole(user.role)) return false;
  // Deny by default: an unknown action (e.g. from a stale or forged caller).
  if (!Object.hasOwn(PERMISSIONS, action)) return false;
  return ruleAllows(PERMISSIONS[action], user, facilityId);
}

export type PermissionRule = { roles: readonly StaffRole[]; scope: PermissionScope };

/** Apply one map entry to a user. Exported for tests of the Facility scope. */
export function ruleAllows(rule: PermissionRule, user: PermissionSubject, facilityId?: string): boolean {
  if (!isStaffRole(user.role) || !rule.roles.includes(user.role)) return false;
  if (rule.scope === "none") return true;
  // Facility scope: a Facility must be named.
  if (!facilityId) return false;
  if (user.role === "admin") return true;
  return (user.facilityIds ?? []).includes(facilityId);
}

export type PermissionCheck = { allowed: true; user: StaffUser } | { allowed: false; user: StaffUser };

/**
 * For pages: the signed-in user (redirects to sign-in when signed out) and
 * whether they may perform `action`. A page renders `<Forbidden />` when
 * `allowed` is false; it never redirects and never loads the data.
 */
export async function requirePermission(action: Action, facilityId?: string): Promise<PermissionCheck> {
  const user = await requireStaff();
  return { allowed: can(user, action, facilityId), user };
}
