import "server-only";
import { and, desc, eq, inArray, max, ne } from "drizzle-orm";
import { ACTIVE_VISIT_STATUSES, type VisitStatus } from "@/lib/visit-status";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { visits } from "./schema";

/*
 * Visit reads (Story 3.4). Other modules read `visits` only through these.
 * Not audited here: the record view audits itself.
 */

export type VisitSummary = {
  id: string;
  patientId: string;
  /** The Manila OPD day, `YYYY-MM-DD`. */
  opdDate: string;
  status: VisitStatus;
  openedAt: string;
  closedAt: string | null;
};

const SUMMARY = {
  id: visits.id,
  patientId: visits.patientId,
  opdDate: visits.opdDate,
  status: visits.status,
  openedAt: visits.openedAt,
  closedAt: visits.closedAt,
};

/** One patient's Visits, newest first. */
export function visitsForPatient(patientId: string, db: Db | Tx = getDb()): VisitSummary[] {
  return db
    .select(SUMMARY)
    .from(visits)
    .where(eq(visits.patientId, patientId))
    .orderBy(desc(visits.opdDate), desc(visits.openedAt))
    .all();
}

/** The last Visit's OPD date per patient, cancelled Visits not counted; patients with none are left out. */
export function lastVisitDates(patientIds: readonly string[], db: Db | Tx = getDb()): Map<string, string> {
  const result = new Map<string, string>();
  const ids = [...new Set(patientIds)];
  // SQLite caps bound parameters; the finder and list pages ask for at most a page.
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    const rows = db
      .select({ patientId: visits.patientId, last: max(visits.opdDate) })
      .from(visits)
      .where(and(inArray(visits.patientId, chunk), ne(visits.status, "cancelled")))
      .groupBy(visits.patientId)
      .all();
    for (const row of rows) if (row.last) result.set(row.patientId, row.last);
  }
  return result;
}

/** The patient's active (`open` or `in_queue`) Visit on `opdDate`, if any. */
export function activeVisitOn(patientId: string, opdDate: string, db: Db | Tx = getDb()): VisitSummary | undefined {
  return db
    .select(SUMMARY)
    .from(visits)
    .where(
      and(
        eq(visits.patientId, patientId),
        eq(visits.opdDate, opdDate),
        inArray(visits.status, [...ACTIVE_VISIT_STATUSES]),
      ),
    )
    .get();
}
