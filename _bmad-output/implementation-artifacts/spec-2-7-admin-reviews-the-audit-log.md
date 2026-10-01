---
title: 'Story 2.7: Admin reviews the audit log'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-7-admin-reviews-the-audit-log'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-admin-manages-staff-accounts-and-roles.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every sign-in, staff change and settings change is written to `audit_log`, but nobody can read it without a SQL shell. The hospital must be able to answer "who saw or changed what, and when" quickly, including for a breach report within 72 hours (PRIV-2, PRIV-6, FR-26).

**Approach:** Add an Admin-only `/admin/audit` page built on the story 1.4 list pattern. It filters by search (staff name or record ID), action, entity and a Manila date range, lists rows newest first, and shows the changed fields. Each view of the page writes its own audit row. There are no edit or delete controls anywhere. This follows epics.md Story 2.7.

## Boundaries & Constraints

**Always:**
- **Page:**
  - Read-only. Permission `audit.view` for Admin only; a denied user gets `<Forbidden />` and no rows are read.
  - Titled "Audit log | OPD", linked from the header Admin links as "Admin: Audit log". That link has `prefetch={false}`, so a prefetch never renders the page or logs a view.
- **Filters** (in the URL, parsed with `parseListParams`; bad values fall back to defaults):
  - `q`: matches the actor name (Unicode case-insensitive, via `unicode_lower`) or part of the record ID (`entity_id`).
  - `action`: all, or one `AuditAction` value.
  - `entity`: all, or one known entity (`user`, `facility`, `urgency_levels`, `priority_category`, `clinical_schedule`, `opd_settings`, `audit_log`).
  - `from` / `to`: Manila dates (`YYYY-MM-DD`), both inclusive and each optional. They are converted to UTC bounds on `at`. A reversed range is swapped. An invalid date is ignored.
- **List:** newest first (`at` desc, then `id` desc), 25 per page, with a total count.
- **Columns:**
  - Time: `formatManila`, with seconds.
  - Actor: the staff name, or "System".
  - Action: a readable label, with the raw value in mono.
  - Entity and record ID (mono).
  - Changes: each field as `field: old → new`; a single value shows as-is. Long values wrap and the table scrolls in its own region. `null` changes show "—".
- **View audit:** each render of the page, for an allowed user, writes one `audit.viewed` row: entity `audit_log`, with `changes` holding the filters and page used. It goes through `withCommandTx`.
- **Accessibility:** table caption, `scope` on the headers, 44 px controls; the date inputs have labels.

**Never:**
- No edit, delete or export.
- No new write path to `audit_log` besides `audit.viewed`.
- No Patient data (none exists yet).
- No change to how other commands audit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default view | no params | newest 25 rows, the `audit.viewed` row of this view included | N/A |
| Staff filter | `q=joy` with rows by "Joy Santos" and others | only Joy's rows; the count matches | N/A |
| Record ID | `q=<part of a user id>` | rows whose `entity_id` contains it | N/A |
| Date range | `from=2026-09-27&to=2026-09-27` | rows from 2026-09-26T16:00Z (inclusive) up to 2026-09-27T16:00Z (exclusive) | N/A |
| Reversed range | `from=2026-09-28&to=2026-09-26` | treated as 26th–28th | N/A |
| Bad params | `action=nope&from=yesterday&page=abc` | defaults: all actions, no from, page 1 | N/A |
| Non-Admin | Triage Nurse opens the page | no-access page; no rows read; no `audit.viewed` row | N/A |

</frozen-after-approval>

## Code Map

