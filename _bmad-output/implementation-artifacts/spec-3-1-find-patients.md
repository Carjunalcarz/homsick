---
title: 'Story 3.1: Find patients'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '3-1-find-patients'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-7-admin-reviews-the-audit-log.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There are no patients in the system, so staff can't look anyone up. Without fast search, nurses will register returning patients again and create duplicates.

**Approach:** Create the `patients` module, with the `patients` and `hospital_number_counters` tables. Add a `db:seed:demo` script with fictional patients that refuses to run in production. Add one search query that matches partial name, Hospital Number, birthdate and phone. It is used by:
- the `/patients` list page (the story 1.4 URL table);
- a keyboard-driven Patient finder in the left column of `/triage`.

This follows epics.md Story 3.1, FR-4 and UX-DR9/21.

## Boundaries & Constraints

**Always:**
- **Table:** `patients` has these columns:
  - id (UUID) and `hospital_number` (unique, `HN-YYYY-NNNNNN`);
  - the name, as separate fields (decided 2026-09-27): `last_name`, `first_name`, `middle_name` (optional) and `suffix` (optional, e.g. Jr., III). It displays as "DELA CRUZ, Juan Santos" (a shared `formatPatientName`) and sorts by last name, then first name. Search matches part of any name field, and also "first last" and "last, first" typed together;
  - `sex` (`female`/`male`, CHECK), `birthdate` (`YYYY-MM-DD`);
  - `address_barangay`, `address_municipality`, `contact_number`;
  - optional `philhealth_pin`, `senior_citizen_id`, `pwd_id`, `emergency_contact_name`, `emergency_contact_number`;
  - `privacy_notice_at` (UTC ISO), `created_at`, `updated_at`, `created_by`, and `deactivated_at` (never hard-deleted).
- **Counter:** `hospital_number_counters(year PK, last_seq)`, owned by `patients`. The repo function `nextHospitalNumber(tx, year)` is the only way to issue a number. The seed uses it, so Story 3.2 can't collide.
- **Search:** `searchPatients({ q, page, pageSize })` in `patients/queries.ts`. `q` is trimmed. Each result shows name, age, sex, Hospital Number and last Visit, sorted by name. Deactivated patients are excluded. What `q` matches:
  - Name: part of the name, ignoring case (`unicode_lower`).
  - Hospital Number: part of it, ignoring case.
  - Birthdate: a whole date, `YYYY-MM-DD` or `MM/DD/YYYY`, which must be a real date. It matches `birthdate` exactly.
  - Phone: any digits in the query, with `+63`/`63` read as `0`, matched against the stored contact number's digits. It needs at least 4 digits.
- **Age:** calculated from `birthdate` in Manila time (`ageOn(birthdate, today)` in `src/lib`), never stored.
- **Last Visit:** always null for now ("No visits"). The `visits` module arrives in Story 3.4, which fills it in through the `visits` queries. `patients` never reads `visits` directly.
- **Permissions:** `patients.view` for every Role. The `/patients` page and the finder action check it.
- **Privacy:** searching isn't audited (a record *view* is, in Story 3.3). App logs never contain names, numbers or queries.
- **Finder** (on `/triage`, client):
  - Results update 300 ms after typing, through a Server Action returning at most 8 results.
  - ARIA combobox and listbox pattern: ↑/↓ move the highlight, Enter selects, Esc clears.
  - `Ctrl+K` focuses the finder on `/triage`, and the header search everywhere else.
  - Selecting a patient shows a summary card in the right column. The triage form replaces it in Story 3.4.
  - The "New patient" row comes in Story 3.2.
- **`/patients`:** the list pattern from Story 2.5/2.7 (search, 25 per page, count, empty state "No patients match "{q}"." with suggestions for name spelling, Hospital Number, birthdate format and phone). Rows aren't links yet; Story 3.3 adds the record page. The header search already submits `/patients?q=`.
- **Demo seed:** `npm run db:seed:demo` adds about 40 fictional Filipino patients: mixed ages (including seniors and children), both sexes, a few with the same name and different birthdates, and a few with IDs. It refuses to run in production and refuses a second run (it detects its own marker). The seed writes no audit rows, and says so.

**Never:**
- No registration, editing or record page (Stories 3.2 and 3.3).
- No visits or triage tables.
- No real patient data in the seed or tests.
- No hard delete.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partial name | `q=dela cr` with "Juan Dela Cruz" | Juan is listed | N/A |
| Case and accents | `q=PEÑA` with "Maria Peña" | Maria is listed | N/A |
| Hospital Number | `q=hn-2026-00001` | patients whose number contains it | N/A |
| Birthdate US | `q=03/15/1950` | patients born 1950-03-15 | N/A |
| Impossible date | `q=02/30/1950` | treated as text; no birthdate match | N/A |
| Phone | `q=+63 917 123 4567` with stored `09171234567` | matched | N/A |
| Short digits | `q=12` | no phone match (under 4 digits); name and Hospital Number rules still apply | N/A |
| Deactivated | a patient with `deactivated_at` set | never listed | N/A |
| Seed in prod | `NODE_ENV=production npm run db:seed:demo` | exits 1, writes nothing | message "Demo data is never loaded in production." |

