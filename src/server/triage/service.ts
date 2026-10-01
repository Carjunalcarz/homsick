import "server-only";
import { ageOn } from "@/lib/age";
import { opdDate } from "@/lib/time";
import {
  ID_CATEGORIES,
  isIdCategory,
  lowestNonErRank,
  SENIOR_MIN_AGE,
  TRIAGE_MESSAGES,
  urgencyTone,
  type PriorityIdStatus,
  type TriageField,
  type TriageInput,
  type UrgencyTone,
} from "@/lib/triage";
import type { PatientSex } from "@/lib/patient-name";
import { abnormalFields, type VitalField } from "@/lib/vital-signs";
import { AuditAction } from "@/server/audit/schema";
import type { Actor } from "@/server/audit/service";
import { getDb, type Db } from "@/server/db/client";
import { DomainError } from "@/server/db/errors";
import { withCommandTx, type Tx } from "@/server/db/tx";
// `visits` owns the Visit and its status; triage only asks it to open one.
import { getTriagePatient, setPriorityId } from "@/server/patients/service";
import {
  enabledPriorityCategories,
  urgencyLevels,
  type PriorityCategory,
  type UrgencyLevel,
} from "@/server/settings/queries";
import { facilityTiles, type FacilityTile } from "@/server/queue/queries";
import * as queueService from "@/server/queue/service";
import { activeVisitOn } from "@/server/visits/queries";
import * as visitsService from "@/server/visits/service";
import { insertTriageRecord, TriageError } from "./repo";

/*
 * Recording triage (Story 3.4, FR-7) and issuing the Queue Number or
 * directing to the ER (Story 3.5, FR-8, FR-9). One command: open the Visit,
 * store the Triage Record with the priority snapshot (AD-6), save a typed
 * Senior Citizen or PWD ID to the Patient Record, then issue the Facility's
 * next Queue Number (Visit `in_queue`) or close the Visit as Directed to ER,
 * all in one `withCommandTx` with one `triage.recorded` audit row. Vital
 * Signs and the complaint are never audited or logged.
 */

export { TriageError } from "./repo";

/** A refused save that points at one form field. */
export class TriageFieldError extends DomainError {
  constructor(
    readonly field: TriageField,
    message: string,
  ) {
    super(TriageError.Invalid, message);
  }
}

/**
 * The queue group (AD-6): 1 when the level is more urgent (lower rank) than
 * the lowest active non-ER rank; otherwise 2 with an enabled Priority
 * Category; otherwise 3. An ER level has no group (null).
 */
export function sortGroupFor(
  level: Pick<UrgencyLevel, "isEr" | "rank">,
  activeLevels: readonly Pick<UrgencyLevel, "isEr" | "rank">[],
  hasPriorityCategory: boolean,
): 1 | 2 | 3 | null {
  if (level.isEr || level.rank === null) return null;
  const lowest = lowestNonErRank([...activeLevels, level]) as number;
  if (level.rank < lowest) return 1;
  return hasPriorityCategory ? 2 : 3;
}

export type TriageSnapshot = {
  urgencyLevelId: string;
  urgencyName: string;
  urgencyRank: number | null;
  urgencyIsEr: boolean;
  urgencyTone: UrgencyTone;
  sortGroup: 1 | 2 | 3 | null;
  priorityCategory: string | null;
  priorityIdStatus: PriorityIdStatus | null;
};

/** The Queue Number issued by a queued triage. */
export type IssuedNumber = {
  /** The Queue Entry's id: the slip is printed from `/print/slip/{entryId}` (Story 3.6). */
  entryId: string;
  facilityId: string;
  facilityName: string;
  /** `formatQueueNumber(prefix, seq)`. */
  queueNumber: string;
  /** Waiting and called entries before it in the queue order. */
  ahead: number;
};

type TriageOutcomeBase = {
  visitId: string;
  opdDate: string;
  patientName: string;
  urgencyName: string;
  urgencyIsEr: boolean;
  /** The badge tone stored with the snapshot. */
  urgencyTone: UrgencyTone;
  /** A Senior Citizen or PWD ID typed at triage was saved to the Patient Record. */
  priorityIdEntered: boolean;
  /** The Priority Category's name, or null for None. */
  priorityCategoryName: string | null;
  sortGroup: 1 | 2 | 3 | null;
  abnormalFields: VitalField[];
};

