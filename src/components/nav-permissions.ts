import "server-only";
import { ADMIN_NAV, MAIN_NAV } from "@/components/nav-items";
import { can, type PermissionSubject } from "@/server/auth/permissions";

/*
 * Which nav items a user sees, decided on the server with `can()` and passed
 * to the client nav as hrefs. Cosmetic only: every page checks its own action.
 */

/** The top-nav hrefs the user's Role may use. */
export function allowedNav(user: PermissionSubject): string[] {
  return MAIN_NAV.filter((item) => can(user, item.action)).map((item) => item.href);
}

/** The Admin page hrefs the user may open. */
export function allowedAdminNav(user: PermissionSubject): string[] {
  return ADMIN_NAV.filter((item) => can(user, item.action)).map((item) => item.href);
}
