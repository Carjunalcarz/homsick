"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { describedBy, FIELD, FieldError } from "@/components/form-parts";
import { ACTION_BUTTON } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { formatAge } from "@/lib/age";
import { formatBirthdate } from "@/lib/patient-display";
import { PATIENT_SEXES, SEX_LABELS, type PatientSex } from "@/lib/patient-name";
import {
  BIRTHDATE_MIN,
  PATIENT_ADDRESS_MAX,
  PATIENT_ID_MAX,
  PATIENT_NAME_MAX,
  type PatientEditField,
} from "@/lib/patient-registration";
import { opdDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PatientFinderRow } from "@/server/patients/queries";

/*
 * The patient demographic fields, shared by the registration form on
 * /triage (Story 3.2) and the Edit details sheet on /patients/[id]
 * (Story 3.3), so both render the same fields with the same rules. Required
 * fields show; optional ones sit under a collapsible "More details".
 */

/** The typed-in fields (everything but sex). */
export type PatientTextField = Exclude<PatientEditField, "sex">;
export type PatientTextValues = Record<PatientTextField, string>;

/** The optional fields, collapsed under "More details". */
export const OPTIONAL_PATIENT_FIELDS: readonly PatientTextField[] = [
  "middleName",
  "suffix",
  "philhealthPin",
  "seniorCitizenId",
  "pwdId",
  "emergencyContactName",
  "emergencyContactNumber",
];

export const EMPTY_PATIENT_VALUES: PatientTextValues = {
  lastName: "",
  firstName: "",
  middleName: "",
  suffix: "",
  birthdate: "",
  addressBarangay: "",
  addressMunicipality: "",
  contactNumber: "",
  philhealthPin: "",
  seniorCitizenId: "",
  pwdId: "",
  emergencyContactName: "",
  emergencyContactNumber: "",
};

/** The id of a field's control (`sex`: its first radio). */
export const patientInputId = (prefix: string, field: string) =>
  field === "sex" ? `${prefix}-sex-female` : `${prefix}-${field}`;
export const patientErrorId = (prefix: string, field: string) => `${prefix}-${field}-error`;

type Props = {
  /** Prefix for element ids ("reg", "edit"), so two forms never share one. */
  idPrefix: string;
  values: PatientTextValues;
  onChange: (field: PatientTextField, value: string) => void;
  sex: PatientSex | "";
  onSexChange: (sex: PatientSex) => void;
  errors: Partial<Record<string, string>>;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
};

