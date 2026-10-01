"use client";

import { AlertCircle } from "lucide-react";

/*
 * Shared form pieces (settings, staff and triage forms): errors tied to
 * their fields with `aria-describedby`, a form-level alert line, and the
 * split of an action's field errors into shown fields and the rest.
 */

export const FIELD =
  "h-11 w-full rounded border border-input bg-card px-3 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive";

export const NETWORK_ERROR = "Couldn't reach the server. Try again.";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

/** The form-level error line. Always mounted, so screen readers announce each new message. */
export function FormError({ message }: { message: string | null }) {
  return (
    <div role="alert" aria-live="assertive" aria-atomic="true">
      {message && (
        <p className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
    </div>
  );
}

/** `aria-describedby` for a field: its help text and, when present, its error. */
export function describedBy(help: string | null, errorId: string, error?: string): string | undefined {
  return [help, error ? errorId : null].filter(Boolean).join(" ") || undefined;
}

/** Focus the first invalid control in the form, after React has rendered the error it points to. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

/** Split an action's field errors into the ones the form shows and a form-level message. */
export function splitErrors(
  error: { message: string; fieldErrors?: Record<string, string> },
  isField: (key: string) => boolean,
): { fieldErrors: Record<string, string>; formError: string } {
  const fieldErrors: Record<string, string> = {};
  const unshown: string[] = [];
  for (const [key, message] of Object.entries(error.fieldErrors ?? {})) {
    if (isField(key)) fieldErrors[key] = message;
    else unshown.push(message);
  }
  // With errors on shown fields, the top line only points at them (it doesn't repeat them).
  const formError =
    unshown.length > 0
      ? unshown.join(" ")
      : Object.keys(fieldErrors).length > 0
        ? "Check the highlighted fields."
        : error.message;
  return { fieldErrors, formError };
}
