"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FieldError, describedBy, FormError, NETWORK_ERROR, splitErrors } from "@/components/form-parts";
import { ACTION_BUTTON } from "@/components/page-title";
import {
  EMPTY_PATIENT_VALUES,
  OPTIONAL_PATIENT_FIELDS,
  PatientFields,
  PossibleMatchCard,
  patientErrorId,
  patientInputId,
  type PatientTextField,
  type PatientTextValues,
} from "@/components/patient-fields";
import { Button } from "@/components/ui/button";
import { fieldErrorsOf } from "@/lib/field-errors";
import type { PatientSex } from "@/lib/patient-name";
import { REGISTRATION_FIELDS, patientRegistrationSchema, type RegistrationField } from "@/lib/patient-registration";
import { cn } from "@/lib/utils";
import { registerPatientAction, type PatientFinderRow } from "@/server/patients/actions";

/*
 * The inline registration form (Story 3.2, UX-DR12/19), in the right column
 * of /triage. Required fields show; optional ones are collapsed under "More
 * details" (the fields are shared with the Edit details sheet). The shared
 * Zod rules run before submitting (the action runs them again). Errors are
 * tied to their fields and the first one gets focus; Esc or Cancel closes
 * the form.
 */

type FieldErrors = Partial<Record<RegistrationField, string>>;

const PREFIX = "reg";
const inputId = (field: RegistrationField) => patientInputId(PREFIX, field);
const errorId = (field: RegistrationField) => patientErrorId(PREFIX, field);

const MATCH_HEADING_ID = "reg-possible-match-heading";

const REQUIRED_TEXT: readonly PatientTextField[] = [
  "lastName",
  "firstName",
  "birthdate",
  "contactNumber",
  "addressBarangay",
  "addressMunicipality",
];

const isField = (key: string): key is RegistrationField => (REGISTRATION_FIELDS as readonly string[]).includes(key);

type Props = {
  /** Last and first names guessed from the finder query. */
  initialName: { lastName: string; firstName: string };
  onRegistered: (patient: PatientFinderRow) => void;
  onUseExisting: (patient: PatientFinderRow) => void;
  onCancel: () => void;
  /** Whether any field differs from how the form opened (to ask before discarding it). */
  onDirtyChange?: (dirty: boolean) => void;
};

export function RegistrationForm({ initialName, onRegistered, onUseExisting, onCancel, onDirtyChange }: Props) {
  const [initialValues] = useState<PatientTextValues>(() => ({
    ...EMPTY_PATIENT_VALUES,
    lastName: initialName.lastName,
    firstName: initialName.firstName,
  }));
  const [values, setValues] = useState(initialValues);
  const [sex, setSex] = useState<PatientSex | "">("");
  const [privacy, setPrivacy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [matches, setMatches] = useState<PatientFinderRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  // The element to focus once React has committed the render that shows it
  // (an error, the opened More details, or the Possible match card).
  const focusAfterRender = useRef<string | null>(null);
  // False once the form has closed: a save still in flight then only registers (no select, no focus).
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dirty =
    sex !== "" ||
    privacy ||
    (Object.keys(values) as PatientTextField[]).some((field) => values[field] !== initialValues[field]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    focusAfterRender.current = null;
    target.focus();
  });

  // Focus the first empty required field when the form opens.
  useEffect(() => {
    const firstEmpty =
      REQUIRED_TEXT.slice(0, 2).find((field) => values[field].trim() === "") ??
      (sex === "" ? "sex" : REQUIRED_TEXT.slice(2).find((field) => values[field].trim() === "")) ??
      "privacyNoticeExplained";
    document.getElementById(inputId(firstEmpty))?.focus();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (field: PatientTextField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // The Possible match was for the name and birthdate as they were.
    if (field === "lastName" || field === "firstName" || field === "birthdate") setMatches(null);
  };

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    const first = REGISTRATION_FIELDS.find((field) => fieldErrors[field]);
    if (!first) return;
    if ((OPTIONAL_PATIENT_FIELDS as readonly string[]).includes(first)) setMoreOpen(true);
    focusAfterRender.current = inputId(first);
  }

  /** Save; `confirmedMatchIds` are the Possible match ids shown on the card ("Create anyway"). */
  function save(confirmedMatchIds?: string[]) {
    setFormError(null);
    const input = { ...values, sex, privacyNoticeExplained: privacy, confirmedMatchIds };
    const check = patientRegistrationSchema.safeParse(input);
    if (!check.success) {
      const all = fieldErrorsOf(check.error);
      const fieldErrors: FieldErrors = {};
      for (const [key, message] of Object.entries(all)) if (isField(key)) fieldErrors[key] = message;
      setMatches(null);
      setFormError("Check the highlighted fields.");
      showErrors(fieldErrors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      let result;
      try {
        result = await registerPatientAction(input);
      } catch {
        if (mounted.current) setFormError(NETWORK_ERROR);
        return;
      }
      // Closed meanwhile: the patient stays registered, but the workspace has moved on.
      if (!mounted.current) return;
      if (result.ok) {
        if (result.data.status === "possible_match") {
          focusAfterRender.current = MATCH_HEADING_ID;
          setMatches(result.data.matches);
          return;
        }
        onRegistered(result.data.patient);
        return;
      }
      const split = splitErrors(result.error, isField);
      setFormError(split.formError);
      showErrors(split.fieldErrors as FieldErrors);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      noValidate
      aria-label="Register a new patient"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-5"
    >
      <p className="text-sm text-muted-foreground">The Hospital Number is issued when you save. Esc cancels.</p>

      <FormError message={formError} />

      <PatientFields
        idPrefix={PREFIX}
        values={values}
        onChange={change}
        sex={sex}
        onSexChange={setSex}
        errors={errors}
        moreOpen={moreOpen}
        onMoreOpenChange={setMoreOpen}
      />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId("privacyNoticeExplained")}
          className={cn(
            "flex min-h-11 cursor-pointer items-center gap-3 rounded border px-3 py-2 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            errors.privacyNoticeExplained ? "border-destructive" : "border-input",
          )}
        >
          <input
            id={inputId("privacyNoticeExplained")}
            type="checkbox"
            checked={privacy}
            onChange={(event) => setPrivacy(event.target.checked)}
            aria-invalid={errors.privacyNoticeExplained ? true : undefined}
            aria-describedby={describedBy(null, errorId("privacyNoticeExplained"), errors.privacyNoticeExplained)}
            className="size-5 shrink-0 accent-primary focus-visible:outline-none"
          />
          Privacy notice explained to the patient
        </label>
        <FieldError id={errorId("privacyNoticeExplained")} message={errors.privacyNoticeExplained} />
      </div>

      {matches && matches.length > 0 && (
        <PossibleMatchCard
          headingId={MATCH_HEADING_ID}
          idPrefix={PREFIX}
          matches={matches}
          pending={pending}
          intro="Use the existing record, or create a new one if this is a different person."
          onUse={onUseExisting}
          confirmLabel="Create anyway"
          onConfirm={() => save(matches.map((match) => match.id))}
        />
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        {!matches?.length && (
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
        )}
      </div>
    </form>
  );
}
