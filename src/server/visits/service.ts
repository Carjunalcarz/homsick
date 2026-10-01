import "server-only";
import { opdDate } from "@/lib/time";
import type { Actor } from "@/server/audit/service";
import { DomainError } from "@/server/db/errors";
import type { Tx } from "@/server/db/tx";
import { activeVisitOn, type VisitSummary } from "./queries";
import { insertVisit, selectVisit, updateVisitStatus, VisitError } from "./repo";
import { canTransition, isTerminal, type VisitStatus } from "./state";

/*
 * Visit commands (AD-13). These run inside the caller's command transaction
 * (`tx`) and write no audit row of their own: the calling command audits.
 * Only this module changes a Visit's status. It never imports `patients`.
 */

export { VisitError } from "./repo";

/**
 * Open a Visit for today's Manila OPD day, status `open`. Throws
 * `visit_already_open` when the patient already has an `open` or
 * `in_queue` Visit that day.
 */
export function open(tx: Tx, input: { patientId: string; actor: Actor; now?: Date }): VisitSummary {
  const now = input.now ?? new Date();
  const day = opdDate(now);
  if (activeVisitOn(input.patientId, day, tx)) {
    throw new DomainError(VisitError.AlreadyOpen, "This patient already has an open Visit today.");
  }
  const at = now.toISOString();
  const visit: VisitSummary = {
    id: crypto.randomUUID(),
    patientId: input.patientId,
    opdDate: day,
    status: "open",
    openedAt: at,
    closedAt: null,
  };
  insertVisit(tx, {
    ...visit,
    createdBy: input.actor.id ?? input.actor.name ?? "unknown",
    updatedAt: at,
  });
  return visit;
}

/**
 * Move a Visit to `to`, if the transition table allows it (else
 * `invalid_transition`). A terminal status sets `closed_at`.
 */
export function transition(tx: Tx, id: string, to: VisitStatus, now: Date = new Date()): VisitSummary {
  const current = selectVisit(tx, id);
  if (!current) throw new DomainError(VisitError.NotFound, "This Visit no longer exists.");
  if (!canTransition(current.status, to)) {
    throw new DomainError(VisitError.InvalidTransition, `A Visit can't go from ${current.status} to ${to}.`);
  }
  const at = now.toISOString();
  const closedAt = isTerminal(to) ? at : null;
  updateVisitStatus(tx, id, { status: to, updatedAt: at, closedAt });
  return {
    id: current.id,
    patientId: current.patientId,
    opdDate: current.opdDate,
    status: to,
    openedAt: current.openedAt,
    closedAt,
  };
}