/**
 * How a triage ended, by `outcome`:
 * - `queued`: a Queue Number was issued, the Visit is `in_queue`;
 * - `directed_to_er`: no number, the Visit closed at `closedAt`;
 * - `paper_number`: a not-live Facility; the nurse gives a paper number, the Visit stays `open`.
 */
type TriageEnding =
  | { outcome: "queued"; queue: IssuedNumber; closedAt: null; paperFacility: null }
  | { outcome: "directed_to_er"; queue: null; closedAt: string; paperFacility: null }
  | { outcome: "paper_number"; queue: null; closedAt: null; paperFacility: { id: string; name: string } };

export type RecordTriageOutcome = TriageOutcomeBase & TriageEnding;

/** Whether `error` (or its cause, as Drizzle wraps it) is a SQLite UNIQUE violation on `visits`. */
export function isActiveVisitConflict(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (code === "SQLITE_CONSTRAINT_UNIQUE" && typeof message === "string" && message.includes("visits.")) return true;
  }
  return false;
}

/** "{Name} already has an open Visit today." */
export function alreadyOpenMessage(name: string): string {
  return `${name} already has an open Visit today.`;
}

/**
 * Check the Priority Category against the patient and settings, and decide
 * the ID handling. Throws `TriageFieldError` for a refused choice.
 */
function priorityChoice(
  input: Pick<TriageInput, "priorityCategory" | "priorityId" | "idNotPresented">,
  patient: { sex: string; age: number | null; seniorCitizenId: string | null; pwdId: string | null },
  categories: readonly PriorityCategory[],
): { category: PriorityCategory | null; idStatus: PriorityIdStatus | null; enteredId: string | null } {
  if (!input.priorityCategory) return { category: null, idStatus: null, enteredId: null };
  const category = categories.find((c) => c.code === input.priorityCategory);
  if (!category) throw new TriageFieldError("priorityCategory", TRIAGE_MESSAGES.categoryUnavailable);
  if (category.code === "pregnant" && patient.sex !== "female") {
    throw new TriageFieldError("priorityCategory", TRIAGE_MESSAGES.pregnantSex);
  }
  if (category.code === "senior_citizen" && (patient.age === null || patient.age < SENIOR_MIN_AGE)) {
    throw new TriageFieldError("priorityCategory", TRIAGE_MESSAGES.seniorAge);
  }
  if (!isIdCategory(category.code)) return { category, idStatus: null, enteredId: null };

  const onFile = patient[ID_CATEGORIES[category.code]];
  if (onFile && onFile.trim() !== "") return { category, idStatus: "on_file", enteredId: null };
  if (input.priorityId) return { category, idStatus: "entered", enteredId: input.priorityId };
  if (input.idNotPresented) return { category, idStatus: "not_presented", enteredId: null };
  throw new TriageFieldError(
    "priorityId",
    category.code === "senior_citizen" ? TRIAGE_MESSAGES.seniorId : TRIAGE_MESSAGES.pwdId,
  );
}

/**
 * Which way the triage ends (Story 3.5): a non-ER level needs a Facility and
 * no `directToEr`; an ER level needs the confirmed `directToEr` and no
 * Facility. Anything else is refused (`invalid`).
 */
function outcomeFor(level: UrgencyLevel, input: Pick<TriageInput, "facilityId" | "directToEr">): "facility" | "directed_to_er" {
  if (level.isEr) {
    if (input.directToEr !== true || input.facilityId) throw new DomainError(TriageError.Invalid, TRIAGE_MESSAGES.erConfirm);
    return "directed_to_er";
  }
  if (input.directToEr) throw new DomainError(TriageError.Invalid, TRIAGE_MESSAGES.erOnly);
  if (!input.facilityId) throw new TriageFieldError("facilityId", TRIAGE_MESSAGES.facility);
  return "facility";
}

