"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, CircleCheck, ClipboardList, Pencil, PowerOff } from "lucide-react";
import { UrgencyBadge } from "@/components/urgency-badge";
import { SEX_LABELS } from "@/lib/patient-name";
import { EditPatientSheet } from "./edit-patient-sheet";
import type { PatientRecordData } from "./record-types";

export const EDIT_BUTTON_ID = "edit-patient-details";

const PANEL =
  "flex min-w-0 flex-col gap-4 rounded-md bg-card p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] md:p-6 dark:ring-white/[0.06]";

/** A stored value, or "—" read out as "Not recorded". */
function Value({ value, mono = false }: { value: string | null; mono?: boolean }) {
  if (value === null || value.trim() === "") {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not recorded</span>
      </span>
    );
  }
  return <span className={mono ? "font-mono" : undefined}>{value}</span>;
}

function Detail({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">
        <Value value={value} mono={mono} />
      </dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={PANEL}>
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The Patient Record (Story 3.3): header, details and Visit history. The
 * Edit details sheet is offered only with `patients.edit` (the action checks
 * it again). There is no delete control.
 */
export function PatientRecordScreen({ record, canEdit }: { record: PatientRecordData; canEdit: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  // Bumped on each open, so the sheet's form mounts fresh with the current details.
  const [editSeq, setEditSeq] = useState(0);
  const [message, setMessage] = useState("");

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href="/patients"
          className="inline-flex min-h-11 w-fit items-center gap-1 rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Patients
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-3xl font-light tracking-tight break-words">{record.name}</h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="rounded bg-muted px-2 py-0.5 font-mono">
                <span className="sr-only">Hospital Number </span>
                {record.hospitalNumber}
              </span>
              <span>
                <span className="text-muted-foreground">Age </span>
                <span className="font-medium">{record.ageLabel}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Sex </span>
                <span className="font-medium">{SEX_LABELS[record.sex]}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Born </span>
                <span className="font-medium">{record.birthdateLabel}</span>
              </span>
              {record.deactivated && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-destructive/40 px-2.5 text-xs font-medium text-destructive">
                  <PowerOff className="size-3.5" aria-hidden="true" />
                  Deactivated
                </span>
              )}
            </p>
          </div>
          {canEdit && (
            <button
              id={EDIT_BUTTON_ID}
              type="button"
              onClick={() => {
                setMessage("");
                setEditSeq((n) => n + 1);
                setEditOpen(true);
              }}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit details
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm font-medium">
          {message && (
            <>
              <CircleCheck className="mr-1 inline size-4 align-text-bottom text-success" aria-hidden="true" />
              {message}
            </>
          )}
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Section id="record-contact" title="Contact & address">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Contact number" value={record.contactNumber} mono />
            <Detail label="Barangay" value={record.addressBarangay} />
            <Detail label="Municipality" value={record.addressMunicipality} />
          </dl>
        </Section>

        <Section id="record-ids" title="IDs">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="PhilHealth PIN" value={record.philhealthPin} mono />
            <Detail label="Senior Citizen ID" value={record.seniorCitizenId} />
            <Detail label="PWD ID" value={record.pwdId} />
          </dl>
        </Section>

        <Section id="record-emergency" title="Emergency contact">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Name" value={record.emergencyContactName} />
            <Detail label="Number" value={record.emergencyContactNumber} mono />
          </dl>
        </Section>

        <Section id="record-privacy" title="Privacy notice">
          <dl>
            <Detail label="Explained to the patient" value={record.privacyNoticeLabel} />
          </dl>
        </Section>
      </div>

      <Section id="record-visits" title="Visit history">
        {record.visits.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No visits yet.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Visits, newest first">
            {record.visits.map((visit) => (
              <li
                key={visit.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-border px-3 py-2 text-sm"
              >
                <time dateTime={visit.opdDate} className="min-w-28 font-medium">
                  {visit.dateLabel}
                </time>
                <span className="inline-flex h-6 items-center rounded-full border border-border px-2.5 text-xs font-medium">
                  <span className="sr-only">Status: </span>
                  {visit.statusLabel}
                </span>
                {visit.urgency ? (
                  <UrgencyBadge name={visit.urgency.name} tone={visit.urgency.tone} isEr={visit.urgency.isEr} />
                ) : (
                  <span className="text-muted-foreground">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">No triage recorded</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canEdit && (
        <EditPatientSheet
          key={editSeq}
          record={record}
          open={editOpen}
          returnFocusId={EDIT_BUTTON_ID}
          onClose={() => setEditOpen(false)}
          onSaved={(text) => {
            setEditOpen(false);
            setMessage(text);
          }}
        />
      )}
    </>
  );
}
