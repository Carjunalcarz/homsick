"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { WEEKDAYS } from "@/lib/facility-format";
import { cn } from "@/lib/utils";
import { updateFacilityAction } from "@/server/settings/actions";
import type { FacilityCardData } from "./facilities-section";

const FIELD =
  "h-11 w-full rounded border border-input bg-card px-3 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";

/** Form fields in visual order: the first one with an error gets focus. */
const FIELD_ORDER = ["name", "prefix", "openDays", "openTime", "closeTime", "isLive"] as const;
type FieldName = (typeof FIELD_ORDER)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

const FIRST_INPUT: Record<FieldName, string> = {
  name: "facility-name",
  prefix: "facility-prefix",
  openDays: "facility-day-1",
  openTime: "facility-open",
  closeTime: "facility-close",
  isLive: "facility-live",
};

const NETWORK_ERROR = "Couldn't reach the server. Try again.";

/** Return focus to a card button (the card re-renders after a save, so look it up by id). */
export function returnFocus(event: Event, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.focus();
}

type Props = {
  facility: FacilityCardData | null;
  open: boolean;
  /** The Edit button to focus again when the sheet closes. */
  returnFocusId: string | null;
  onClose: () => void;
  onSaved: (name: string, changed: boolean) => void;
};

/** The Facility edit sheet. Its content mounts fresh each time it opens. */
export function FacilityForm({ facility, open, returnFocusId, onClose, onSaved }: Props) {
  // While a save is in flight the sheet can't be dismissed (Esc, overlay):
  // its result must land on a mounted form.
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open={open && facility !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={(event) => returnFocusId && returnFocus(event, returnFocusId)}
      >
        {facility && <FormBody facility={facility} onSaved={onSaved} onPendingChange={setSaving} />}
      </SheetContent>
    </Sheet>
  );
}

