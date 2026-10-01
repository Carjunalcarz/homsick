// Shared by the staff page's client parts. Type-only server imports (erased at build).
import type { StaffStatus } from "@/server/auth/staff-queries";
import type { StaffRole } from "@/server/auth/staff-rules";

export type { StaffRole, StaffStatus };

/** A Facility as the staff page shows it (chips and checkboxes). */
export type FacilityOption = { id: string; name: string; prefix: string; active: boolean };

/** One row of the staff list. */
export type StaffRowData = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  status: StaffStatus;
  failedAttempts: number;
  facilities: FacilityOption[];
};

export type PasswordLimits = { min: number; max: number };

/** Role order in the Role field and filter. */
export const ROLE_ORDER: StaffRole[] = ["triage_nurse", "facility_staff", "admin"];

/** Status order in the filter, with labels. Must list every `StaffStatus` (checked below). */
export const STATUS_LABELS = {
  active: "Active",
  locked: "Locked",
  deactivated: "Deactivated",
} as const satisfies Record<StaffStatus, string>;
export const STATUS_ORDER = Object.keys(STATUS_LABELS) as StaffStatus[];

/** Element ids of the controls that open sheets and dialogs, so focus can return to them. */
export const NEW_BUTTON_ID = "staff-new";
export const menuButtonId = (id: string) => `staff-${id}-menu`;