</frozen-after-approval>

## Code Map

- `src/server/db/client.ts`: `unicode_lower`. `src/server/auth/staff-queries.ts` and `src/server/audit/queries.ts` show the search and paging patterns to copy.
- `src/server/settings/schema.ts`, `drizzle/0003`: the table + CHECK style. Create the migration with `npm run db:generate` and register it in `schema-index.ts`.
- `src/app/(staff)/admin/staff/page.tsx` + `staff-screen.tsx`, `src/components/data-table/*`: the list page pattern, including the `relative` table region fix from Story 2.7.
- `src/app/(staff)/patients/page.tsx`, `triage/page.tsx`: placeholders to replace.
- `src/components/header-search.tsx`: add the `Ctrl+K` handler (a small client component) outside `/triage`.
- `src/server/auth/permissions.ts` (+ tests): add `patients.view`.
- `scripts/create-admin.ts`, `scripts/load-env.ts`: the script pattern for `scripts/seed-demo.ts`. Add `"db:seed:demo"` to `package.json`.
- `src/lib/time.ts`: `opdDate`. Add `ageOn` in `src/lib/age.ts` with tests (birthday today, Feb 29 births, future date → null).

## Tasks & Acceptance

**Execution:**
- [x] `src/server/patients/{schema,repo,queries,schemas,actions}.ts` + migration `0008_patients`: the tables, `nextHospitalNumber`, `searchPatients`, and `searchPatientsAction` for the finder (Zod, then `requireStaff`, then `can("patients.view")`).
- [x] `src/lib/age.ts` + `src/lib/patient-search.ts` (query parsing: date forms, phone digits), with unit tests.
- [x] `permissions.ts`: `patients.view`, with tests.
- [x] `/patients` page: list, toolbar, pagination, empty state.
- [x] `/triage` page: the finder (left) and the selected-patient card (right), responsive (stacked below lg).
- [x] `Ctrl+K` handling: the finder on `/triage`, the header search elsewhere.
- [x] `scripts/seed-demo.ts` + npm script.
- [x] Tests:
  - every I/O Matrix row against a temp DB;
  - the counter: sequential and per year;
  - the finder with jsdom (typing debounce, ↑/↓/Enter/Esc, the `aria-activedescendant` wiring);
  - the page's Forbidden branch isn't needed (all Roles), but an unauthenticated action call is rejected.
- [x] `README.md`: the patients module, search rules and the demo seed.

