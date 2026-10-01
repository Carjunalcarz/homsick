import "server-only";

/*
 * Account rules shared by Better Auth's config, the create-admin CLI and
 * (later) staff management. Pure functions: no database, no I/O.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const FULL_NAME_MAX = 100;
/** Lowercase letters, digits, "." "_" and "-". */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/** The staff Roles stored on `users.role`. Anything else is not a staff member. */
export const STAFF_ROLES = ["admin", "triage_nurse", "facility_staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}

/** Names that suggest a shared login; each person gets their own account. */
export const SHARED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "root",
  "superuser",
  "opd",
  "staff",
  "user",
]);

/** Usernames are stored lowercase and trimmed. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Each validator returns an error message, or null when the value is fine. */
export function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Full name is required.";
  if (trimmed.length > FULL_NAME_MAX) return `Full name must be at most ${FULL_NAME_MAX} characters.`;
  return null;
}

/** Checks an already-normalized username. */
export function validateUsername(username: string): string | null {
  if (
    username.length < USERNAME_MIN ||
    username.length > USERNAME_MAX ||
    !USERNAME_PATTERN.test(username)
  ) {
    return `Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters: lowercase letters, digits, ".", "_" or "-".`;
  }
  // The username becomes an email local part (`<username>@staff.opd.invalid`).
  if (/^[._-]|[._-]$/.test(username) || username.includes("..")) {
    return 'Username can\'t start or end with ".", "_" or "-", or have two dots in a row.';
  }
  if (SHARED_USERNAMES.has(username)) {
    return `"${username}" looks like a shared account. Use the person's own username.`;
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`;
  }
  return null;
}
