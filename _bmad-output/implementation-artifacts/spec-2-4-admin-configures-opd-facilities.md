---
title: 'Story 2.4: Admin configures OPD Facilities'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-4-admin-configures-opd-facilities'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-Dashboard-2026-09-26/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The OPD has no record of its Facilities (Prenatal, Animal Bite Center, Treatment, Consultation), their queue prefixes, opening days and hours, or which ones are live in the pilot. There is also no permission map, so nothing enforces "only Admins change settings".

**Approach:**
- Add the `settings` module: a `facilities` table seeded with the PRD defaults, the getters `liveFacilities()` and `isOpen()`, and an Admin-only `/admin/settings` Facilities screen to edit and deactivate them, with every change audited.
- Create `src/server/auth/permissions.ts`, the single Role × action map with a Facility scope for each action.
- Reach Admin pages from the header user area.

This follows epics.md Story 2.4, FR23, AD-2, AD-3, AD-4 and AD-8.

## Boundaries & Constraints

**Always:**
- **Tables and module rules:** `facilities` is owned by `settings`, and other modules read it only through settings getters. Every file under `src/server/**` imports `server-only`. Writes go through a Server Action: Zod `safeParse`, then `requireStaff()`, then `can()`, then one `withCommandTx` command with one audit row holding the old and new values.
- **Prefix changes** take effect on the next OPD day (Asia/Manila, through `opdDate()`). Today keeps the old prefix.
- **Permissions:** `can()` denies anything not in the map. Hiding UI is only cosmetic.
- **Forbidden page:** non-Admins get "You don't have access to this page." with a link to Overview and no data.
- **UX:** follows DESIGN.md and EXPERIENCE.md (44 px targets, labels, errors tied to fields, first-error focus, no color-only signals).

**Never:**
- No hard-coded Facility list outside the seed migration.
- No hard deletes (deactivation only).
- The "blocked while patients are waiting" rule is not here; it comes with queues in Story 4.1.
- No left rail yet (Story 4.1).
- No other settings (Urgency Levels, Priority Categories, schedules, thresholds); those are Story 2.6.
- No staff management; that is Story 2.5.

</frozen-after-approval>

## Code Map

