// Visit statuses (AD-13) and their labels. Safe to import in client code;
// the transition table lives in `src/server/visits/state.ts`.

export const VISIT_STATUSES = ["open", "in_queue", "completed", "directed_to_er", "no_show", "cancelled"] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  open: "Open",
  in_queue: "In queue",
  completed: "Completed",
  directed_to_er: "Directed to ER",
  no_show: "No-show",
  cancelled: "Cancelled",
};

/** The statuses that make a Visit "active": one per patient per OPD day. */
export const ACTIVE_VISIT_STATUSES: readonly VisitStatus[] = ["open", "in_queue"];

export function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === "string" && (VISIT_STATUSES as readonly string[]).includes(value);
}
