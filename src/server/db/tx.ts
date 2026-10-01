import "server-only";
import { record, type Actor, type AuditEntry } from "@/server/audit/service";
import type { AuditAction } from "@/server/audit/schema";
import { getDb, type Db } from "./client";

/** A command's transaction handle, passed down to repos and `audit.record`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** What a command tells the audit log about itself; actor and action are fixed. */
export type CommandAudit = Omit<AuditEntry, "actor" | "action">;

/**
 * Records the command's single audit row. Calling it twice, or never, fails
 * the command and rolls everything back.
 */
export type AuditFn = (entry: CommandAudit) => void;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Run one command (AD-3): an IMMEDIATE transaction around a synchronous `fn`
 * that writes exactly one audit row through `audit`. Any throw rolls back
 * every write, the audit row included. `fn` must not be async, because
 * better-sqlite3 transactions are synchronous.
 */
export function withCommandTx<T>(
  actor: Actor,
  action: AuditAction,
  fn: (tx: Tx, audit: AuditFn) => T,
  db: Db = getDb(),
): T {
  if (fn.constructor.name === "AsyncFunction") {
    throw new TypeError("withCommandTx: fn must be synchronous (no async/await)");
  }
  return db.transaction(
    (tx) => {
      let audited = false;
      const audit: AuditFn = (entry) => {
        if (audited) throw new Error(`withCommandTx(${action}): only one audit row per command`);
        audited = true;
        record(tx, { ...entry, actor, action });
      };
      const result = fn(tx, audit);
      if (isThenable(result)) {
        throw new TypeError("withCommandTx: fn returned a promise; it must be synchronous");
      }
      if (!audited) throw new Error(`withCommandTx(${action}): the command wrote no audit row`);
      return result;
    },
    { behavior: "immediate" },
  );
}
