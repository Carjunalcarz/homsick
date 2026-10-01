import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const BASE = "http://localhost:3000";

function request(path: string, cookie?: string) {
  return new NextRequest(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}

describe("proxy", () => {
  it("redirects a signed-out request to sign-in with the path and query as next", () => {
    const response = proxy(request("/triage?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${BASE}/sign-in?next=%2Ftriage%3Fx%3D1`);
  });

  it("redirects a signed-out queue slip request to sign-in (Story 3.6)", () => {
    const response = proxy(request("/print/slip/abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${BASE}/sign-in?next=%2Fprint%2Fslip%2Fabc`);
  });

  it("redirects a signed-out / to sign-in without next", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${BASE}/sign-in`);
  });

  it("passes a request with a session cookie on, with x-opd-path set", () => {
    const response = proxy(request("/triage?x=1", "better-auth.session_token=abc.def"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-opd-path")).toBe("/triage?x=1");
  });

  it("lets a Server Action through without a cookie (it checks the session itself)", () => {
    const response = proxy(
      new NextRequest(`${BASE}/triage`, { method: "POST", headers: { "next-action": "abc123" } }),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still redirects a plain POST without a cookie", () => {
    const response = proxy(new NextRequest(`${BASE}/triage`, { method: "POST" }));
    expect(response.status).toBe(307);
  });

  it("accepts the __Secure- cookie used over HTTPS", () => {
    const response = proxy(request("/patients", "__Secure-better-auth.session_token=abc.def"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each(["/sign-in", "/sign-in/", "/api/auth/x", "/api/auth-status", "/api/health", "/_next/static/a.js", "/board", "/favicon.ico"])(
    "excludes %s",
    (path) => {
      expect(matcher.test(path)).toBe(false);
    },
  );

  it.each(["/", "/triage", "/patients", "/print/slip/0b6f3c1e-2a4d-4f7e-9c1a-5d2e8f9a7b31", "/sign-inx", "/api/other", "/api/auth-statusx"])("matches %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });
});
