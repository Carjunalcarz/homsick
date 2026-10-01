"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { HOSPITAL_NAME_MAX, HOSPITAL_NAME_MIN, THRESHOLD_LIMITS } from "@/lib/clinical-settings";
import { cn } from "@/lib/utils";
import { updateOpdThresholdsAction, type ClinicalActionData } from "@/server/settings/actions";
import { describedBy, FIELD, FieldError, focusFirstInvalid, NETWORK_ERROR, splitErrors } from "@/components/form-parts";
import { CARD, EditSheet, SectionHeader, SheetForm, useReportPending } from "./settings-ui";

export type OpdThresholdsData = {
  prenatalTarget: number;
  noShowThreshold: number;
  preCloseWarningMinutes: number;
  hospitalName: string;
};

type Key = Exclude<keyof OpdThresholdsData, "hospitalName">;

const HOSPITAL_NAME_LABEL = "Hospital name (printed on slips)";
const HOSPITAL_NAME_ID = "threshold-hospitalName";

const EDIT_BUTTON_ID = "opd-thresholds-edit";

const { prenatalTarget, noShowThreshold, preCloseWarningMinutes } = THRESHOLD_LIMITS;

const FIELDS: { key: Key; label: string; help: string; min: number; max: number }[] = [
  {
    key: "prenatalTarget",
    label: "Prenatal visit target",
    help: `Visits per pregnancy, ${prenatalTarget.min} to ${prenatalTarget.max}.`,
    ...prenatalTarget,
  },
  {
    key: "noShowThreshold",
    label: "No-show after",
    help: `Unanswered calls before a patient is marked No-show, ${noShowThreshold.min} to ${noShowThreshold.max}.`,
    ...noShowThreshold,
  },
  {
    key: "preCloseWarningMinutes",
    label: "Pre-close warning",
    help: `Minutes before a Facility closes, ${preCloseWarningMinutes.min} to ${preCloseWarningMinutes.max}. 0 turns the warning off.`,
    ...preCloseWarningMinutes,
  },
];

function display(key: Key, value: number): string {
  switch (key) {
    case "prenatalTarget":
      return `${value} ${value === 1 ? "visit" : "visits"}`;
    case "noShowThreshold":
      return `${value} ${value === 1 ? "call" : "calls"}`;
    case "preCloseWarningMinutes":
      return value === 0 ? "Off" : `${value} min before closing`;
  }
}

export function OpdThresholdsSection({ thresholds, canManage }: { thresholds: OpdThresholdsData; canManage: boolean }) {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="opd-thresholds-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="opd-thresholds-heading"
        title="Queue and prenatal"
        description="Targets and thresholds for new entries, and the name printed on queue slips."
        status={status}
      />
      <div className={cn(CARD, "flex flex-col gap-4")}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {FIELDS.map((field) => (
            <div key={field.key} className="contents">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="font-medium tabular-nums">{display(field.key, thresholds[field.key])}</dd>
            </div>
          ))}
          <dt className="text-muted-foreground">{HOSPITAL_NAME_LABEL}</dt>
          <dd className="font-medium break-words">{thresholds.hospitalName}</dd>
        </dl>
        {canManage && (
          <div>
            <Button
              id={EDIT_BUTTON_ID}
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => {
                setStatus("");
                setOpen(true);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit<span className="sr-only"> queue and prenatal settings</span>
            </Button>
          </div>
        )}
      </div>

      {canManage && (
        <EditSheet open={open} returnFocusId={EDIT_BUTTON_ID} onClose={() => setOpen(false)}>
          {(onPendingChange) => (
            <ThresholdsForm
              thresholds={thresholds}
              onPendingChange={onPendingChange}
              onSaved={(changed) => {
                setOpen(false);
                setStatus(changed ? "Queue and prenatal settings saved." : "No changes to queue and prenatal settings.");
              }}
            />
          )}
        </EditSheet>
      )}
    </section>
  );
}

function ThresholdsForm({
  thresholds,
  onPendingChange,
  onSaved,
}: {
  thresholds: OpdThresholdsData;
  onPendingChange: (pending: boolean) => void;
  onSaved: (changed: boolean) => void;
}) {
  const [values, setValues] = useState<Record<Key | "hospitalName", string>>({
    prenatalTarget: String(thresholds.prenatalTarget),
    noShowThreshold: String(thresholds.noShowThreshold),
    preCloseWarningMinutes: String(thresholds.preCloseWarningMinutes),
    hospitalName: thresholds.hospitalName,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useReportPending(pending, onPendingChange);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<ClinicalActionData>;
      try {
        result = await updateOpdThresholdsAction(values);
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        setErrors({});
        onSaved(result.data.changed);
        return;
      }
      const split = splitErrors(
        result.error,
        (key) => key === "hospitalName" || FIELDS.some((field) => field.key === key),
      );
      setErrors(split.fieldErrors);
      setFormError(split.formError);
      focusFirstInvalid(formRef.current);
    });
  };

  return (
    <SheetForm
      formRef={formRef}
      title="Edit queue and prenatal settings"
      description="Changes apply to new entries only."
      formError={formError}
      pending={pending}
      onSubmit={submit}
    >
      {FIELDS.map((field) => {
        const id = `threshold-${field.key}`;
        const error = errors[field.key];
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {field.label}
            </label>
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              step={1}
              value={values[field.key]}
              onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(`${id}-help`, `${id}-error`, error)}
              className={cn(FIELD, "w-32 tabular-nums")}
            />
            <p id={`${id}-help`} className="text-sm text-muted-foreground">
              {field.help}
            </p>
            <FieldError id={`${id}-error`} message={error} />
          </div>
        );
      })}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={HOSPITAL_NAME_ID} className="text-sm font-medium">
          {HOSPITAL_NAME_LABEL}
        </label>
        <input
          id={HOSPITAL_NAME_ID}
          type="text"
          autoComplete="off"
          maxLength={HOSPITAL_NAME_MAX}
          value={values.hospitalName}
          onChange={(e) => setValues((current) => ({ ...current, hospitalName: e.target.value }))}
          aria-invalid={errors.hospitalName ? true : undefined}
          aria-describedby={describedBy(`${HOSPITAL_NAME_ID}-help`, `${HOSPITAL_NAME_ID}-error`, errors.hospitalName)}
          className={cn(FIELD, "w-full")}
        />
        <p id={`${HOSPITAL_NAME_ID}-help`} className="text-sm text-muted-foreground">
          Shown at the top of each queue slip, {HOSPITAL_NAME_MIN} to {HOSPITAL_NAME_MAX} characters.
        </p>
        <FieldError id={`${HOSPITAL_NAME_ID}-error`} message={errors.hospitalName} />
      </div>
    </SheetForm>
  );
}
