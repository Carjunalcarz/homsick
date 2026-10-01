import "server-only";
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { AHEAD_QUEUE_STATUSES, LIVE_QUEUE_STATUSES } from "@/lib/queue-number";
import type { Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { queueCounters, queueEntries, type NewQueueEntryRow, type QueueEntryRow } from "./schema";

/* Reads and writes of the `queue` tables. Writes run inside the caller's command transaction. */

export const QueueError = {
  FacilityUnavailable: "facility_unavailable",
} as const;

/**
 * The shared live-queue predicate (AD-5): the OPD day's entries still in the
 * queue (waiting, called or serving), system-issued only (no paper entries).
 */
function livePredicate(opdDate: string, facilityId?: string): SQL {
  const conditions = [
    eq(queueEntries.opdDate, opdDate),
    inArray(queueEntries.status, [...LIVE_QUEUE_STATUSES]),
    eq(queueEntries.isPaper, false),
  ];
  if (facilityId !== undefined) conditions.push(eq(queueEntries.facilityId, facilityId));
  return and(...conditions)!;
}

/**
 * The one function that reads a queue in order (AD-5, FR-9): the live entries
 * of `facilityId` on `opdDate`, by `sort_group, urgency_rank, entered_at, id`.
 * "N ahead", the Facility screens (Epic 4) and the Display Board (Epic 5) all
 * come from this order.
 */
export function liveQueue(db: Db | Tx, facilityId: string, opdDate: string): QueueEntryRow[] {
  return db
    .select()
    .from(queueEntries)
    .where(livePredicate(opdDate, facilityId))
    .orderBy(asc(queueEntries.sortGroup), asc(queueEntries.urgencyRank), asc(queueEntries.enteredAt), asc(queueEntries.id))
    .all();
}

/** Per Facility, the live entries not yet being served (waiting or called) on `opdDate`. */
export function selectWaitingCounts(db: Db | Tx, opdDate: string): { facilityId: string; n: number }[] {
  return db
    .select({ facilityId: queueEntries.facilityId, n: count() })
    .from(queueEntries)
    .where(and(livePredicate(opdDate), inArray(queueEntries.status, [...AHEAD_QUEUE_STATUSES])))
    .groupBy(queueEntries.facilityId)
    .all();
}

/**
 * Take the next sequence for a Facility's OPD day: the counter row is inserted
 * (1) or incremented in `tx`, so numbers are consecutive and a rolled-back
 * command gives its number back. A new OPD day starts again at 1.
 */
export function nextSeq(tx: Tx, facilityId: string, opdDate: string): number {
  const row = tx
    .insert(queueCounters)
    .values({ facilityId, opdDate, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [queueCounters.facilityId, queueCounters.opdDate],
      set: { lastSeq: sql`${queueCounters.lastSeq} + 1` },
    })
    .returning({ lastSeq: queueCounters.lastSeq })
    .get();
  return row.lastSeq;
}

export function selectQueueEntry(db: Db | Tx, id: string): QueueEntryRow | undefined {
  return db.select().from(queueEntries).where(eq(queueEntries.id, id)).get();
}

export function insertQueueEntry(tx: Tx, values: NewQueueEntryRow): void {
  tx.insert(queueEntries).values(values).run();
}
