import "server-only";
import { ageOn } from "@/lib/age";
import { formatBirthdate } from "@/lib/patient-display";
import { formatPatientName, type PatientSex } from "@/lib/patient-name";
import type { PriorityIdField, UrgencyTone } from "@/lib/triage";
import { VISIT_STATUS_LABELS, type VisitStatus } from "@/lib/visit-status";
import { triageSummaries } from "@/server/triage/queries";
import { visitsForPatient } from "@/server/visits/queries";
import {
  PATIENT_EDIT_FIELDS,
  STALE_MESSAGE,
  type PatientEditInput,
  type PatientRegistrationInput,
} from "@/lib/patient-registration";
import { opdDate } from "@/lib/time";
import { AuditAction } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { getDb, type Db } from "@/server/db/client";
import { DomainError } from "@/server/db/errors";
import { withCommandTx, type Tx } from "@/server/db/tx";
import {
  selectPatientRecord,
  selectPossibleMatches,
  toFinderRow,
  toSearchRow,
  type PatientFinderRow,
  type PatientRecordRow,
} from "./queries";
import { insertPatient, nextHospitalNumber, PatientError, updatePatient as updatePatientRow } from "./repo";

/*
 * Patient commands (Stories 3.2 and 3.3). Each runs in one `withCommandTx`
 * and writes one audit row (a record view too). Nothing here logs names,
 * numbers or other patient data.
 */

/** The longest id looked up; anything longer can't be a patient id. */
const MAX_ID_LENGTH = 64;

/** Thrown inside the transaction so an unknown id writes no audit row. */
class RecordMissing extends Error {}

/** Thrown inside the transaction so a save that changes nothing writes nothing. */
class Unchanged extends Error {
  constructor(readonly patientName: string) {
    super("unchanged");
  }
}

export type CreatePatientOutcome =
  | { status: "created"; patient: PatientFinderRow }
  | { status: "possible_match"; matches: PatientFinderRow[] };

/** Thrown inside the transaction so a possible duplicate writes nothing (no number, no audit row). */
class PossibleMatchFound extends Error {
  constructor(readonly matches: PatientFinderRow[]) {
    super("possible_match");
  }
}

/**
 * Active patients who may be the same person: same last name, first name
 * (Unicode case-insensitive) and birthdate.
 */
export function findPossibleMatches(
  tx: Db | Tx,
  input: Pick<PatientRegistrationInput, "lastName" | "firstName" | "birthdate">,
  now: Date = new Date(),
): PatientFinderRow[] {
  return selectPossibleMatches(tx, input, now);
}

/**
 * Register a patient (FR-5): a possible match not listed in
 * `confirmedMatchIds` returns every current match and creates nothing.
 * Otherwise the next Hospital Number for the Manila year is issued and the
 * patient inserted, with
 * `privacy_notice_at` set to the save time, in one transaction with one
 * `patient.created` audit row listing the number, every field set and the
 * confirmed matches' Hospital Numbers.
 */
export function createPatient(
  input: PatientRegistrationInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): CreatePatientOutcome {
  try {
    return withCommandTx(
      actor,
      AuditAction.PatientCreated,
      (tx, audit) => {
        const matches = findPossibleMatches(tx, input, now);
        // Only matches the nurse was shown count as confirmed; any other asks again, with the full list.
        const confirmed = new Set(input.confirmedMatchIds ?? []);
        if (matches.some((match) => !confirmed.has(match.id))) throw new PossibleMatchFound(matches);

        const at = now.toISOString();
        const today = opdDate(now);
        const hospitalNumber = nextHospitalNumber(tx, Number(today.slice(0, 4)));
        const id = crypto.randomUUID();
        const fields = {
          lastName: input.lastName,
          firstName: input.firstName,
          middleName: input.middleName ?? null,
          suffix: input.suffix ?? null,
          sex: input.sex,
          birthdate: input.birthdate,
          addressBarangay: input.addressBarangay,
          addressMunicipality: input.addressMunicipality,
          contactNumber: input.contactNumber,
          philhealthPin: input.philhealthPin ?? null,
          seniorCitizenId: input.seniorCitizenId ?? null,
          pwdId: input.pwdId ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactNumber: input.emergencyContactNumber ?? null,
          privacyNoticeAt: at,
        };
        insertPatient(tx, {
          id,
          hospitalNumber,
          ...fields,
          createdAt: at,
          updatedAt: at,
          createdBy: actor.id ?? actor.name ?? "unknown",
        });

        const changes: Record<string, unknown> = { hospitalNumber };
        for (const [key, value] of Object.entries(fields)) {
          if (value !== null) changes[key] = value;
        }
        if (matches.length > 0) changes.possibleMatchesConfirmed = matches.map((match) => match.hospitalNumber);
        audit({ entity: "patient", entityId: id, changes, at: now });

        const row = { id, hospitalNumber, ...fields };
        return { status: "created", patient: toFinderRow(toSearchRow(row, today)) } as const;
      },
      db,
    );
  } catch (error) {
    if (error instanceof PossibleMatchFound) return { status: "possible_match", matches: error.matches };
    throw error;
  }
}

