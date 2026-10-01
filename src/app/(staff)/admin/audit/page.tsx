import type { Metadata } from "next";
import { Forbidden, FORBIDDEN_TITLE } from "@/components/forbidden";
import { formatManila } from "@/lib/time";
import { parseDateRange, parseListParams, type SearchParams } from "@/lib/url-query";
import { listAudit } from "@/server/audit/queries";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  type AuditAction,
  type AuditEntity,
} from "@/server/audit/schema";
import { recordAuditView } from "@/server/audit/views";
import { requirePermission } from "@/server/auth/permissions";
import { describeChanges } from "./audit-format";
import { AuditScreen, type AuditRowData } from "./audit-screen";

/** Rows per page on the audit log. */
const PAGE_SIZE = 25;

/** The audit log's URL filters (`q` and `page` are always there; `from`/`to` are read apart). */
const AUDIT_LIST = {
  filters: {
    action: { values: ["all", ...AUDIT_ACTIONS], default: "all" },
    entity: { values: ["all", ...AUDIT_ENTITIES], default: "all" },
  },
} as const;

/** Time with seconds, in Manila. */
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("audit.view");
  return { title: allowed ? "Audit log" : FORBIDDEN_TITLE };
}

/** Admin: the read-only audit log (FR-26, PRIV-2, PRIV-6). Each view is itself audited. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { allowed, user } = await requirePermission("audit.view");
  // Decide before reading anything: a denied user gets no rows and no view row.
  if (!allowed) return <Forbidden />;

  const raw = await searchParams;
  const params = parseListParams(raw, AUDIT_LIST);
  const { from, to } = parseDateRange(raw.from, raw.to);

  // Recorded first, so this view is in the list it shows.
  recordAuditView(
    { type: "staff", id: user.id, name: user.name },
    { q: params.q, action: params.action, entity: params.entity, from, to, requestedPage: params.page },
  );

  const list = listAudit({
    q: params.q,
    action: params.action as AuditAction | "all",
    entity: params.entity as AuditEntity | "all",
    from,
    to,
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  const rows: AuditRowData[] = list.rows.map((row) => ({
    id: row.id,
    time: formatManila(row.at, TIME_FORMAT),
    at: row.at,
    actor: row.actorType === "system" ? "System" : (row.actorName ?? "Unknown"),
    action: row.action,
    actionLabel: AUDIT_ACTION_LABELS[row.action as AuditAction] ?? row.action,
    entity: row.entity,
    entityLabel: AUDIT_ENTITY_LABELS[row.entity as AuditEntity] ?? row.entity,
    entityId: row.entityId,
    changes: describeChanges(row.changes),
  }));

  return (
    <AuditScreen
      rows={rows}
      total={list.total}
      page={list.page}
      pageCount={list.pageCount}
      q={params.q}
      action={params.action}
      entity={params.entity}
      from={from}
      to={to}
      actionOptions={[
        { value: "all", label: "All actions" },
        ...AUDIT_ACTIONS.map((value) => ({ value, label: AUDIT_ACTION_LABELS[value] })),
      ]}
      entityOptions={[
        { value: "all", label: "All entities" },
        ...AUDIT_ENTITIES.map((value) => ({ value, label: AUDIT_ENTITY_LABELS[value] })),
      ]}
    />
  );
}
