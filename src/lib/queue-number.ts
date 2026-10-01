// Queue Numbers and Queue Entry statuses (Story 3.5, FR-8, AD-5). Safe to
// import in client code; the tables live in `src/server/queue/`.

/** Queue Entry statuses, lowercase as stored (CHECK in `queue_entries`). */
export const QUEUE_STATUSES = ["waiting", "called", "serving", "completed", "referred", "no_show", "cancelled"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** The statuses of an entry still in a live queue (the `liveQueue` predicate). */
export const LIVE_QUEUE_STATUSES = ["waiting", "called", "serving"] as const satisfies readonly QueueStatus[];

/** The statuses counted as "ahead" of an entry (and as "waiting" on a Facility tile): not yet being served. */
export const AHEAD_QUEUE_STATUSES = ["waiting", "called"] as const satisfies readonly QueueStatus[];

/**
 * The one Queue Number label maker: `{prefix}-{seq}` with the sequence padded
 * to 3 digits, e.g. `CN-014`; longer sequences keep every digit (`CN-1000`).
 * Always called with the stored `prefix` and `seq` columns.
 */
export function formatQueueNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

/** The line under the number on a queue slip (Story 3.6). */
export const SLIP_WAIT_LINE = "Please wait for your number on the screen.";

/** Marks the slip page's content, so the triage banner's hidden iframe can tell it loaded the slip and not an error page. */
export const SLIP_MARKER_ATTRIBUTE = "data-queue-slip";

/** The printable slip page for a Queue Entry. */
export function slipPath(entryId: string): string {
  return `/print/slip/${encodeURIComponent(entryId)}`;
}

/** "Next in line" for nobody ahead, otherwise "{N} ahead". */
export function formatAhead(ahead: number): string {
  return ahead === 0 ? "Next in line" : `${ahead} ahead`;
}
