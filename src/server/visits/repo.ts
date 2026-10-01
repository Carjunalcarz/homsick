import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db/tx";
import { visits, type NewVisitRow, type VisitRow } from "./schema";

/* Writes to `visits`, always inside the caller's transaction. */

export const VisitError = {
  AlreadyOpen: "visit_already_open",
  InvalidTransition: "invalid_transition",
  NotFound: "not_found",
} as const;

export function insertVisit(tx: Tx, values: NewVisitRow): void {
  tx.insert(visits).values(values).run();
}

export function selectVisit(tx: Tx, id: string): VisitRow | undefined {
  return tx.select().from(visits).where(eq(visits.id, id)).get();
}

export function updateVisitStatus(
  tx: Tx,
  id: string,
  values: Pick<VisitRow, "status" | "updatedAt"> & { closedAt?: string | null },
): void {
  tx.update(visits).set(values).where(eq(visits.id, id)).run();
}
