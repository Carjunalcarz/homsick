import "server-only";
import type { Tx } from "@/server/db/tx";
import { triageRecords, type NewTriageRecordRow } from "./schema";

/* Writes to `triage_records`, inside the caller's transaction. Records are never updated. */

export const TriageError = {
  Invalid: "invalid",
  NotFound: "not_found",
  PatientDeactivated: "patient_deactivated",
  VisitAlreadyOpen: "visit_already_open",
} as const;

export function insertTriageRecord(tx: Tx, values: NewTriageRecordRow): void {
  tx.insert(triageRecords).values(values).run();
}