export function PatientFields({ idPrefix, values, onChange, sex, onSexChange, errors, moreOpen, onMoreOpenChange }: Props) {
  const inputId = (field: string) => patientInputId(idPrefix, field);
  const errorId = (field: string) => patientErrorId(idPrefix, field);
  const moreId = `${idPrefix}-more-details`;

  const text = (
    field: PatientTextField,
    label: string,
    options: {
      maxLength: number;
      type?: string;
      help?: string;
      inputMode?: "tel" | "numeric" | "text";
      min?: string;
      max?: string;
    },
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId(field)} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId(field)}
        name={field}
        type={options.type ?? "text"}
        inputMode={options.inputMode}
        autoComplete="off"
        maxLength={options.maxLength}
        min={options.min}
        max={options.max}
        value={values[field]}
        onChange={(event) => onChange(field, event.target.value)}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={describedBy(options.help ? `${inputId(field)}-help` : null, errorId(field), errors[field])}
        className={FIELD}
      />
      {options.help && (
        <p id={`${inputId(field)}-help`} className="text-xs text-muted-foreground">
          {options.help}
        </p>
      )}
      <FieldError id={errorId(field)} message={errors[field]} />
    </div>
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("lastName", "Last name", { maxLength: PATIENT_NAME_MAX })}
        {text("firstName", "First name", { maxLength: PATIENT_NAME_MAX })}
      </div>

      <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.sex ? errorId("sex") : undefined}>
        <legend className="mb-1.5 text-sm font-medium">Sex</legend>
        <div className="flex flex-wrap gap-2">
          {PATIENT_SEXES.map((value) => (
            <label
              key={value}
              htmlFor={`${idPrefix}-sex-${value}`}
              className={cn(
                "flex h-11 min-w-28 cursor-pointer items-center gap-2 rounded border px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                sex === value ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-muted",
                errors.sex && "border-destructive",
              )}
            >
              <input
                id={`${idPrefix}-sex-${value}`}
                type="radio"
                name={`${idPrefix}-sex`}
                value={value}
                checked={sex === value}
                onChange={() => onSexChange(value)}
                aria-describedby={errors.sex ? errorId("sex") : undefined}
                className="size-4 accent-primary focus-visible:outline-none"
              />
              {SEX_LABELS[value]}
            </label>
          ))}
        </div>
        <FieldError id={errorId("sex")} message={errors.sex} />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {text("birthdate", "Birthdate", {
          maxLength: 10,
          type: "date",
          min: BIRTHDATE_MIN,
          max: opdDate(),
          help: "Age is calculated from it.",
        })}
        {text("contactNumber", "Contact number", {
          maxLength: 20,
          type: "tel",
          inputMode: "tel",
          help: "Mobile or landline, e.g. 0917 123 4567.",
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {text("addressBarangay", "Barangay", { maxLength: PATIENT_ADDRESS_MAX })}
        {text("addressMunicipality", "Municipality", { maxLength: PATIENT_ADDRESS_MAX })}
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border">
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => onMoreOpenChange(!moreOpen)}
          className="flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            More details <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
        </button>
        <div id={moreId} hidden={!moreOpen} className="px-3 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("middleName", "Middle name", { maxLength: PATIENT_NAME_MAX })}
            {text("suffix", "Suffix", { maxLength: PATIENT_NAME_MAX, help: "e.g. Jr., III" })}
            {text("philhealthPin", "PhilHealth PIN", { maxLength: 20, inputMode: "numeric", help: "12 digits." })}
            {text("seniorCitizenId", "Senior Citizen ID", { maxLength: PATIENT_ID_MAX })}
            {text("pwdId", "PWD ID", { maxLength: PATIENT_ID_MAX })}
            {text("emergencyContactName", "Emergency contact name", { maxLength: PATIENT_NAME_MAX })}
            {text("emergencyContactNumber", "Emergency contact number", { maxLength: 20, type: "tel", inputMode: "tel" })}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The "Possible match" card: patients with the same name and birthdate.
 * `onUse` adds a "Use this record" button per match (registration only);
 * the confirm button saves anyway with the ids shown.
 */
export function PossibleMatchCard({
  headingId,
  idPrefix,
  matches,
  pending,
  intro,
  onUse,
  confirmLabel,
  onConfirm,
}: {
  headingId: string;
  idPrefix: string;
  matches: PatientFinderRow[];
  pending: boolean;
  /** What to do about the matches (after the count sentence). */
  intro: string;
  onUse?: (patient: PatientFinderRow) => void;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-warning/60 bg-warning/10 p-4">
      <h3 id={headingId} tabIndex={-1} className="flex items-center gap-2 text-base font-medium outline-none">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        Possible match
      </h3>
      <p className="text-sm">
        {matches.length === 1
          ? "A patient with the same name and birthdate is already registered."
          : `${matches.length} patients with the same name and birthdate are already registered.`}{" "}
        {intro}
      </p>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li
            key={match.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5 text-sm">
              <span id={`${idPrefix}-match-${match.id}`} className="font-medium break-words">
                {match.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{match.hospitalNumber}</span>
                <span>{formatBirthdate(match.birthdate)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatAge(match.age)}</span>
                <span aria-hidden="true">·</span>
                <span>{SEX_LABELS[match.sex]}</span>
              </span>
            </div>
            {onUse && (
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                disabled={pending}
                aria-describedby={`${idPrefix}-match-${match.id}`}
                onClick={() => onUse(match)}
              >
                Use this record
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={onConfirm}
          className={cn(
            ACTION_BUTTON,
            "bg-success text-success-foreground hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-70",
          )}
        >
          {pending ? "Saving…" : confirmLabel}
        </button>
      </div>
    </section>
  );
}
