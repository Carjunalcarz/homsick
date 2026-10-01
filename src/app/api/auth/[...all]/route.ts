import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

// Better Auth's own routes (AD-9). The instance is created on the first
// request, never at build time.
function handle(request: Request) {
  return getAuth().handler(request);
}

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(handle);