/**
 * Record triage for a patient (FR-7, FR-8, FR-9): in one IMMEDIATE
 * `withCommandTx`, `visits.open`, the Triage Record insert with the snapshot
 * read from the settings getters now, (when typed) the patient's Senior
 * Citizen or PWD ID, then either:
 *
 * - a non-ER level: `queue.issue` takes the chosen Facility's next Queue
 *   Number and the Visit moves to `in_queue`;
 * - a non-ER level at an open but not-live Facility (PRD §10 pilot): the
 *   Triage Record stores `paper_facility_id`, no Queue Entry, the Visit stays
 *   `open` (outcome `paper_number`);
 * - an ER level with the confirmed `directToEr`: the Visit moves to
 *   `directed_to_er` (closed), with no Queue Entry.
 *
 * Writes one `triage.recorded` row (entity `visit`) with the patient id, the
 * snapshot, the ID choice (`{ seniorCitizenId|pwdId: { old, new } }` when
 * entered), `outcome`, `facilityId`, `queueNumber`, `ahead` and `closedAt`.
 *
 * Throws `not_found` (unknown patient), `visit_already_open`,
 * `facility_unavailable`, `invalid` (a Facility with an ER level, or ER
 * without its confirmation), or `TriageFieldError` (`invalid`, with the
 * field) for a refused choice or a missing Facility.
 */
export function recordTriage(
  input: TriageInput,
  actor: Actor,
  now: Date = new Date(),
  db: Db = getDb(),
): RecordTriageOutcome {
  return withCommandTx(
    actor,
    AuditAction.TriageRecorded,
    (tx, audit) => {
      const patient = getTriagePatient(tx, input.patientId);
      if (!patient) throw new DomainError(TriageError.NotFound, "This patient record no longer exists.");
      if (patient.deactivated) throw new DomainError(TriageError.PatientDeactivated, DEACTIVATED_MESSAGE);
      const today = opdDate(now);
      if (activeVisitOn(patient.id, today, tx)) {
        throw new DomainError(TriageError.VisitAlreadyOpen, alreadyOpenMessage(patient.name));
      }

      const levels = urgencyLevels(tx);
      const level = levels.find((l) => l.id === input.urgencyLevelId);
      if (!level) throw new TriageFieldError("urgencyLevelId", TRIAGE_MESSAGES.urgencyUnavailable);
      const route = outcomeFor(level, input);
      // A live Facility queues; an open, not-live one gets a paper number; closed or unknown is refused.
      const target = route === "facility" ? queueService.facilityFor(tx, input.facilityId as string, now) : null;

      const age = ageOn(patient.birthdate, today);
      const choice = priorityChoice(input, { ...patient, age }, enabledPriorityCategories(tx));
      const snapshot: TriageSnapshot = {
        urgencyLevelId: level.id,
        urgencyName: level.name,
        urgencyRank: level.isEr ? null : level.rank,
        urgencyIsEr: level.isEr,
        urgencyTone: urgencyTone(level, levels),
        sortGroup: sortGroupFor(level, levels, choice.category !== null),
        priorityCategory: choice.category?.code ?? null,
        priorityIdStatus: choice.idStatus,
      };

      let visit;
      try {
        visit = visitsService.open(tx, { patientId: patient.id, actor, now });
      } catch (error) {
        // A second active Visit (the check above, or the unique index in a race): say whose.
        if (isActiveVisitConflict(error) || (error instanceof DomainError && error.code === TriageError.VisitAlreadyOpen)) {
          throw new DomainError(TriageError.VisitAlreadyOpen, alreadyOpenMessage(patient.name));
        }
        throw error;
      }
      const abnormal = abnormalFields(input, age);
      const at = now.toISOString();
      insertTriageRecord(tx, {
        id: crypto.randomUUID(),
        visitId: visit.id,
        patientId: patient.id,
        chiefComplaint: input.chiefComplaint,
        temperatureC: input.temperatureC as number,
        bpSystolic: input.bpSystolic as number,
        bpDiastolic: input.bpDiastolic as number,
        pulse: input.pulse as number,
        respiratoryRate: input.respiratoryRate as number,
        spo2: input.spo2 ?? null,
        weightKg: input.weightKg ?? null,
        abnormalFields: JSON.stringify(abnormal),
        ...snapshot,
        paperFacilityId: target?.mode === "paper" ? target.facility.id : null,
        recordedBy: actor.id ?? actor.name ?? "unknown",
        recordedAt: at,
      });

      const idChange: Record<string, unknown> = {};
      if (choice.enteredId !== null && choice.category && isIdCategory(choice.category.code)) {
        const field = ID_CATEGORIES[choice.category.code];
        idChange[field] = setPriorityId(tx, patient.id, field, choice.enteredId, now);
      }

      let ending: TriageEnding;
      if (target?.mode === "paper") {
        // PRD §10 pilot: no Queue Entry; the Visit stays open.
        ending = {
          outcome: "paper_number",
          queue: null,
          closedAt: null,
          paperFacility: { id: target.facility.id, name: target.facility.name },
        };
      } else if (target) {
        const entry = queueService.issue(tx, {
          visitId: visit.id,
          facilityId: target.facility.id,
          snapshot: {
            urgencyLevelId: snapshot.urgencyLevelId,
            urgencyRank: snapshot.urgencyRank as number,
            sortGroup: snapshot.sortGroup as 1 | 2 | 3,
            priorityCategory: snapshot.priorityCategory,
          },
          actor,
          now,
        });
        visitsService.transition(tx, visit.id, "in_queue", now);
        ending = {
          outcome: "queued",
          queue: {
            entryId: entry.entryId,
            facilityId: entry.facilityId,
            facilityName: entry.facilityName,
            queueNumber: entry.queueNumber,
            ahead: entry.ahead,
          },
          closedAt: null,
          paperFacility: null,
        };
      } else {
        const closedAt = visitsService.transition(tx, visit.id, "directed_to_er", now).closedAt ?? now.toISOString();
        ending = { outcome: "directed_to_er", queue: null, closedAt, paperFacility: null };
      }

      audit({
        entity: "visit",
        entityId: visit.id,
        changes: {
          patientId: patient.id,
          ...snapshot,
          ...idChange,
          outcome: ending.outcome,
          facilityId: ending.queue?.facilityId ?? ending.paperFacility?.id ?? null,
          queueNumber: ending.queue?.queueNumber ?? null,
          ahead: ending.queue?.ahead ?? null,
          closedAt: ending.closedAt,
        },
        at: now,
      });

      return {
        visitId: visit.id,
        opdDate: visit.opdDate,
        ...ending,
        patientName: patient.name,
        urgencyName: level.name,
        urgencyIsEr: level.isEr,
        urgencyTone: snapshot.urgencyTone,
        priorityIdEntered: choice.enteredId !== null,
        priorityCategoryName: choice.category?.name ?? null,
        sortGroup: snapshot.sortGroup,
        abnormalFields: abnormal,
      };
    },
    db,
  );
}

