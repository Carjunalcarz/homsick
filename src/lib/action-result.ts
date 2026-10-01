/**
 * What every Server Action returns (AD-3). Expected failures come back as
 * `ok: false` with a code, a message for the user and, for form input,
 * one message per field. They never reach the client as exceptions.
 */
export type ActionError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
