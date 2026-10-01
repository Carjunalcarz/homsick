"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, FileText, UserRound } from "lucide-react";
import { PatientRecordLink } from "@/components/patient-record-link";
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
import { formatAge } from "@/lib/age";
import { PATIENT_FINDER_INPUT_ID } from "@/lib/keyboard-shortcuts";
import { formatBirthdate, formatLastVisit } from "@/lib/patient-display";
import { SEX_LABELS } from "@/lib/patient-name";
import { guessNameFromQuery } from "@/lib/patient-search";
import type { PatientFinderRow } from "@/server/patients/actions";
import { PatientFinder } from "./patient-finder";
import { RegistrationForm } from "./registration-form";
import { TriageForm } from "./triage-form";

const PANEL =
  "flex min-w-0 flex-col gap-4 rounded-md bg-card p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] md:p-6 dark:ring-white/[0.06]";

export const SELECTED_HEADING_ID = "selected-heading";

/** The open registration form: `key` remounts it fresh each time "New patient" is chosen. */
type Registration = { key: number; lastName: string; firstName: string };

/** The picked patient: `key` remounts the triage form fresh for each pick. */
type Selection = { key: number; patient: PatientFinderRow; autoFocus: boolean };

/**
 * /triage: the Patient finder on the left, the triage form for the picked
 * patient on the right (stacked below lg). The form ends with the issued
 * Queue Number banner or the Directed to ER panel; Next patient (or Esc)
 * clears the screen and returns focus to the finder. "New patient" (for users who may
 * register) opens the inline registration form in the right column. Users
 * without `triage.record` see a summary card instead of the form.
 */
