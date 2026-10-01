import "server-only";
import { and, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { addOpdDays, manilaDayStart } from "@/lib/time";
import { parseDateRange } from "@/lib/url-query";
import { auditLog, type ActorType, type AuditAction, type AuditEntity } from "./schema";

/*
 * Audit log reads (Story 2.7). `audit` owns `audit_log`; this is read-only.
 */

export type ListAuditInput = {
  /** Matches the actor's name (Unicode case-insensitive) or part of the record ID. */
  q?: string;
  action?: AuditAction | "all";
  entity?: AuditEntity | "all";
  /** Manila date (`YYYY-MM-DD`), inclusive. Invalid dates are ignored; a reversed range is swapped. */
  from?: string;
  /** Manila date (`YYYY-MM-DD`), inclusive. */
  to?: string;
  page?: number;
  pageSize?: number;
};

export type AuditEntryRow = {
  id: string;
  /** UTC ISO text. */
  at: string;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  /**
   * The changed fields, parsed. A stored value that isn't a JSON object is
   * kept as its raw text; `null` when the row has no changes.
   */
  changes: Record<string, unknown> | string | null;
};

export type AuditPage = {
  rows: AuditEntryRow[];
  total: number;
  /** The page shown, clamped to 1..pageCount. */
  page: number;
  pageCount: number;
  pageSize: number;
};

/** Parses a stored `changes` value; anything that isn't a JSON object stays raw text. */
export function parseChanges(raw: string | null): Record<string, unknown> | string | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Not JSON: shown as stored.
  }
  return raw;
}

/**
 * The audit log, newest first (`at` desc, then `id` desc), filtered by
 * search, action, entity and a Manila date range, one page at a time.
 */
export function listAudit(input: ListAuditInput = {}, db: Db | Tx = getDb()): AuditPage {
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? 25));
  const conditions: SQL[] = [];

  const q = (input.q ?? "").trim().toLowerCase();
  if (q) {
    // unicode_lower (registered in db/client.ts): SQLite's lower() is ASCII-only.
    conditions.push(
      sql`(instr(unicode_lower(coalesce(${auditLog.actorName}, '')), ${q}) > 0 or instr(unicode_lower(coalesce(${auditLog.entityId}, '')), ${q}) > 0)`,
    );
  }
  if (input.action && input.action !== "all") conditions.push(eq(auditLog.action, input.action));
  if (input.entity && input.entity !== "all") conditions.push(eq(auditLog.entity, input.entity));

  const range = parseDateRange(input.from, input.to);
  // `at` is stored as toISOString() text, so text comparison orders instants.
  if (range.from) conditions.push(gte(auditLog.at, manilaDayStart(range.from)));
  if (range.to) conditions.push(lt(auditLog.at, manilaDayStart(addOpdDays(range.to, 1))));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isFinite(input.page) ? Math.floor(input.page!) : 1;
  const page = Math.min(Math.max(1, requested), pageCount);

  const rows = db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return {
    rows: rows.map((row) => ({
      id: row.id,
      at: row.at,
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: row.actorName,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      changes: parseChanges(row.changes),
    })),
    total,
    page,
    pageCount,
    pageSize,
  };
}
