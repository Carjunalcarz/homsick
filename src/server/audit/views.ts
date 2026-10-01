import "server-only";
import type { Db } from "@/server/db/client";
import { withCommandTx } from "@/server/db/tx";
import { AuditAction } from "./schema";
import type { Actor } from "./service";

/** The filters and page an Admin viewed the audit log with. */
export type AuditViewFilters = {
  q: string;
  action: string;
  entity: string;
  from: string;
  to: string;
  /** The page asked for in the URL; the list may clamp it. */
  requestedPage: number;
};

/**
 * Viewing the audit log is itself audited (PRIV-6): one `audit.viewed` row
 * on entity `audit_log`, with the filters and requested page in `changes`.
 * It is a read, but it goes through `withCommandTx` like every command.
 */
export function recordAuditView(actor: Actor, filters: AuditViewFilters, db?: Db): void {
  withCommandTx(
    actor,
    AuditAction.AuditViewed,
    (_tx, audit) => {
      audit({
        entity: "audit_log",
        entityId: null,
        changes: {
          q: filters.q || null,
          action: filters.action,
          entity: filters.entity,
          from: filters.from || null,
          to: filters.to || null,
          requestedPage: filters.requestedPage,
        },
      });
    },
    db,
  );
}