/**
 * One Visit in a record's history, assembled from the `visits` and `triage`
 * queries: no Vital Signs or complaint (Facility Staff see this list too).
 */
export type PatientVisitSummary = {
  id: string;
  /** The Manila OPD day, `YYYY-MM-DD`. */
  opdDate: string;
  /** e.g. "Sep 27, 2026". */
  dateLabel: string;
  status: VisitStatus;
  statusLabel: string;
  /** The Urgency Level snapshot, or null for a Visit without triage. */
  urgency: { name: string; isEr: boolean; tone: UrgencyTone } | null;
};

/** A patient's Visits, newest first, with their status and Urgency Level. */
function visitHistory(tx: Db | Tx, patientId: string): PatientVisitSummary[] {
  const list = visitsForPatient(patientId, tx);
  if (list.length === 0) return [];
  const triage = triageSummaries(
    list.map((visit) => visit.id),
    tx,
  );
  return list.map((visit) => {
    const snapshot = triage.get(visit.id);
    return {
      id: visit.id,
      opdDate: visit.opdDate,
      dateLabel: formatBirthdate(visit.opdDate),
      status: visit.status,
      statusLabel: VISIT_STATUS_LABELS[visit.status],
      urgency: snapshot
        ? {
            name: snapshot.urgencyName,
            isEr: snapshot.urgencyIsEr,
            // Stored at save time (AD-6): a later settings change never recolours an old Visit.
            tone: snapshot.urgencyTone,
          }
        : null,
    };
  });
}

/** What `/patients/[id]` shows: the whole record, its display name, age and Visit history. */
export type PatientRecordView = {
  patient: PatientRecordRow;
  /** `formatPatientName()`: "DELA CRUZ, Juan Santos". */
  name: string;
  /** Whole years on today's Manila date. */
  age: number | null;
  visits: PatientVisitSummary[];
};

/**
 * Open a Patient Record (FR-6, PRIV-2). The caller has already checked
 * `patients.view`. Each view writes one `patient.viewed` audit row (entity
 * `patient`, no field values) in its own `withCommandTx`. An unknown id
 * returns null and writes nothing. A deactivated patient still opens.
 */
export function getRecordView(
  id: string,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): PatientRecordView | null {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  try {
    return withCommandTx(
      actor,
      AuditAction.PatientViewed,
      (tx, audit) => {
        const patient = selectPatientRecord(tx, id);
        if (!patient) throw new RecordMissing();
        audit({ entity: "patient", entityId: patient.id, at: now });
        return {
          patient,
          name: formatPatientName(patient),
          age: ageOn(patient.birthdate, opdDate(now)),
          visits: visitHistory(tx, patient.id),
        };
      },
      db,
    );
  } catch (error) {
    if (error instanceof RecordMissing) return null;
    throw error;
  }
}

export type UpdatePatientOutcome =
  | { status: "updated"; changed: boolean; name: string }
  | { status: "possible_match"; matches: PatientFinderRow[] };

type EditValues = Pick<PatientRecordRow, (typeof PATIENT_EDIT_FIELDS)[number]>;

/** The stored form of an edit: optional fields left blank are null. */
function editValues(input: PatientEditInput): EditValues {
  return {
    lastName: input.lastName,
    firstName: input.firstName,
    middleName: input.middleName ?? null,
    suffix: input.suffix ?? null,
    sex: input.sex,
    birthdate: input.birthdate,
    addressBarangay: input.addressBarangay,
    addressMunicipality: input.addressMunicipality,
    contactNumber: input.contactNumber,
    philhealthPin: input.philhealthPin ?? null,
    seniorCitizenId: input.seniorCitizenId ?? null,
    pwdId: input.pwdId ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactNumber: input.emergencyContactNumber ?? null,
  };
}