export function TriageWorkspace({
  canRegister = false,
  canRecord = false,
}: {
  canRegister?: boolean;
  canRecord?: boolean;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const selected = selection?.patient ?? null;
  // Bumped by Next patient: remounts the finder with an empty query.
  const [finderKey, setFinderKey] = useState(0);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [message, setMessage] = useState("");
  // Where focus goes after the right column changes.
  const focusNext = useRef<"heading" | "finder" | null>(null);
  // Whether the open form has anything typed in it (reported by the form).
  const formDirty = useRef(false);
  // "Discard this registration?": the action waiting on the answer, and where focus goes after.
  const [leaving, setLeaving] = useState<{ proceed: () => void; kind: "registration" | "triage" } | null>(null);
  const keepFocus = useRef<HTMLElement | null>(null);
  const discardFocus = useRef<string | null>(null);
  const discarded = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    formDirty.current = dirty;
  }, []);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "heading") document.getElementById(SELECTED_HEADING_ID)?.focus();
    if (target === "finder") document.getElementById(PATIENT_FINDER_INPUT_ID)?.focus();
  });

  /**
   * Run `proceed`, which closes or replaces the form, but first ask when the
   * form has something typed in it. `focusAfter` is the element id to focus
   * after "Discard" (null: `proceed` places focus itself); "Keep editing"
   * returns focus to where it was.
   */
  function leaveForm(proceed: () => void, focusAfter: string | null) {
    if ((registration || selection) && formDirty.current) {
      keepFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      discarded.current = false;
      discardFocus.current = focusAfter;
      setLeaving({ proceed, kind: registration ? "registration" : "triage" });
      return;
    }
    proceed();
  }

  function openRegistration(query: string) {
    const name = guessNameFromQuery(query) ?? { lastName: "", firstName: "" };
    formDirty.current = false;
    setMessage("");
    setRegistration((current) => ({ key: (current?.key ?? 0) + 1, ...name }));
  }

  function closeRegistration() {
    formDirty.current = false;
    setRegistration(null);
    focusNext.current = "finder";
  }

  function select(patient: PatientFinderRow, autoFocus: boolean) {
    setSelection((current) => ({ key: (current?.key ?? 0) + 1, patient, autoFocus }));
  }

  function selectFromFinder(patient: PatientFinderRow) {
    formDirty.current = false;
    select(patient, true);
    setRegistration(null);
    setMessage("");
  }

  function nextPatient() {
    formDirty.current = false;
    setSelection(null);
    setRegistration(null);
    setMessage("");
    setFinderKey((n) => n + 1);
    focusNext.current = "finder";
  }

  function showPatient(patient: PatientFinderRow, announcement: string) {
    formDirty.current = false;
    select(patient, false);
    setRegistration(null);
    setMessage(announcement);
    focusNext.current = "heading";
  }

  return (
    <div data-triage-workspace className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section aria-labelledby="finder-heading" className={PANEL}>
        <h2 id="finder-heading" className="text-lg font-medium">
          Patient
        </h2>
        <PatientFinder
          key={finderKey}
          onSelect={(patient) => leaveForm(() => selectFromFinder(patient), PATIENT_FINDER_INPUT_ID)}
          onNewPatient={canRegister ? (query) => leaveForm(() => openRegistration(query), null) : undefined}
        />
      </section>

      <section aria-labelledby={SELECTED_HEADING_ID} className={PANEL}>
        <h2 id={SELECTED_HEADING_ID} tabIndex={-1} className="text-lg font-medium outline-none">
          {registration ? "New patient" : selected && canRecord ? "Triage" : "Selected patient"}
        </h2>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-medium">
          {message && (
            <>
              <CircleCheck className="mr-1 inline size-4 align-text-bottom text-success" aria-hidden="true" />
              {message}
            </>
          )}
        </p>
        {registration ? (
          <RegistrationForm
            key={registration.key}
            initialName={registration}
            onCancel={() => leaveForm(closeRegistration, PATIENT_FINDER_INPUT_ID)}
            onDirtyChange={onDirtyChange}
            onRegistered={(patient) => showPatient(patient, `Registered ${patient.name} · ${patient.hospitalNumber}`)}
            onUseExisting={(patient) => showPatient(patient, `Selected ${patient.name}.`)}
          />
        ) : selection && canRecord ? (
          <TriageForm
            key={selection.key}
            patient={selection.patient}
            autoFocus={selection.autoFocus}
            onDirtyChange={onDirtyChange}
            onNextPatient={nextPatient}
          />
        ) : selected ? (
          <PatientSummary patient={selected} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <UserRound className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Find a patient on the left. Press Ctrl+K to jump to the search.
              {canRegister && " Not found? Choose New patient at the end of the list."}
            </p>
          </div>
        )}
      </section>

      <AlertDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = discarded.current
              ? discardFocus.current
                ? document.getElementById(discardFocus.current)
                : null
              : keepFocus.current;
            target?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {leaving?.kind === "triage" ? "Discard this triage?" : "Discard this registration?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {leaving?.kind === "triage"
                ? "What you entered for this patient will be lost."
                : "What you typed for the new patient will be lost."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep editing</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => {
                const proceed = leaving?.proceed;
                discarded.current = true;
                setLeaving(null);
                proceed?.();
              }}
            >
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PatientSummary({ patient }: { patient: PatientFinderRow }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p id="selected-patient-name" className="text-xl font-medium break-words">
          {patient.name}
        </p>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-sm">{patient.hospitalNumber}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Age</dt>
          <dd className="font-medium">{formatAge(patient.age)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sex</dt>
          <dd className="font-medium">{SEX_LABELS[patient.sex]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Birthdate</dt>
          <dd className="font-medium">{formatBirthdate(patient.birthdate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last visit</dt>
          <dd className="font-medium">{formatLastVisit(patient.lastVisit)}</dd>
        </div>
      </dl>
      <div>
        <PatientRecordLink
          patientId={patient.id}
          aria-describedby="selected-patient-name"
          className="inline-flex h-11 items-center gap-2 rounded border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText className="size-4" aria-hidden="true" />
          Open record
        </PatientRecordLink>
      </div>
    </div>
  );
}
