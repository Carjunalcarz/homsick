import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { safeNextPath } from "@/lib/safe-next";
import { getAuth } from "./auth";
import { activeFacilityIdsOf } from "./staff-queries";
import { isStaffRole, type StaffRole } from "./staff-rules";

/** The request header proxy.ts sets with the requested path and query. */
export const REQUEST_PATH_HEADER = "x-opd-path";

export type StaffUser = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  /**
   * The active Facilities this user is assigned to (Facility Staff only):
   * the Facility scope of `can()`.
   */
  facilityIds: string[];
};

/**
 * The request headers with the cookie header taken from the current cookie
 * jar. After a Server Action signs in (the re-auth dialog), Next re-renders
 * the page in the same request: `headers()` still has the old cookies, but
 * `cookies()` has the new session cookie.
 */
export async function sessionHeaders(): Promise<Headers> {
  // Read the request first: this makes the caller request-time (AD-1), so
  // nothing here runs during build or prerendering.
  const requestHeaders = new Headers(await headers());
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
  else requestHeaders.delete("cookie");
  return requestHeaders;
}

/** Only Facility Staff have Facilities; other Roles skip the query. */
function facilityIdsFor(userId: string, role: StaffRole): string[] {
  return role === "facility_staff" ? activeFacilityIdsOf(userId) : [];
}

/** The signed-in staff member for this request, or null. Reads once per request. */
export const getStaff = cache(async (): Promise<StaffUser | null> => {
  // Headers first (request-time), then Better Auth: never at build time.
  const requestHeaders = await sessionHeaders();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { user } = session;
  // Deny by default: an account without a known staff Role is not signed in.
  if (!isStaffRole(user.role)) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username ?? "",
    role: user.role,
    facilityIds: facilityIdsFor(user.id, user.role),
  };
});

/**
 * The current session for polling (the idle-timeout guard): read with
 * `disableRefresh`, so checking never extends the session (AD-9). Returns the
 * session's expiry along with the user.
 */
export async function getStaffNoRefresh(): Promise<(StaffUser & { expiresAt: Date }) | null> {
  const requestHeaders = await sessionHeaders();
  const session = await getAuth().api.getSession({
    headers: requestHeaders,
    query: { disableRefresh: true },
  });
  if (!session) return null;
  const { user } = session;
  if (!isStaffRole(user.role)) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username ?? "",
    role: user.role,
    facilityIds: facilityIdsFor(user.id, user.role),
    expiresAt: new Date(session.session.expiresAt),
  };
}

/**
 * The only way server code gets the current user (AD-9). Redirects to
 * `/sign-in?next=<requested path>` when nobody is signed in.
 */
export async function requireStaff(): Promise<StaffUser> {
  const staff = await getStaff();
  if (staff) return staff;
  const requested = safeNextPath((await headers()).get(REQUEST_PATH_HEADER));
  const query = requested === "/" ? "" : `?${new URLSearchParams({ next: requested })}`;
  redirect(`/sign-in${query}`);
}