/**
 * Correct a patient's demographics (FR-6). In one `withCommandTx`: load the
 * row, compare the fields, save the changed ones through the repo (which
 * recomputes `search_text` and sets `updated_at`) and write one
 * `patient.updated` audit row with `{ field: { old, new } }` for the changed
 * fields only. A save that changes nothing writes nothing (`changed: false`).
 * When the name or birthdate changes to match another active patient, not
 * listed in `confirmedMatchIds`, nothing is saved and the matches come back.
 * The Hospital Number, `created_*` and `privacy_notice_at` never change.
 * Throws `DomainError(not_found)` for an unknown id and `DomainError(stale)`
 * when the record's `updated_at` isn't the `expectedUpdatedAt` the form
 * opened with.
 */
export function updatePatient(
  input: PatientEditInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): UpdatePatientOutcome {
  try {
    return withCommandTx(
      actor,
      AuditAction.PatientUpdated,
      (tx, audit) => {
        const current = selectPatientRecord(tx, input.id);
        if (!current) throw new DomainError(PatientError.NotFound, "This patient record no longer exists.");
        // Someone saved since this form opened: refuse rather than overwrite their change.
        if (current.updatedAt !== input.expectedUpdatedAt) throw new DomainError(PatientError.Stale, STALE_MESSAGE);

        const next = editValues(input);
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const field of PATIENT_EDIT_FIELDS) {
          if (current[field] !== next[field]) changes[field] = { old: current[field], new: next[field] };
        }
        if (Object.keys(changes).length === 0) throw new Unchanged(formatPatientName(current));

        // Only a new name or birthdate can make this record look like someone else's.
        if (changes.lastName || changes.firstName || changes.birthdate) {
          const matches = selectPossibleMatches(tx, next, now, current.id);
          const confirmed = new Set(input.confirmedMatchIds ?? []);
          if (matches.some((match) => !confirmed.has(match.id))) throw new PossibleMatchFound(matches);
        }

        const changed = Object.fromEntries(Object.keys(changes).map((field) => [field, next[field as keyof EditValues]]));
        updatePatientRow(tx, current.id, changed, now);
        audit({ entity: "patient", entityId: current.id, changes, at: now });
        return { status: "updated", changed: true, name: formatPatientName(next) } as const;
      },
      db,
    );
  } catch (error) {
    if (error instanceof PossibleMatchFound) return { status: "possible_match", matches: error.matches };
    if (error instanceof Unchanged) return { status: "updated", changed: false, name: error.patientName };
    throw error;
  }
}

/** What triage needs to know about a patient: no address or contact details. */
export type TriagePatient = {
  id: string;
  name: string;
  sex: PatientSex;
  birthdate: string;
  seniorCitizenId: string | null;
  pwdId: string | null;
  deactivated: boolean;
};

/** The patient as triage sees them (inside the triage command's `tx`, or a read), or undefined. */
export function getTriagePatient(tx: Db | Tx, id: string): TriagePatient | undefined {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return undefined;
  const row = selectPatientRecord(tx, id);
  if (!row) return undefined;
  return {
    id: row.id,
    name: formatPatientName(row),
    sex: row.sex,
    birthdate: row.birthdate,
    seniorCitizenId: row.seniorCitizenId,
    pwdId: row.pwdId,
    deactivated: row.deactivatedAt !== null,
  };
}

/**
 * Save a Senior Citizen or PWD ID shown at triage onto the Patient Record,
 * inside the caller's command (`recordTriage`), which audits the old and new
 * value in its own row: this writes no audit row. Returns the change.
 * Throws `not_found` for an unknown patient.
 */
export function setPriorityId(
  tx: Tx,
  patientId: string,
  kind: PriorityIdField,
  value: string,
  now: Date = new Date(),
): { old: string | null; new: string } {
  const current = selectPatientRecord(tx, patientId);
  if (!current) throw new DomainError(PatientError.NotFound, "This patient record no longer exists.");
  const old = current[kind];
  updatePatientRow(tx, patientId, { [kind]: value }, now);
  return { old, new: value };
}
