"use client";

import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { FormError } from "@/components/form-parts";
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
import { returnFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";

/*
 * Shared pieces of the clinical settings sections, following the Facility
 * form rules: errors tied to fields, first error focused, a pending save
 * blocks dismissal, and focus returns to the control that opened the sheet.
 */

export const CARD =
  "rounded-md bg-card p-5 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]";

/** A section heading with its description and a live status line. */
export function SectionHeader({
  id,
  title,
  description,
  status,
  action,
}: {
  id: string;
  title: string;
  description: string;
  status: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 id={id} className="text-base font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm font-medium">
          {status && (
            <>
              <CircleCheck className="mr-1 inline size-4 align-text-bottom text-success" aria-hidden="true" />
              {status}
            </>
          )}
        </p>
        {action}
      </div>
    </div>
  );
}

/**
 * A side sheet for one edit form. The content mounts fresh each time it
 * opens; while `children` reports a pending save, Esc and the overlay are ignored.
 */
export function EditSheet({
  open,
  returnFocusId,
  onClose,
  children,
}: {
  open: boolean;
  returnFocusId: string;
  onClose: () => void;
  children: (onPendingChange: (pending: boolean) => void) => React.ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open={open}
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
        {children(setSaving)}
      </SheetContent>
    </Sheet>
  );
}

/** Report `pending` to the sheet so it can block dismissal. */
export function useReportPending(pending: boolean, onPendingChange: (pending: boolean) => void) {
  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
}

/** The frame of an edit form: title, a form-level error, the fields, Cancel and Save. */
export function SheetForm({
  formRef,
  title,
  description,
  formError,
  pending,
  onSubmit,
  children,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  title: string;
  description: string;
  formError: string | null;
  pending: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex h-full flex-col">
      <SheetHeader className="border-b border-border">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FormError message={formError} />

        {children}
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
          {pending ? "Saving…" : "Save"}
        </button>
      </SheetFooter>
    </form>
  );
}
