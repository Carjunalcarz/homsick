import type { SessionStatus } from "@/lib/session-guard";
import { getStaffNoRefresh } from "@/server/auth/session";

/**
 * The idle-timeout guard's only poll endpoint. Reads the session with
 * `disableRefresh`, so polling never extends it (AD-9): only real activity
 * (keepAliveAction) does. Carries the user id and expiry, nothing else.
 */
export async function GET() {
  const staff = await getStaffNoRefresh();
  const now = new Date().toISOString();
  const body: SessionStatus = staff
    ? { signedIn: true, userId: staff.id, expiresAt: staff.expiresAt.toISOString(), now }
    : { signedIn: false, userId: null, expiresAt: null, now };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
