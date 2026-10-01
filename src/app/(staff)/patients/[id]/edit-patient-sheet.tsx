"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FormError, NETWORK_ERROR, splitErrors } from "@/components/form-parts";
import { ACTION_BUTTON } from "@/components/page-title";
import {
  OPTIONAL_PATIENT_FIELDS,
  PatientFields,
  PossibleMatchCard,
  patientInputId,
  type PatientTextField,
  type PatientTextValues,
} from "@/components/patient-fields";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ActionResult } from "@/lib/action-result";
import { fieldErrorsOf } from "@/lib/field-errors";
import { returnFocus } from "@/lib/focus";
import type { PatientSex } from "@/lib/patient-name";
import { patientEditSchema, REGISTRATION_FIELDS, type PatientEditField } from "@/lib/patient-registration";
import { cn } from "@/lib/utils";
import { updatePatientAction, type PatientFinderRow, type UpdatePatientData } from "@/server/patients/actions";
import type { PatientRecordData } from "./record-types";

/*
 * The Edit details sheet (Story 3.3): the registration fields, pre-filled,
 * without the privacy checkbox. The shared Zod rules run before submitting
 * (the action runs them again). First-error focus, a pending state, the
 * Possible match flow of registration, and a prompt before discarding
 * changes. There is no delete.
 */

const PREFIX = "edit";
const MATCH_HEADING_ID = "edit-possible-match-heading";

/** The fields in visual order (the registration form's, minus the privacy checkbox): the first one with an error gets focus. */
const EDIT_FIELD_ORDER: readonly PatientEditField[] = REGISTRATION_FIELDS.filter(
  (field): field is PatientEditField => field !== "privacyNoticeExplained",
);

type FieldErrors = Partial<Record<PatientEditField, string>>;

const isField = (key: string): key is PatientEditField => (EDIT_FIELD_ORDER as readonly string[]).includes(key);

function valuesOf(record: PatientRecordData): PatientTextValues {
  return {
    lastName: record.lastName,
    firstName: record.firstName,
    middleName: record.middleName ?? "",
    suffix: record.suffix ?? "",
    birthdate: record.birthdate,
    addressBarangay: record.addressBarangay,
    addressMunicipality: record.addressMunicipality,
    contactNumber: record.contactNumber,
    philhealthPin: record.philhealthPin ?? "",
    seniorCitizenId: record.seniorCitizenId ?? "",
    pwdId: record.pwdId ?? "",
    emergencyContactName: record.emergencyContactName ?? "",
    emergencyContactNumber: record.emergencyContactNumber ?? "",
  };
}

type Props = {
  record: PatientRecordData;
  open: boolean;
  /** The control to focus again when the sheet closes (Edit details). */
  returnFocusId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
};

