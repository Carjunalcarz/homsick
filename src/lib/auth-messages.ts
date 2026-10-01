/** The only message a failed sign-in ever shows, whatever went wrong. */
export const WRONG_CREDENTIALS = "Wrong username or password";

/** Shown only when the account is locked (UX-DR18). */
export const ACCOUNT_LOCKED = "Account locked after 5 failed attempts. Ask an Admin to unlock it.";

/** Shown when one address has made too many sign-in attempts in a minute. */
export const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait a minute and try again.";
/** Display names for the staff Roles stored on `users.role`. */
export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  triage_nurse: "Triage Nurse",
  facility_staff: "Facility Staff",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Staff";
}