function FormBody({
  facility,
  onSaved,
  onPendingChange,
}: {
  facility: FacilityCardData;
  onSaved: Props["onSaved"];
  onPendingChange: (pending: boolean) => void;
}) {
  const [name, setName] = useState(facility.name);
  const [prefix, setPrefix] = useState(facility.pending?.prefix ?? facility.currentPrefix);
  const [openDays, setOpenDays] = useState<number[]>(facility.openDays);
  const [openTime, setOpenTime] = useState(facility.openTime);
  const [closeTime, setCloseTime] = useState(facility.closeTime);
  const [isLive, setIsLive] = useState(facility.isLive);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  const focusFirstError = (fieldErrors: FieldErrors) => {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (!first) return;
    // After React has rendered the error text the input points to.
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>(`#${FIRST_INPUT[first]}`)?.focus();
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      let result;
      try {
        result = await updateFacilityAction({
          id: facility.id,
          name,
          prefix,
          openDays,
          openTime,
          closeTime,
          isLive,
        });
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        setErrors({});
        onSaved(result.data.name, result.data.changed);
        return;
      }
      const all = result.error.fieldErrors ?? {};
      const fieldErrors: FieldErrors = {};
      const unshown: string[] = [];
      for (const [key, message] of Object.entries(all)) {
        if ((FIELD_ORDER as readonly string[]).includes(key)) fieldErrors[key as FieldName] = message;
        else unshown.push(message);
      }
      setErrors(fieldErrors);
      // Errors on keys the form has no field for (id, form) are shown at the top.
      setFormError(unshown.length > 0 ? unshown.join(" ") : result.error.message);
      focusFirstError(fieldErrors);
    });
  };

  const describedBy = (field: FieldName, help?: string) =>
    [help, errors[field] ? `${FIRST_INPUT[field]}-error` : null].filter(Boolean).join(" ") || undefined;

  const pendingNote =
    prefix.trim().toUpperCase() !== facility.currentPrefix
      ? `Today stays ${facility.currentPrefix}. The new prefix starts on the next OPD day.`
      : "A new prefix starts on the next OPD day.";

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex h-full flex-col">
      <SheetHeader className="border-b border-border">
        <SheetTitle>Edit {facility.name}</SheetTitle>
        <SheetDescription>Changes to hours and Live apply at once.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {/* Always mounted, so screen readers announce each new message. */}
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {formError && (
            <p className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="facility-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="facility-name"
            name="name"
            type="text"
            autoComplete="off"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            className={FIELD}
          />
          <FieldError id="facility-name-error" message={errors.name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="facility-prefix" className="text-sm font-medium">
            Queue prefix
          </label>
          <input
            id="facility-prefix"
            name="prefix"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={3}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            aria-invalid={errors.prefix ? true : undefined}
            aria-describedby={describedBy("prefix", "facility-prefix-help")}
            className={cn(FIELD, "w-28 font-mono text-lg font-semibold uppercase")}
          />
          <p id="facility-prefix-help" className="text-sm text-muted-foreground">
            2–3 letters. {pendingNote}
          </p>
          <FieldError id="facility-prefix-error" message={errors.prefix} />
        </div>

        <fieldset
          className="flex flex-col gap-1.5"
          aria-describedby={errors.openDays ? "facility-day-1-error" : undefined}
        >
          <legend className="mb-1.5 text-sm font-medium">Open days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const checked = openDays.includes(day.value);
              return (
                <label
                  key={day.value}
                  htmlFor={`facility-day-${day.value}`}
                  className={cn(
                    "flex h-11 min-w-16 cursor-pointer items-center gap-2 rounded border px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    checked ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-muted",
                    errors.openDays && "border-destructive",
                  )}
                >
                  <input
                    id={`facility-day-${day.value}`}
                    type="checkbox"
                    name="openDays"
                    value={day.value}
                    checked={checked}
                    onChange={(e) =>
                      setOpenDays((days) =>
                        e.target.checked ? [...days, day.value].sort((a, b) => a - b) : days.filter((d) => d !== day.value),
                      )
                    }
                    aria-invalid={errors.openDays ? true : undefined}
                    aria-describedby={errors.openDays ? "facility-day-1-error" : undefined}
                    className="size-4 accent-primary focus-visible:outline-none"
                  />
                  <span aria-hidden="true">{day.short}</span>
                  <span className="sr-only">{day.long}</span>
                </label>
              );
            })}
          </div>
          <FieldError id="facility-day-1-error" message={errors.openDays} />
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="facility-open" className="text-sm font-medium">
              Opens at
            </label>
            <input
              id="facility-open"
              name="openTime"
              type="time"
              step={60}
              value={openTime}
              onChange={(e) => setOpenTime(e.target.value)}
              aria-invalid={errors.openTime ? true : undefined}
              aria-describedby={describedBy("openTime")}
              className={cn(FIELD, "tabular-nums")}
            />
            <FieldError id="facility-open-error" message={errors.openTime} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="facility-close" className="text-sm font-medium">
              Closes at
            </label>
            <input
              id="facility-close"
              name="closeTime"
              type="time"
              step={60}
              value={closeTime}
              onChange={(e) => setCloseTime(e.target.value)}
              aria-invalid={errors.closeTime ? true : undefined}
              aria-describedby={describedBy("closeTime")}
              className={cn(FIELD, "tabular-nums")}
            />
            <FieldError id="facility-close-error" message={errors.closeTime} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-11 items-center justify-between gap-4 rounded border border-border px-3">
            <label htmlFor="facility-live" className="flex flex-col py-2 text-sm font-medium">
              Live
              <span id="facility-live-help" className="text-xs font-normal text-muted-foreground">
                {isLive ? "Takes patients in the queue system." : "Not live: staff use paper numbers."}
              </span>
            </label>
            <Switch
              id="facility-live"
              checked={isLive}
              onCheckedChange={setIsLive}
              aria-describedby={describedBy("isLive")}
            />
          </div>
          <FieldError id="facility-live-error" message={errors.isLive} />
        </div>
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

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