export function EditPatientSheet({ record, open, returnFocusId, onClose, onSaved }: Props) {
  // While a save is in flight the sheet can't be dismissed: its result must land on a mounted form.
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keepFocus = useRef<HTMLElement | null>(null);
  const discarded = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  function requestClose() {
    if (saving) return;
    if (dirty.current) {
      keepFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      discarded.current = false;
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 sm:max-w-lg"
          onCloseAutoFocus={(event) => returnFocus(event, returnFocusId)}
        >
          {/* Mounted only while open (the caller keys the sheet per open, so it starts from the current details). */}
          <EditForm
            record={record}
            onCancel={requestClose}
            onSaved={onSaved}
            onPendingChange={setSaving}
            onDirtyChange={onDirtyChange}
          />
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmDiscard}
        onOpenChange={(next) => {
          if (!next) setConfirmDiscard(false);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // After Discard the sheet closes and returns focus to Edit details itself.
            if (!discarded.current) keepFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>The changes you made to these details will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep editing</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => {
                discarded.current = true;
                dirty.current = false;
                setConfirmDiscard(false);
                onClose();
              }}
            >
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditForm({
  record,
  onCancel,
  onSaved,
  onPendingChange,
  onDirtyChange,
}: {
  record: PatientRecordData;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onPendingChange: (pending: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  // A snapshot of the record as the form opened: the page may re-render underneath it.
  const [initialValues] = useState(() => valuesOf(record));
  const [initialSex] = useState<PatientSex>(record.sex);
  const [expectedUpdatedAt] = useState(record.updatedAt);
  const [values, setValues] = useState(initialValues);
  const [sex, setSex] = useState<PatientSex | "">(initialSex);
  // The record changed since the form opened: offer a reload instead of saving.
  const [stale, setStale] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => OPTIONAL_PATIENT_FIELDS.some((field) => initialValues[field] !== ""));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [matches, setMatches] = useState<PatientFinderRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  const focusAfterRender = useRef<string | null>(null);

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  const dirty =
    sex !== initialSex ||
    (Object.keys(values) as PatientTextField[]).some((field) => values[field] !== initialValues[field]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    focusAfterRender.current = null;
    target.focus();
  });

  const change = (field: PatientTextField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // The Possible match was for the name and birthdate as they were.
    if (field === "lastName" || field === "firstName" || field === "birthdate") setMatches(null);
  };

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    const first = EDIT_FIELD_ORDER.find((field) => fieldErrors[field]);
    if (!first) return;
    if ((OPTIONAL_PATIENT_FIELDS as readonly string[]).includes(first)) setMoreOpen(true);
    focusAfterRender.current = patientInputId(PREFIX, first);
  }

  /** Save; `confirmedMatchIds` are the Possible match ids shown on the card ("Save anyway"). */
  function save(confirmedMatchIds?: string[]) {
    setFormError(null);
    const input = { id: record.id, expectedUpdatedAt, ...values, sex, confirmedMatchIds };
    const check = patientEditSchema.safeParse(input);
    if (!check.success) {
      const fieldErrors: FieldErrors = {};
      for (const [key, message] of Object.entries(fieldErrorsOf(check.error))) if (isField(key)) fieldErrors[key] = message;
      setMatches(null);
      setFormError("Check the highlighted fields.");
      showErrors(fieldErrors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      let result: ActionResult<UpdatePatientData>;
      try {
        result = await updatePatientAction(input);
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        if (result.data.status === "possible_match") {
          focusAfterRender.current = MATCH_HEADING_ID;
          setMatches(result.data.matches);
          return;
        }
        onDirtyChange(false);
        onSaved(result.data.changed ? `Saved changes to ${result.data.name}.` : "No changes.");
        return;
      }
      if (result.error.code === "stale") {
        setStale(true);
        setFormError(result.error.message);
        return;
      }
      const split = splitErrors(result.error, isField);
      setFormError(split.formError);
      showErrors(split.fieldErrors as FieldErrors);
    });
  }

  return (
    <form
      noValidate
      aria-label="Edit patient details"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex h-full min-h-0 flex-col"
    >
      <SheetHeader className="border-b border-border">
        <SheetTitle>Edit details</SheetTitle>
        <SheetDescription>
          {record.name} · <span className="font-mono">{record.hospitalNumber}</span>. The Hospital Number and the
          privacy notice time don&apos;t change.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FormError message={formError} />
        {stale && (
          <div>
            {/* A full reload: the page and a fresh form show the latest details (what was typed here is lost). */}
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        )}
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
        {matches && matches.length > 0 && (
          <PossibleMatchCard
            headingId={MATCH_HEADING_ID}
            idPrefix={PREFIX}
            matches={matches}
            pending={pending}
            intro="Check this is a different person before saving."
            confirmLabel="Save anyway"
            onConfirm={() => save(matches.map((match) => match.id))}
          />
        )}
      </div>

      <SheetFooter className="flex-row justify-end border-t border-border">
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
      </SheetFooter>
    </form>
  );
}
