"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ACTION_BUTTON } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ActionResult } from "@/lib/action-result";
import { returnFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { setTemporaryPasswordAction, type StaffActionData } from "@/server/auth/staff-actions";
import { FormError, NETWORK_ERROR } from "@/components/form-parts";
import { PasswordField } from "./form-parts";
import type { PasswordLimits, StaffRowData } from "./staff-types";

type Props = {
  member: StaffRowData | null;
  open: boolean;
  passwordLimits: PasswordLimits;
  returnFocusId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

/** Set a new temporary password (there is no self-service reset). */
export function PasswordSheet({ member, open, passwordLimits, returnFocusId, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open={open && member !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={(event) => returnFocus(event, returnFocusId)}
      >
        {member && (
          <Body
            key={member.id}
            member={member}
            passwordLimits={passwordLimits}
            onSaved={onSaved}
            onPendingChange={setSaving}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  member,
  passwordLimits,
  onSaved,
  onPendingChange,
}: {
  member: StaffRowData;
  passwordLimits: PasswordLimits;
  onSaved: Props["onSaved"];
  onPendingChange: (pending: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<StaffActionData>;
      try {
        result = await setTemporaryPasswordAction({ id: member.id, password });
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        setError(undefined);
        onSaved(`New temporary password set for ${result.data.name}.`);
        return;
      }
      const fieldError = result.error.fieldErrors?.password;
      setError(fieldError);
      setFormError(result.error.message);
      if (fieldError) {
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("#staff-new-password")?.focus());
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex h-full flex-col">
      <SheetHeader className="border-b border-border">
        <SheetTitle>Set temporary password for {member.name}</SheetTitle>
        <SheetDescription>
          Their old password stops working, they are signed out everywhere, and a lockout is cleared.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FormError message={formError} />
        <p className="text-sm">
          Username: <span className="font-mono">{member.username}</span>
        </p>
        <PasswordField
          id="staff-new-password"
          value={password}
          onChange={setPassword}
          error={error}
          min={passwordLimits.min}
          max={passwordLimits.max}
        />
      </div>

      <SheetFooter className="flex-row justify-end border-t border-border">
        <SheetClose asChild>
          <Button type="button" variant="outline" className="h-11 px-4" disabled={pending}>
            Cancel
          </Button>
        </SheetClose>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={cn(
            ACTION_BUTTON,
            "bg-success text-success-foreground hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-70",
          )}
        >
          {pending ? "Saving…" : "Set password"}
        </button>
      </SheetFooter>
    </form>
  );
}