- `src/server/db/tx.ts`: `withCommandTx(actor, action, fn)` passes `(tx, audit)`. `fn` is synchronous and must call `audit({ entity, entityId, changes })` exactly once. `src/server/db/errors.ts` has `DomainError(code)`.
- `src/server/audit/schema.ts`: the `AuditAction` values, currently `auth.*` and `admin.created`. Add `settings.facility_created` (seed only if needed), `settings.facility_updated`, `settings.facility_deactivated` and `settings.facility_reactivated`.
- `src/server/auth/session.ts`: `requireStaff()` returns `{ id, name, username, role }`, and `role` is a `StaffRole` (`admin | triage_nurse | facility_staff`).
- `src/lib/time.ts`: `opdDate(instant)` and `formatManila()`. Add `manilaWeekday(instant)` and `manilaMinutes(instant)` for `isOpen`.
- `src/components/app-header.tsx`: shows the user's name and Role, and **Sign out**. Add an **Admin** entry (links to `/admin/settings`) shown only to Admins, as an icon + label link in the user area, reachable in the mobile menu too.
- `src/components/data-table/*` and `src/lib/url-query.ts`: the list pattern. Not needed here (four rows); use a card list.
- `drizzle/`: the latest migration is `0002`. Add `0003` with the `facilities` table and seed rows.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/settings/schema.ts` + migration `0003`: create the `facilities` table and seed the four defaults in the migration, with fixed UUIDs: PN Prenatal, AB Animal Bite Center, TR Treatment, CN Consultation, open Mon–Sat 07:00–17:00, live, sort order 1–4. Columns:

  | Column | Definition |
  |---|---|
  | `id` | text UUID, primary key |
  | `name` | text, unique among active Facilities |
  | `prefix` | text, 2–3 uppercase letters |
  | `next_prefix` | text, null |
  | `next_prefix_from` | `opd_date` text, null |
  | `open_days` | text, JSON array of ISO weekdays 1–7 |
  | `open_time` | text `HH:MM` |
  | `close_time` | text `HH:MM` |
  | `is_live` | integer boolean |
  | `sort_order` | integer |
  | `deactivated_at` | text, null |
  | `created_at` | UTC ISO |
  | `updated_at` | UTC ISO |

- [x] `src/server/settings/repo.ts`, `queries.ts`, `service.ts`, `schemas.ts`, `actions.ts`:
  - `queries.ts` is the settings getters:
    - `listFacilities()` (Admin view, including deactivated);
    - `liveFacilities(instant?)` (active and live, sorted);
    - `effectivePrefix(facility, instant?)`: returns `next_prefix` once `opdDate(instant) >= next_prefix_from`;
    - `isOpen(facility, instant)`: the Manila weekday is in `open_days` and the Manila time is in `[open, close)`.
  - `service.ts` holds the commands:
    - `updateFacility`: name, days, hours, `is_live`. A prefix change sets `next_prefix` and `next_prefix_from` = tomorrow's OPD date instead of editing `prefix`. Changing it back to the current prefix clears the pending change.
    - `deactivateFacility` and `reactivateFacility`.
  - **Validation (Zod, with field errors):**
    - the name is 2–60 chars;
    - the prefix is `^[A-Z]{2,3}$` and unique across the `prefix` and `next_prefix` of all other Facilities;
    - at least one open day;
    - valid `HH:MM` times with close later than open.
  - When `next_prefix_from` has passed, the value is folded into `prefix` lazily on the next write or read-through, or kept computed by `effectivePrefix`. Pick one, and test the day boundary at 15:59:59Z vs 16:00:00Z.
- [x] `src/server/auth/permissions.ts`:
  - `Action` union (starting with `settings.view` and `settings.facilities.manage`);
  - `PERMISSIONS: Record<Action, { roles: StaffRole[]; scope: "none" | "facility" }>`;
  - `can(user, action, facilityId?)` (deny by default; the Facility scope checks the user's assigned Facilities once Story 2.5 adds them);
  - `requirePermission(action)` for pages, which renders the forbidden state instead of redirecting.
  - Unit tests: each Role against each action, plus deny-by-default for an unknown action.
- [x] `src/components/forbidden.tsx`: "You don't have access to this page." with a link to Overview, the page title "No access | OPD", and no data.
- [x] `src/app/(staff)/admin/settings/page.tsx` (+ client parts), titled "Settings | OPD":
  - The page title is "OPD Settings", with a **Facilities** section (tabs are allowed so Story 2.6 can add more).
  - Each Facility is a card showing its name, prefix chip (mono), days, hours, a Live / Not live badge with text, and Active / Deactivated.
  - When a prefix change is pending, the card shows "Prefix changes to XY on {date}".
  - **Edit** opens a Sheet form with the fields above: Live is a switch with a label, days are checkboxes, times are `input type="time"`.
  - **Deactivate** / **Reactivate** asks for confirmation that names the Facility.
  - Success shows a toast or status line. Errors sit on their fields, with focus on the first one.
  - Non-Admins get `Forbidden`.
- [x] Header: an **Admin** link for Admins only (desktop user area and mobile menu).
- [x] Tests (Vitest, `createTestDb()`):
  - the migration seeds four live Facilities;
  - `isOpen` at Manila boundaries: Sunday is closed, 06:59 is closed, 07:00 is open, 16:59 is open, 17:00 is closed;
  - the prefix change applies the next OPD day only;
  - duplicate prefix and invalid hours are rejected with field errors;
  - each command writes exactly one audit row with old and new values;
  - a non-Admin action call is denied, with no row changed and no audit row.
- [x] `README.md`: an Admin settings section.

**Acceptance Criteria:**
- Given a fresh `db:migrate`, when the Admin opens `/admin/settings`, then four Facilities show: Prenatal (PN), Animal Bite Center (AB), Treatment (TR) and Consultation (CN), open Mon–Sat 7:00–17:00, all live.
- Given the Admin edits Consultation's hours to 08:00–16:00 and turns Live off, when saved, then the card shows the new values, `liveFacilities()` excludes it, and one `settings.facility_updated` row records the old and new values.
- Given the Admin changes Treatment's prefix to TX, when saved, then today `effectivePrefix` is still TR, and from the next Manila day it is TX. The card shows the pending change.
- Given another Facility already uses AB, when the Admin sets a prefix to AB, then the form shows "Prefix already in use" on the field and nothing is saved.
- Given a Triage Nurse or Facility Staff account, when it opens `/admin/settings` or posts the action directly, then it sees the no-access page, nothing changes, and there is no audit row. The header shows no Admin link.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- Prefix strategy: reads always go through `effectivePrefix()` (also exposed as `Facility.currentPrefix`); a due `next_prefix` is folded into `prefix` lazily on that Facility's next write. Day boundary tested at 15:59:59Z vs 16:00:00Z.
- Prefix uniqueness compares against every other Facility's effective and still-pending prefix (deactivated included). Name uniqueness is case-insensitive among active Facilities (partial unique index + service check).
- A save that changes nothing runs no command and writes no audit row (`changed: false`). Editing a deactivated Facility is refused until it is reactivated.
- `requirePermission(action)` returns `{ allowed, user }`; the page renders `<Forbidden />` and sets the title "No access" via `generateMetadata`.
- No `settings.facility_created` action was added: the seed runs in the migration, outside `withCommandTx`.
- Success feedback is an `aria-live` status line (no toast library is installed). New shadcn-style `ui/switch.tsx` wraps the radix Switch.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | `ui/switch.tsx` imports `cn` from `"cn"` | false | Every shadcn component here uses the `cn` package (e.g. `ui/badge.tsx`); the build passes | reject |
| 2 | The edit Sheet can be dismissed by Esc or an overlay click while a save is pending, so a later error lands on an unmounted form | medium | `facility-form.tsx` `onOpenChange` has no pending guard | patch |
| 3 | The DB name index is case-sensitive while the service compares case-insensitively; an index conflict surfaces a raw SqliteError as a network error | medium | `facilities_active_name_unique` uses BINARY collation; `runCommand` maps only `DomainError` | patch (a new migration with a `COLLATE NOCASE` index; map a unique-constraint failure to `name_taken`) |
| 4 | No DB CHECKs for `next_prefix` format, `next_prefix_from` format, `open_days` JSON or the `HH:MM` time format; bad stored JSON makes every save throw | low | Migration 0003 CHECKs cover `prefix` and pairing only | patch (a new migration adds the CHECKs, including `json_valid(open_days)`) |
| 5 | Deactivate/reactivate reports success when `changed:false` and doesn't revalidate, so the card stays stale | medium | `actions.ts` revalidates only when changed; the dialog ignores `changed` | patch |
| 6 | Validation errors on keys the form doesn't show (`id`, `form`) say "Check the highlighted fields" with nothing highlighted; `PrefixTaken` returns a generic message | low | `fieldErrorsOf` / `FIELD_ORDER` | patch |
| 7 | `runCommand` calls `can()` without the Facility id | low | Latent: it breaks once a facility-scoped action uses it | patch (pass `parsed.data.id`) |
| 8 | The prefix chip relies on `aria-label` on a plain span; the Live help text is read twice | low | ARIA rules | patch (`sr-only` text; drop the duplicate) |
| 9 | The desktop Admin link lacks `aria-current` and names itself "Admin" vs "OPD Settings" | low | `app-header.tsx` | patch |
| 10 | Validation runs before the permission check, so a non-Admin sees field errors | low | AD-3 fixes the order parse → `requireStaff` → `can`; errors expose only input rules, no data | reject (architecture order) |
| 11 | Title is "Settings \| OPD" vs heading "OPD Settings"; `requirePermission` runs twice | low | The spec sets the title; `getStaff` is cached per request | reject |
| 12 | Small doc/format slips (`addOpdDays` comment, spacing, README blank line) | low | Trivial | patch |
| 13 | A stale stored prefix of another Facility after its due date isn't reserved | low | Intended: `effectivePrefix` is authoritative, and the old value folds on the next write | reject |
| 14 | Pending-prefix and deactivated-prefix uniqueness and `pendingPrefix` are untested (verification-gap) | medium | Tests only try `AB` (a current, active prefix) | patch |
| 15 | Reactivation name conflict is untested (verification-gap) | medium | — | patch |
| 16 | `settings.test.ts` depends on test order and shared DB state | medium | Hides gaps #14 and #15 | patch (fresh DB per test or per `describe`) |
| 17 | The page's `Forbidden` branch is untested | medium | No test calls the page | patch (a Vitest test awaiting `SettingsPage()` with `requireStaff` mocked, asserting `Forbidden` and that `listFacilities` isn't called) |

**Patches applied:** #2–9, #12 and #14–17 (migration `0004_facilities_checks.sql`; 0003 untouched).

**Fix to the review instruction for #9:** the accessible name "OPD Settings" didn't contain the visible "Admin" label (WCAG 2.5.3). It is now "Admin: OPD Settings".

**Re-verified:**
- Lint 0, tsc 0, 258 tests pass, build OK.
- Browser run on a production server with a throwaway DB, as an Admin and a Triage Nurse. 10/10 checks passed:
  - the Admin link is present;
  - the title is "Settings | OPD" with four Facilities;
  - Consultation edited to 08:00–16:00 and not live, confirmed in the DB, with one `settings.facility_updated` row holding old and new values;
  - a duplicate prefix shows "Prefix already in use" with focus on the prefix field;
  - the Nurse sees no Admin link, gets the forbidden page with no Facility data, and the title "No access | OPD".

## Verification

**Commands:**
- `npm run lint`: expected 0 errors.
- `npm test`: expected all pass.
- `npm run build`: expected success; `/admin/settings` is listed.

**Manual checks:**
- On a throwaway DB, with `next start` and Edge through Playwright:
  - as Admin, edit hours/live and check the card;
  - make a prefix change and check the pending note;
  - enter a duplicate prefix and check the field error;
  - deactivate, then reactivate, with confirmation;
  - keyboard only: open Edit, tab through the fields, save;
  - as a non-Admin created via a direct DB insert or the Better Auth admin API in the test setup, open `/admin/settings` and check the forbidden page.
- Check the audit rows.
