import "server-only";
import type { Tx } from "@/server/db/tx";
import { auditLog, type ActorType, type AuditAction, type AuditEntity } from "./schema";

export { AuditAction } from "./schema";

/** Who did it: a staff member, or the system (CLI, scheduled jobs). */
export type Actor =
  | { type: "staff"; id: string | null; name: string | null }
  | { type: "system"; id?: null; name: string };

export type AuditEntry = {
  actor: Actor;
  action: AuditAction;
  /** One of `AUDIT_ENTITIES`, so the audit log page can filter and label it. */
  entity: AuditEntity;
  entityId?: string | null;
  /** Changed fields, e.g. `{ role: { old: "x", new: "y" } }`. Never secrets. */
  changes?: Record<string, unknown> | null;
  at?: Date;
};

/** Append one row to the audit log inside the caller's transaction. */
export function record(tx: Tx, entry: AuditEntry): string {
  const id = crypto.randomUUID();
  const actorType: ActorType = entry.actor.type;
  tx.insert(auditLog)
    .values({
      id,
      at: (entry.at ?? new Date()).toISOString(),
      actorType,
      actorId: entry.actor.id ?? null,
      actorName: entry.actor.name ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
    })
    .run();
  return id;
}
