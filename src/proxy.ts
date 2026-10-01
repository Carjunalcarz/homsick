import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic sign-in redirect (AD-4): only looks for the session cookie and
 * never touches the database. Pages still check the session for real with
 * requireStaff(). Also passes the requested path on so requireStaff() can
 * send the user back to it after sign-in.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requested = `${pathname}${search}`;

  // Server Actions are left alone: each checks the session itself, and the
  // re-auth dialog signs in through one on a page whose cookie has expired.
  const isServerAction = request.method === "POST" && request.headers.has("next-action");

  if (!getSessionCookie(request) && !isServerAction) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = pathname === "/" && !search ? "" : `?${new URLSearchParams({ next: requested })}`;
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-opd-path", requested);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Everything except sign-in, Better Auth, the session-status poll (it
    // answers signed-out itself, as JSON), health, the Display Board, Next
    // internals and static files (anything with a file extension).
    "/((?!sign-in(?:/|$)|api/auth(?:/|$)|api/auth-status(?:/|$)|api/health(?:/|$)|board(?:/|$)|_next/|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
