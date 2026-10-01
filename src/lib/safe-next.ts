/**
 * Where to go after sign-in. Only a same-site relative path is allowed, so a
 * crafted `next` can never send a user to another site (open redirect).
 */
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  // Must be an absolute path on this site: "/x", not "//host", "/\host" or "http:".
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Browsers ignore tabs and newlines in URLs, which could turn "/\t/host" into "//host".
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://opd.invalid");
    if (url.origin !== "http://opd.invalid") return fallback;
    // Dot segments normalize away: "/..//host" becomes "//host", which a
    // browser would read as another site.
    if (url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) return fallback;
    // Don't send a user back to the sign-in page itself.
    if (/^\/sign-in\/?$/i.test(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
