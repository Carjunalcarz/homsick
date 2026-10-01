import "server-only";
import type { VisitStatus } from "@/lib/visit-status";

export { VISIT_STATUSES, type VisitStatus } from "@/lib/visit-status";

/**
 * The Visit state machine (AD-13): the one table of allowed transitions.
 * `completed`, `directed_to_er`, `no_show` and `cancelled` are terminal.
 */
export const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  open: ["in_queue", "directed_to_er", "cancelled"],
  in_queue: ["completed", "no_show", "cancelled"],
  completed: [],
  directed_to_er: [],
  no_show: [],
  cancelled: [],
};

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: VisitStatus): boolean {
  return VISIT_TRANSITIONS[status].length === 0;
}
