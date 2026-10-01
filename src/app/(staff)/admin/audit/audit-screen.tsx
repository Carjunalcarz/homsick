"use client";

import { DataTableEmptyState } from "@/components/data-table/empty-state";
import { DataTablePagination } from "@/components/data-table/pagination";
import { DataTableToolbar } from "@/components/data-table/toolbar";
import { PageTitle } from "@/components/page-title";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChangesView } from "./audit-format";

const BASE_PATH = "/admin/audit";
const DEFAULTS = { q: "", action: "all", entity: "all", from: "", to: "" };

/** One audit row, formatted on the server. */
export type AuditRowData = {
  id: string;
  /** Manila time with seconds, for display. */
  time: string;
  /** UTC ISO text, for `<time dateTime>`. */
  at: string;
  /** The staff name, or "System". */
  actor: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  changes: ChangesView;
};

type Option = { value: string; label: string };

/** Admin: the read-only audit log list. There are no edit, delete or export controls. */
export function AuditScreen({
  rows,
  total,
  page,
  pageCount,
  q,
  action,
  entity,
  from,
  to,
  actionOptions,
  entityOptions,
}: {
  rows: AuditRowData[];
  total: number;
  page: number;
  pageCount: number;
  q: string;
  action: string;
  entity: string;
  from: string;
  to: string;
  actionOptions: Option[];
  entityOptions: Option[];
}) {
  const filtered = q !== "" || action !== "all" || entity !== "all" || from !== "" || to !== "";
  const values = { q, action, entity, from, to };

  return (
    <>
      <PageTitle
        title="Audit log"
        description="Every sign-in, staff change and settings change, newest first, in Manila time. Entries can't be edited or deleted, and each view of this page is recorded."
      />

      <section
        aria-labelledby="audit-list-heading"
        className="flex min-w-0 flex-col gap-4 rounded-md bg-card p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] md:p-6 dark:ring-white/[0.06]"
      >
        <h2 id="audit-list-heading" className="sr-only">
          Audit entries
        </h2>
        <DataTableToolbar
          basePath={BASE_PATH}
          id="audit"
          label="Filter audit log"
          searchLabel="Search"
          searchPlaceholder="Staff name or record ID"
          q={q}
          filters={[
            { name: "action", label: "Action", defaultValue: "all", value: action, options: actionOptions },
            { name: "entity", label: "Entity", defaultValue: "all", value: entity, options: entityOptions },
          ]}
          dateFilters={[
            { name: "from", label: "From (Manila date)", value: from },
            { name: "to", label: "To (Manila date)", value: to },
          ]}
        />

        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
          {total === 1 ? "1 audit entry" : `${total} audit entries`}
          {filtered ? (total === 1 ? " matches" : " match") : ""}
        </p>

        {rows.length === 0 ? (
          <DataTableEmptyState
            title="No audit entries match these filters."
            hint="Try another name, record ID or date range, or clear the filters."
            clearHref={filtered ? BASE_PATH : undefined}
          />
        ) : (
          // The table scrolls in this one region on narrow screens (keyboard: focus it, then arrow keys).
          <div
            role="region"
            aria-label="Audit entries table"
            tabIndex={0}
            data-slot="table-container"
            className="relative min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table data-slot="table" className="w-full min-w-[960px] caption-bottom text-sm">
              <caption className="sr-only">
                Audit entries, newest first. Page {page} of {pageCount}.
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Time (Manila)</TableHead>
                  <TableHead scope="col">Actor</TableHead>
                  <TableHead scope="col">Action</TableHead>
                  <TableHead scope="col">Entity</TableHead>
                  <TableHead scope="col">Record ID</TableHead>
                  <TableHead scope="col">Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top whitespace-nowrap tabular-nums">
                      <time dateTime={row.at}>{row.time}</time>
                    </TableCell>
                    <TableCell className="align-top font-medium">{row.actor}</TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col">
                        <span>{row.actionLabel}</span>
                        <span className="font-mono text-xs text-muted-foreground">{row.action}</span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col">
                        <span>{row.entityLabel}</span>
                        <span className="font-mono text-xs text-muted-foreground">{row.entity}</span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top max-w-48 font-mono text-xs break-all whitespace-normal">
                      {row.entityId ?? <EmptyValue />}
                    </TableCell>
                    <TableCell className="align-top max-w-md min-w-64 whitespace-normal">
                      <Changes changes={row.changes} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}

        <DataTablePagination basePath={BASE_PATH} values={values} defaults={DEFAULTS} page={page} pageCount={pageCount} />
      </section>
    </>
  );
}

function EmptyValue() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">None</span>
    </span>
  );
}

function Changes({ changes }: { changes: ChangesView }) {
  switch (changes.kind) {
    case "none":
      return <EmptyValue />;
    case "raw":
      return <span className="font-mono text-xs break-all">{changes.text}</span>;
    case "fields":
      return (
        <ul className="flex flex-col gap-1">
          {changes.lines.map((line) => (
            <li key={line.field} className="break-words [overflow-wrap:anywhere]">
              <span className="font-mono text-xs font-semibold">{line.field}:</span>{" "}
              {line.kind === "diff" ? (
                <>
                  <span>{line.old}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> changed to </span>
                  <span>{line.new}</span>
                </>
              ) : (
                <span>{line.value}</span>
              )}
            </li>
          ))}
        </ul>
      );
  }
}