const DEACTIVATED_MESSAGE = "This patient record is deactivated. Triage can't be recorded.";

/** What the triage form needs before the nurse starts (not audited: no record details). */
export type TriageContext = {
  patientId: string;
  name: string;
  sex: PatientSex;
  age: number | null;
  seniorCitizenIdOnFile: boolean;
  pwdIdOnFile: boolean;
  /** An `open` or `in_queue` Visit today: triage is refused. */
  openVisit: boolean;
  /** Active Urgency Levels, non-ER by rank, then ER. */
  levels: UrgencyLevel[];
  /** Enabled Priority Categories, in display order. */
  categories: Pick<PriorityCategory, "code" | "name">[];
  /** The active Facilities in display order, with availability (reason text in Manila time) and waiting counts. */
  facilities: FacilityTile[];
};

export function getTriageContext(patientId: string, now: Date = new Date(), db: Db | Tx = getDb()): TriageContext | null {
  const patient = getTriagePatient(db, patientId);
  if (!patient) return null;
  if (patient.deactivated) throw new DomainError(TriageError.PatientDeactivated, DEACTIVATED_MESSAGE);
  const today = opdDate(now);
  return {
    patientId: patient.id,
    name: patient.name,
    sex: patient.sex,
    age: ageOn(patient.birthdate, today),
    seniorCitizenIdOnFile: !!patient.seniorCitizenId?.trim(),
    pwdIdOnFile: !!patient.pwdId?.trim(),
    openVisit: activeVisitOn(patient.id, today, db) !== undefined,
    levels: urgencyLevels(db).map(({ id, name, isEr, rank }) => ({ id, name, isEr, rank })),
    categories: enabledPriorityCategories(db).map((c) => ({ code: c.code, name: c.name })),
    facilities: facilityTiles(now, db),
  };
}
