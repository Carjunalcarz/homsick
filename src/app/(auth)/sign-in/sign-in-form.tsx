"use client";

import { useActionState } from "react";
import { SignInFields } from "@/components/sign-in-fields";
import { signInAction, type SignInState } from "@/server/auth/actions";

const initialState: SignInState = { error: null, username: "" };

/**
 * Username and password form. Every failure shows the same generic message,
 * except a locked account and too many attempts from one address.
 */
export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <SignInFields state={state} pending={pending} />
    </form>
  );
}