**Acceptance Criteria:**
- Given the demo seed, when a nurse types "cruz" in the finder, then within about 300 ms up to 8 matches show name, age, sex, Hospital Number (mono) and "No visits", and ↓ ↓ Enter selects the second match.
- Given `/patients?q=cruz&page=2`, when loaded, then the URL-driven table shows page 2 and the count, and back/forward works.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass, and search answers in under 1 s on the seeded DB.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Files: `src/server/patients/{schema,repo,queries,schemas,actions,demo-seed}.ts` (+ `patients.test.ts`, `actions.test.ts`), `drizzle/0008_patients.sql` (generated), `src/lib/{age,patient-search,patient-name,patient-display,keyboard-shortcuts}.ts`, `src/components/search-shortcut.tsx` (rendered in `AppHeader`), `src/app/(staff)/patients/{page,patients-screen}.tsx` (+ `page.test.ts`), `src/app/(staff)/triage/{page,triage-workspace,patient-finder}.tsx` (+ `patient-finder.test.tsx`), `scripts/seed-demo.ts`.
- **Phone rule interpretation:** phone matching applies only when the whole query looks like a phone number (digits, spaces, `+ ( ) - .`), so "juan 0917" or a Hospital Number doesn't list everyone whose number contains its digits; a whole-date query is never read as digits. `+63` → `0`; a bare `63` prefix is tried both as typed and as `0…`. Stored numbers are compared after stripping spaces, dashes, dots, brackets and `+` (the stored `63…` form is not rewritten; Story 3.2 should store `09…`).
- **Hospital Number search:** `q=hn-2026-00001` is a substring match, so it lists HN-2026-000010…000019 (not 000001), as the matrix says ("contains it"). Tested on the seeded DB.
- **Seed marker:** `created_by = 'demo-seed'` (no FK on `created_by`, like `audit_log.actor_id`). The seed uses its own IMMEDIATE transaction, not `withCommandTx`, because it writes no audit row. The production refusal happens in the script before any import or DB open (the test spawns the script with `NODE_ENV=production` and checks exit 1, the message, and that the DB file was never created), and again inside `seedDemoPatients`.
- The seed has 42 patients, 27 of them matching "cruz" (last or middle names), so `/patients?q=cruz&page=2` has a page 2 and the finder fills its 8.
- `/triage` checks a new `triage.view` (Triage Nurse, Admin; Facility Staff get `<Forbidden />`); the finder action keeps `patients.view` and returns a slim row (no address or contact).
- **Search at scale:** measured on 50,000 generated patients. With `unicode_lower` over 7 name forms per row, "juan dela cruz" and "03/15/1950" took ~310 ms and "cruz" ~160 ms. Migration `0009_patients_search_text` adds a stored lowercased `search_text` (backfilled with `unicode_lower`; written by the repo's `insertPatient`/`updatePatient`). After it: "cruz" 17 ms, "juan dela cruz" 38 ms, a phone 40 ms, a birthdate 38 ms, a Hospital Number 12 ms (count plus page query, averaged over 5 runs).
- Ctrl+K: one `SearchShortcut` client component in the header picks the target by pathname (finder on `/triage`, header search elsewhere), and only prevents the browser default when a visible target exists (below lg the header search lives in the menu sheet, so outside `/triage` the key falls through).
- `FINDER_LIMIT` lives in `schemas.ts` because a `"use server"` file may export only async functions.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | `demo-seed.ts` has broken characters ("PeÃ±a", "IbaÃ±ez", "Santo NiÃ±o"), and the dev DB is already seeded with them (all three layers) | high: garbled names, and "peña" search fails on demo data | patch (fix the file, correct the demo rows in the dev DB, test a "peña" search on the seed) |
| 2 | `/triage` is gated by `patients.view`, so Facility Staff reach it by URL although `nav.triage` hides it | medium: triage is Triage Nurse / Admin work (PRD Role matrix) | patch (`triage.view` for those Roles; the finder action keeps `patients.view`) |
| 3 | The finder action returns every match's address to the browser | medium: more personal data than needed; `/patients` deliberately strips it | patch (a slim finder row type without address) |
| 4 | Search runs `unicode_lower` 7 times per row with no index; the < 1 s test uses 42 rows | maybe-false, medium if true: an OPD accumulates tens of thousands of patients | patch (measure at 50,000 rows; if over 300 ms, add a stored lowercased search column in a new migration) |
| 5 | The listbox never closes on blur, so `aria-expanded` stays true | low: breaks the combobox pattern | patch |
| 6 | Selecting a patient is announced twice (a status message plus an `aria-live` section) | low | patch |
| 7 | "Showing the first 8" leaves no path to the rest | low | patch ("See all N results" link to `/patients?q=`) |
| 8 | `/triage` and `/patients` Forbidden branches untested (verification-gap, blind) | medium | patch |
| 9 | The selected-patient card is untested; Ctrl+K isn't tested through the real header (verification-gap) | low: the card is replaced in 3.4; the ids are shared constants | defer |
| 10 | Mac hints show Ctrl+K | low: the hospital's workstations run Windows; ⌘K works anyway | reject |
| 11 | The birthdate CHECK glob accepts impossible dates; `formatBirthdate` rolls them over | low: registration (3.2) validates real dates; changing the CHECK needs a table rebuild | patch `formatBirthdate` to show the raw value for an invalid date; reject the CHECK change |
| 12 | `package.json` lost a space in `create-admin`; seed size given as "about 40" vs 42; the production message defined twice | low | patch |
| 13 | The spawn test uses tsx's internal `dist/cli.mjs` path | low | reject |
| 14 | Sorting uses ASCII `nocase`, so an accented initial sorts by bytes | low: rare for initials | reject |
| 15 | `searchPatients` with `pageSize: NaN` | false: only called with constants | reject |
| 16 | A stored `+63…` number isn't normalized; `(+63)` is rejected by `PHONE_LIKE` | low | patch the `PHONE_LIKE` regex; registration (3.2) stores the `09…` form |
| 17 | No retry after a failed finder search; a session redirect is shown as a network error; Cyrillic layouts | low: typing again retries; SessionGuard handles expiry | reject |
| 18 | The finder schema rejects input over 1,000 characters though its comment says it is cut | low | patch (cut it, as the comment says) |
| 19 | The seed run before `db:migrate` creates an empty file and fails with "no such table" | low | patch ("Run npm run db:migrate first.") |

Patches applied: #1–#8, #11 (`formatBirthdate`), #12, #16 (regex), #18, #19. For #4, a search on 50,000 generated patients took up to 311 ms, so migration `0009_patients_search_text` adds a stored lowercased `search_text`; queries now take 12–40 ms. Deferred: #9. Rejected: #10, #13, #14, #15, #17, and the CHECK part of #11.
Re-verified 2026-09-27: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 605 tests pass (43 files), `npm run build` OK.

## Verification

**Commands:**
- `npm run db:migrate`, then `npm run db:seed:demo` (dev DB), `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright:
  - the finder keyboard flow and `Ctrl+K`;
  - `/patients` search and paging;
  - no page-level horizontal scroll at 375 px and 768 px.
