import "server-only";
import { formatQueueNumber } from "@/lib/queue-number";
import { opdDate } from "@/lib/time";
import { TRIAGE_MESSAGES } from "@/lib/triage";
import type { Actor } from "@/server/audit/service";
import { DomainError } from "@/server/db/errors";
import type { Tx } from "@/server/db/tx";
import { effectivePrefix, getFacility, type Facility } from "@/server/settings/queries";
import { aheadOf, facilityAvailability } from "./queries";
import { insertQueueEntry, nextSeq, QueueError } from "./repo";

/*
 * Queue commands (Story 3.5, FR-8, AD-5). They run inside the caller's
 * command transaction (`tx`) and write no audit row of their own: the
 * calling command (`recordTriage`) audits.
 */

export { QueueError } from "./repo";

/** The priority snapshot a Queue Entry copies from its Triage Record (AD-6). Non-ER levels only. */
export type QueueSnapshot = {
  urgencyLevelId: string;
  urgencyRank: number;
  sortGroup: 1 | 2 | 3;
  priorityCategory: string | null;
};

export type IssuedEntry = {
  entryId: string;
  facilityId: string;
  facilityName: string;
  opdDate: string;
  prefix: string;
  seq: number;
  /** `formatQueueNumber(prefix, seq)`. */
  queueNumber: string;
  /** Waiting and called entries before it in `liveQueue()` order, right after issuing. */
  ahead: number;
};

/** "{Facility} isn't taking patients now." */
export function unavailableMessage(name: string): string {
  return `${name} isn't taking patients now.`;
}

/**
 * How the Facility takes patients at `now`: `queue` (active, live, open: a
 * Queue Number) or `paper` (active and open but not live yet: a paper
 * number). Throws `facility_unavailable` for an unknown Facility ("That
 * Facility isn't available. Choose another.") or a closed or deactivated one
 * ("{Facility} isn't taking patients now.").
 */
export function facilityFor(tx: Tx, facilityId: string, now: Date): { facility: Facility; mode: "queue" | "paper" } {
  const facility = getFacility(facilityId, now, tx);
  if (!facility) throw new DomainError(QueueError.FacilityUnavailable, TRIAGE_MESSAGES.facilityUnknown);
  const { status } = facilityAvailability(facility, now);
  if (status === "open") return { facility, mode: "queue" };
  if (status === "paper") return { facility, mode: "paper" };
  throw new DomainError(QueueError.FacilityUnavailable, unavailableMessage(facility.name));
}

/** The Facility, if it issues Queue Numbers at `now` (active, live, open); otherwise `facility_unavailable`. */
export function requireAvailableFacility(tx: Tx, facilityId: string, now: Date): Facility {
  const { facility, mode } = facilityFor(tx, facilityId, now);
  if (mode !== "queue") throw new DomainError(QueueError.FacilityUnavailable, unavailableMessage(facility.name));
  return facility;
}

/**
 * Issue the Facility's next Queue Number for a Visit: take the next `seq`
 * from `queue_counters` (inserted or incremented in `tx`), store the entry
 * `waiting` with `prefix = effectivePrefix(facility, now)`, the snapshot and
 * `entered_at = now`. Refuses a closed, not-live or deactivated Facility with
 * `facility_unavailable`. The caller moves the Visit to `in_queue`.
 */
export function issue(
  tx: Tx,
  input: { visitId: string; facilityId: string; snapshot: QueueSnapshot; actor: Actor; now: Date },
): IssuedEntry {
  const { now, snapshot } = input;
  const facility = requireAvailableFacility(tx, input.facilityId, now);
  const day = opdDate(now);
  const seq = nextSeq(tx, facility.id, day);
  const prefix = effectivePrefix(facility, now);
  const at = now.toISOString();
  const id = crypto.randomUUID();
  insertQueueEntry(tx, {
    id,
    visitId: input.visitId,
    facilityId: facility.id,
    opdDate: day,
    prefix,
    seq,
    status: "waiting",
    sortGroup: snapshot.sortGroup,
    urgencyRank: snapshot.urgencyRank,
    urgencyLevelId: snapshot.urgencyLevelId,
    priorityCategory: snapshot.priorityCategory,
    enteredAt: at,
    callCount: 0,
    isPaper: false,
    createdBy: input.actor.id ?? input.actor.name ?? "unknown",
    updatedAt: at,
  });
  return {
    entryId: id,
    facilityId: facility.id,
    facilityName: facility.name,
    opdDate: day,
    prefix,
    seq,
    queueNumber: formatQueueNumber(prefix, seq),
    ahead: aheadOf({ id, facilityId: facility.id, opdDate: day }, tx).length,
  };
}
