// Zod issues as form field errors. Shared by server actions and client
// forms (no server-only imports).

/**
 * The first message for each field, for errors shown on the form. By default
 * the key is the top-level field; with `nested`, the whole path joined by
 * dots (e.g. `levels.1.rank`). Issues about the whole input use `form`.
 */
export function fieldErrorsOf(
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
  nested = false,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = nested ? issue.path.map(String).join(".") || "form" : String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}