- `src/server/audit/schema.ts`: `auditLog` (indexed on `at`, actor, entity+entity_id) and `AuditAction`. Add `AuditViewed: "audit.viewed"`.
- `src/server/audit/service.ts`: `record()`. Add a new `queries.ts` beside it (`listAudit`) and a command for the view.
- `src/server/db/client.ts`: the `unicode_lower` SQL function (from 2.5); `src/server/auth/staff-queries.ts` shows how to use it.
- `src/server/db/tx.ts`: `withCommandTx(actor, action, fn)`.
- `src/lib/time.ts`: `formatManila`, `opdDate`, `addOpdDays`. Add a helper that turns a Manila date into its UTC start instant (Manila is UTC+8 with no DST: `YYYY-MM-DDT00:00:00+08:00`).
- `src/app/(staff)/admin/staff/page.tsx` + `staff-screen.tsx`: the list page to copy (params schema, `DataTableToolbar`, `DataTablePagination`, `EmptyState`, the table region).
- `src/components/data-table/toolbar.tsx`: it supports search plus select filters only. Add optional date inputs (`from` / `to`) that push the URL like the selects, and Clear resets them. The existing toolbar tests must stay green; add tests for the dates.
- `src/server/auth/permissions.ts` (+ test), `src/components/nav-items.ts` (`ADMIN_NAV`), `nav-permissions.test.ts`, `admin-link.tsx`, `mobile-menu.tsx`: add `audit.view` and the nav item.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/audit/schema.ts`: add `AuditViewed`, plus an exported `AUDIT_ENTITIES` list with a readable label for each entity and each action.
- [x] `src/server/audit/queries.ts`: `listAudit({ q, action, entity, from, to, page, pageSize })` returns `{ rows, total, page, pageCount }`, with the page clamped. Rows have `changes` parsed into an object; if the JSON is invalid, the raw text is kept.
- [x] `src/server/audit/service.ts`: `recordAuditView(actor, filters)` writes the `audit.viewed` row through `withCommandTx`.
- [x] `src/lib/time.ts`: `manilaDayStart(date)` → UTC ISO, with tests.
- [x] `permissions.ts`: `audit.view` for Admin only. Add it to the per-Role tests and the nav tests.
- [x] `src/app/(staff)/admin/audit/page.tsx` + client screen: the filters, table, pagination and empty state ("No audit entries match these filters."). Metadata title "Audit log", or the no-access title.
- [x] `toolbar.tsx`: optional date range filters, with tests.
- [x] Nav: `ADMIN_NAV` gets `/admin/audit` ("Audit", menu "Audit log", name "Admin: Audit log", a lucide icon, `audit.view`). Admin links use `prefetch={false}` for it.
- [x] Tests:
  - `listAudit` for every I/O Matrix row, plus ordering, paging and invalid `changes` JSON;
  - `recordAuditView` writes exactly one row;
  - `page.test.ts`: Forbidden for non-Admins, with no query and no view row;
  - the date helper.
- [x] `README.md`: the audit log page, its filters, and that viewing it is audited.

**Acceptance Criteria:**
- Given the Admin on `/admin/audit` after creating Joy and changing a Facility, when they filter action = `staff.created`, then only that row shows, with the Manila time, their name, "Staff account created", `user` and Joy's ID, and the changes (name, username, Role, Facilities, no password). The URL holds the filter, and back/forward works.
- Given the page, when it is viewed, then there is no edit, delete or export control, and a new `audit.viewed` row exists for that view.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- `schema.ts` also exports `AUDIT_ACTIONS`, `AUDIT_ACTION_LABELS` and `AUDIT_ENTITY_LABELS`; the page passes the label options to the client screen (the schema is server-only).
- Date parsing: `isOpdDate()` (real calendar dates only) and `manilaDayStart()` in `src/lib/time.ts`; `parseDateRange(from, to)` in `src/lib/url-query.ts` drops invalid dates and swaps a reversed range. `listAudit` re-applies it, and bounds `at` with `>= manilaDayStart(from)` and `< manilaDayStart(to + 1 day)`.
- `listAudit` keeps `changes` as raw text when it isn't a JSON object. The Changes column is formatted by the pure `admin/audit/audit-format.ts` (`{ old, new }` → `old → new`, lists of `{ name }` by name, `null` → "—").
- `recordAuditView` lives in `audit/views.ts` (not `service.ts`) to avoid an import cycle with `db/tx.ts`; it stores the URL's page as `requestedPage`. `AuditEntry.entity` is typed `AuditEntity`.
- `isOpdDate` accepts only years 1900–9998, so the day after `to` always has a valid start instant.
- Toolbar date changes are debounced together with the search (one navigation after 300 ms; a history entry when a date changed). Clear is immediate.
- The view row is written before the list is read, so it appears in the default list. The actor column shows "System" for system rows, or "Unknown" for staff rows with no name (failed sign-ins of unknown usernames).
- `AdminNavItem.prefetch?: false`, passed through by `AdminLinks` and `MobileMenu`.
- Toolbar: `dateFilters` (native `type="date"` inputs with labels) share the select state map with default `""`. A value only goes to the URL when it is cleared or passes `isOpdDate`, so a year still being typed (0002, 0020, and so on) never does. The toolbar now wraps at `md` so five controls fit at 768 px.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | `to=9999-12-31` passes `isOpdDate`; `addOpdDays` gives year 10000, so `manilaDayStart` throws a 500 after the view row is committed (blind, edge) | medium: a hand-edited URL crashes the page and logs a view of nothing | patch (bound years to 1900–9998, validated before the view is recorded) |
| 2 | Each day or month segment typed into a date input pushes a history entry and logs a view | medium: real with native date inputs; floods history and the log | patch (debounce date changes like search, then push once) |
| 3 | Pagination, Clear and header links could prefetch the page and log a view; header `prefetch` passing untested (verification-gap) | false today: a dynamic route with no `loading.js` isn't prefetched (`next/dist/docs/.../prefetching.md`); becomes real if a `loading.js` or Cache Components is added | defer |
| 4 | "1 audit entry match" grammar | low | patch |
| 5 | No index for `action`/`entity` filters | low: `audit_log_at_idx` covers ordering and ranges; the log is small | reject |
| 6 | Search matches the `actor_name` snapshot, not a renamed staff member's current name | low: renames are rare, and the snapshot is what was true at the time | reject |
| 7 | `AUDIT_ENTITIES` hand-maintained while `record()` accepts any string | low: a new entity silently gets no filter or label | patch (type `AuditEntry.entity` as `AuditEntity`) |
| 8 | JS `toLowerCase()` on the query vs SQL `unicode_lower` on the column | false: `unicode_lower` is registered as JS `toLowerCase()` in `db/client.ts`, the same function | reject |
| 9 | Page row mapping (System/Unknown actor, labels, `from`/`to` props) untested (verification-gap) | medium | patch |
| 10 | "Unknown" actor undocumented; the `recordAuditView` comment claims to be the only non-command write path (Better Auth hooks also write) | low | patch |
| 11 | Import cycle `audit/service.ts` ↔ `db/tx.ts` | medium: breaks the acyclic-module rule; one import-time use breaks it | patch (move `recordAuditView` to its own module) |
| 12 | Table region and section share the accessible name "Audit entries" | low | patch |
| 13 | View row stores empty `q`/`from`/`to` as null but `action`/`entity` as "all" | low: cosmetic | reject |
| 14 | `listAudit` with `pageSize: NaN` | false: only called with the constant 25 | reject |
| 15 | The view row records the requested page, not the clamped page shown | low: misleading in a breach review | patch (store it as `requestedPage`) |
| 16 | `listAudit` throwing after the view row is committed | low: after #1, only a DB failure remains | reject |

Patches applied: #1, #2, #4, #7, #9, #10, #11, #12, #15. Deferred: #3 (in `deferred-work.md`). Rejected: #5, #6, #8, #13, #14, #16.

Browser check after the patches (throwaway DB, `next start` on port 3100, headless Edge) found two layout bugs, both fixed:
- **Page scrolls sideways at 375 px and 768 px** (on Staff too, since Story 2.5). Absolutely positioned `sr-only` text inside the table escaped the scroll region, which wasn't `relative`. Fix: `relative` on the table region in `audit-screen.tsx` and `staff-screen.tsx`.
- **Header 13 px too wide at 375 px** once there are three Admin links. Fix: `AdminLinks` hidden below `md`; the menu sheet already lists the Admin pages.

After those fixes, all 14 browser checks passed:
- title;
- one view row per visit;
- no edit, delete or export controls;
- action filter;
- two quick date changes give one URL change, one history entry and one view row;
- back/forward;
- no page-level horizontal scroll at 375 px and 768 px;
- Triage Nurse gets the no-access page, no view row, and no Audit link.

Re-verified 2026-09-27: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 469 tests pass (32 files), `npm run build` OK (lists `/admin/audit`).

## Verification

**Commands:**
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`: expected all pass, with `/admin/audit` listed.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright, sign in as Admin, make a few changes, and walk the ACs: the filters, the date range, back/forward, and the 375 px and 768 px layouts. A Triage Nurse gets the no-access page.
