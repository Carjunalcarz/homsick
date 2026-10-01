import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { UrgencyTone } from "@/lib/triage";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { triageRecords, type TriageRecordRow } from "./schema";

/*
 * Triage reads. Other modules get only the snapshot summary: no Vital Signs
 * or complaint leave this module through these.
 */

export type TriageSummary = {
  visitId: string;
  urgencyName: string;
  urgencyRank: number | null;
  urgencyIsEr: boolean;
  urgencyTone: UrgencyTone;
  sortGroup: number | null;
  priorityCategory: string | null;
};

/** The Urgency and Priority snapshot per Visit id; Visits without a Triage Record are left out. */
export function triageSummaries(visitIds: readonly string[], db: Db | Tx = getDb()): Map<string, TriageSummary> {
  const result = new Map<string, TriageSummary>();
  const ids = [...new Set(visitIds)];
  for (let start = 0; start < ids.length; start += 500) {
    const rows = db
      .select({
        visitId: triageRecords.visitId,
        urgencyName: triageRecords.urgencyName,
        urgencyRank: triageRecords.urgencyRank,
        urgencyIsEr: triageRecords.urgencyIsEr,
        urgencyTone: triageRecords.urgencyTone,
        sortGroup: triageRecords.sortGroup,
        priorityCategory: triageRecords.priorityCategory,
      })
      .from(triageRecords)
      .where(inArray(triageRecords.visitId, ids.slice(start, start + 500)))
      .all();
    for (const row of rows) result.set(row.visitId, row);
  }
  return result;
}

/** The whole Triage Record of a Visit (tests and later stories), or undefined. */
export function triageRecordForVisit(visitId: string, db: Db | Tx = getDb()): TriageRecordRow | undefined {
  return db.select().from(triageRecords).where(eq(triageRecords.visitId, visitId)).get();
}
