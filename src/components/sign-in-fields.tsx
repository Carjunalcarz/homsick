"use client";

import { useEffect, useRef } from "react";
import { ACTION_BUTTON } from "@/components/page-title";
import { cn } from "@/lib/utils";

const FIELD =
  "h-11 w-full rounded border border-input bg-card px-3 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";

type Props = {
  /** The last attempt's result; any failure shows its message. */
  state: { error: string | null; username: string };
  pending: boolean;
  /** Prefix for element ids, so two forms can share a page. */
  idPrefix?: string;
};

/**
 * Username and password fields with the error region and the submit button,
 * shared by the sign-in page and the re-auth dialog. Place inside a <form>.
 */
export function SignInFields({ state, pending, idPrefix = "" }: Props) {
  const usernameRef = useRef<HTMLInputElement>(null);
  const errorId = `${idPrefix}sign-in-error`;
  const usernameId = `${idPrefix}username`;
  const passwordId = `${idPrefix}password`;

  // After a failed attempt, put the user back on the username field.
  useEffect(() => {
    if (state.error) {
      usernameRef.current?.focus();
      usernameRef.current?.select();
    }
  }, [state]);

  const invalid = state.error ? true : undefined;

  return (
    <>
      <div aria-live="polite" aria-atomic="true" id={errorId}>
        {state.error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {state.error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={usernameId} className="text-sm font-medium">
          Username
        </label>
        <input
          ref={usernameRef}
          id={usernameId}
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={state.username}
          key={`username-${state.username}-${state.error ? "err" : "ok"}`}
          aria-invalid={invalid}
          aria-describedby={state.error ? errorId : undefined}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className="text-sm font-medium">
          Password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid}
          aria-describedby={state.error ? errorId : undefined}
          className={FIELD}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className={cn(
          ACTION_BUTTON,
          "mt-2 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70",
        )}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}
