import "server-only";
import { closedReason } from "@/lib/facility-format";
import { AHEAD_QUEUE_STATUSES, type QueueStatus } from "@/lib/queue-number";
import { opdDate } from "@/lib/time";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { getFacility, isOpen, listFacilities, nextOpening, type Facility } from "@/server/settings/queries";
import { liveQueue, selectQueueEntry, selectWaitingCounts } from "./repo";
import type { QueueEntryRow } from "./schema";

/*
 * Queue reads (Story 3.5). Other modules read the queue tables only through
 * these. The order always comes from `liveQueue()` in repo.ts.
 */

export { liveQueue } from "./repo";
export type { QueueEntryRow } from "./schema";

type Instant = Date | string | number;

/**
 * The entries ahead of `entry` in its live queue: the waiting and called ones
 * before it in `liveQueue()` order. Empty when `entry` has left the queue.
 */
export function aheadOf(
  entry: Pick<QueueEntryRow, "id" | "facilityId" | "opdDate">,
  db: Db | Tx = getDb(),
): QueueEntryRow[] {
  const queue = liveQueue(db, entry.facilityId, entry.opdDate);
  const index = queue.findIndex((e) => e.id === entry.id);
  if (index < 0) return [];
  return queue
    .slice(0, index)
    .filter((e) => (AHEAD_QUEUE_STATUSES as readonly QueueStatus[]).includes(e.status));
}

/** Per Facility id, how many live entries are waiting (not yet being served) on `opdDate`. Facilities with none are left out. */
export function waitingCounts(opdDate: string, db: Db | Tx = getDb()): Map<string, number> {
  return new Map(selectWaitingCounts(db, opdDate).map((row) => [row.facilityId, row.n]));
}

/**
 * What a queue slip prints (Story 3.6): the Facility name, the stored prefix
 * and sequence (label them with `formatQueueNumber`) and when the entry was
 * issued. Deliberately nothing about the patient or triage.
 */
export type QueueSlip = { facilityName: string; prefix: string; seq: number; enteredAt: string };

/** The slip for a Queue Entry, or null when there is no such entry. Paper entries have no slip. */
export function getSlip(entryId: string, db: Db | Tx = getDb()): QueueSlip | null {
  const entry = selectQueueEntry(db, entryId);
  if (!entry || entry.isPaper) return null;
  const facility = getFacility(entry.facilityId, entry.enteredAt, db);
  if (!facility) return null;
  return { facilityName: facility.name, prefix: entry.prefix, seq: entry.seq, enteredAt: entry.enteredAt };
}

/**
 * Whether a Facility takes patients at `instant`: `open` (active, live, open
 * now: a Queue Number), `paper` (active and open now but not live yet: the
 * nurse gives a paper number, PRD §10 pilot), or unavailable with the tile's
 * reason (`inactive`, or `closed` outside its hours, Manila time).
 */
export type FacilityAvailability =
  | { status: "open" | "paper" }
  | { status: "inactive" | "closed"; reason: string };

export function facilityAvailability(facility: Facility, instant: Instant): FacilityAvailability {
  if (facility.deactivatedAt !== null) return { status: "inactive", reason: "Deactivated" };
  if (!isOpen(facility, instant)) {
    return { status: "closed", reason: closedReason(nextOpening(facility, instant), opdDate(instant)) };
  }
  return { status: facility.isLive ? "open" : "paper" };
}

/** A Facility tile on the triage form. */
export type FacilityTile = {
  id: string;
  name: string;
  /** Active and open now: the nurse can pick it (for a Queue Number, or a paper number when `paper`). */
  available: boolean;
  /** Open but not live yet: choosing it records triage for a paper number, with no Queue Entry. */
  paper: boolean;
  /** Waiting (and called) entries on the OPD day. */
  waiting: number;
  /** Why the tile is disabled, or null when available. */
  reason: string | null;
};

/** The triage form's Facility tiles: the active Facilities in display order, with availability and waiting counts (the form refetches them on window focus and after `facility_unavailable`). */
export function facilityTiles(instant: Instant = new Date(), db: Db | Tx = getDb()): FacilityTile[] {
  const counts = waitingCounts(opdDate(instant), db);
  return listFacilities(instant, db)
    .filter((f) => f.deactivatedAt === null)
    .map((facility) => {
      const availability = facilityAvailability(facility, instant);
      const available = availability.status === "open" || availability.status === "paper";
      return {
        id: facility.id,
        name: facility.name,
        available,
        paper: availability.status === "paper",
        waiting: counts.get(facility.id) ?? 0,
        reason: "reason" in availability ? availability.reason : null,
      };
    });
}
