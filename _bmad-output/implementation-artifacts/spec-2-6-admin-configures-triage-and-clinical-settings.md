---
title: 'Story 2.6: Admin configures triage and clinical settings'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-6-admin-configures-triage-and-clinical-settings'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-admin-configures-opd-facilities.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only Facilities are configurable. Urgency Levels, Priority Categories, the Animal Bite Center dose schedules, the prenatal target, the No-show call threshold and the pre-close warning exist only in the PRD. Triage, queues and appointments (Epics 3–6) need them as settings rows behind getters (AD-8).

**Approach:** Add settings-owned tables for these, seeded by a migration with the PRD defaults. Add getters, audited Admin-only commands, and sections on `/admin/settings` below Facilities. This follows epics.md Story 2.6, FR-24 and AD-8.

## Boundaries & Constraints

**Always:**
- **Commands:** AD-3 pipeline (Zod, then `requireStaff()`, then `can(user, "settings.clinical.manage")`, then one `withCommandTx` command). Each command writes one audit row with old and new values of what changed. A save that changes nothing writes no row, as with Facilities.
- **Urgency Levels:**
  - Each level has a name (unique, case-insensitive, 2–30 characters), an ER flag, and a rank.
  - Only non-ER levels have a rank: a unique whole number of 1 or more. ER levels have none. A lower rank is served first.
  - At least one active non-ER level must exist.
  - The Admin can rename, re-rank, add and remove levels. Removing is soft (`deactivated_at`).
  - IDs are stable, so later snapshots (AD-6) keep pointing at the same level.
- **Priority Categories:** a fixed set (Senior Citizen RA 9994, PWD RA 10754, Pregnant hospital policy). Only the enabled flag is editable. Turning off a legally required one needs `confirmLegal: true`, checked on the server too. Without it, the save is refused with the message "Legally required (RA 9994 / RA 10754)".
- **Animal Bite Center schedules:** two fixed schedules (new patient, previously immunized). Each is a list of dose days: starts at 0, strictly increasing, whole numbers 0–90, 2–10 doses.
- **OPD thresholds:** prenatal target 1–20, No-show threshold 1–10 calls, pre-close warning 0–120 minutes (0 = off).
- **Getters:** other modules read these only through the settings getters, which return the saved values right away.
- **Scope:** changes apply only to new entries. Nothing already stored is rewritten.

**Never:**
- No hard delete.
- No adding or renaming Priority Categories.
- No Facility-specific schedules beyond the Animal Bite Center.
- No queue, triage or appointment logic (those come in Epics 3–6).
- No display devices (Epic 5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh DB | migrations run | Emergency (ER), Urgent (1), Routine (2); the three categories on; schedules 0/3/7 and 0/3; target 8, threshold 3, warning 30 | N/A |
| All ER | every active level flagged ER | refused, nothing saved | form error "Keep at least one level that isn't ER." |
| Rank clash | two non-ER levels with rank 2 | refused | field error on the second rank row "Rank already used" |
| Legal off without confirm | PWD off, `confirmLegal` missing | refused, nothing saved, no audit row | `confirmation_required` |
| Legal off confirmed | Senior Citizen off, confirmed | saved; audit `{ enabled: { old: true, new: false } }` | N/A |
| Bad schedule | `3, 7` or `0, 7, 3` | refused | field error "Start at Day 0, then later days in order." |

</frozen-after-approval>

## Code Map

- `src/server/settings/{schema,repo,queries,service,schemas,actions}.ts`: the Facility pattern to extend:
  - the `facilityCommand` diff, the `Unchanged` rollback and `changed:false`;
  - `runCommand` with fieldErrors mapping;
  - `fieldErrorsOf`.
- `drizzle/0003_facilities.sql` + `0004_facilities_checks.sql`: seed plus CHECK style. Generate the new migration with drizzle-kit, then append the seed INSERTs by hand.
- `src/server/settings/migrations.test.ts`: the `migrationsUpTo` helper for the upgrade test.
- `src/server/audit/schema.ts`: `AuditAction` enum to extend.
- `src/server/auth/permissions.ts` (+ its test): add the action.
- `src/app/(staff)/admin/settings/page.tsx`, `facilities-section.tsx`, `facility-form.tsx`: card, Sheet form, `returnFocus` and AlertDialog patterns. The page currently notes "clinical settings come in Story 2.6".
- `src/components/ui/switch.tsx`, `sheet`, `alert-dialog`: reuse; don't add new primitives unless needed.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/settings/schema.ts` + migration `0006_clinical_settings`:
  - `urgency_levels`: id, name, is_er, rank, deactivated_at, timestamps. CHECK: ER means rank is null; non-ER means rank ≥ 1. Unique active rank; unique active name (nocase).
  - `priority_categories`: id, code, name, legal_basis, legally_required, enabled, sort_order.
  - `clinical_schedules`: id, code, name, days JSON (CHECK `json_valid`).
  - `opd_settings`: a single row (CHECK `id = 1`) with prenatal_target, no_show_threshold, pre_close_warning_minutes, each range-CHECKed.
  - Seed the defaults with fixed UUIDs.
- [x] `src/server/settings/queries.ts`: add getters.
  - `urgencyLevels()`: active levels, non-ER by rank, then ER.
  - `priorityCategories()` and `enabledPriorityCategories()`.
  - `abcSchedule("new" | "previously_immunized")`.
  - `opdThresholds()`: `{ prenatalTarget, noShowThreshold, preCloseWarningMinutes }`.
- [x] `src/server/settings/service.ts`: add four commands, each with its own audit action.
  - `updateUrgencyLevels(list)` (whole-list save): `settings.urgency_levels_updated`, with `changes` holding the old and new lists.
  - `setPriorityCategoryEnabled`: `settings.priority_category_updated`.
  - `updateClinicalSchedule`: `settings.schedule_updated`.
  - `updateOpdThresholds`: `settings.opd_thresholds_updated`.
  - Errors use `DomainError` codes: `no_non_er_level`, `rank_taken`, `name_taken`, `confirmation_required`, `not_found`.
- [x] `schemas.ts` and `actions.ts`: add a Zod schema and a Server Action for each command. Map errors to fields; urgency row errors use keys like `levels.1.rank`.
- [x] `permissions.ts`: `settings.clinical.manage` for Admin only, with tests of every Role.
- [x] `/admin/settings` UI: four more sections below Facilities, each with a heading and a live status line. The page description and the 2.6 note are updated.
  - **Urgency Levels:** a table (name, rank, or an ER badge with text). **Edit** opens a Sheet with the whole list: name input, ER checkbox, a rank input that is disabled for ER, **Remove**, and **Add level**.
  - **Priority Categories:** a row per category with a Switch, the legal basis as text, and a "Legally required" badge. Turning off Senior Citizen or PWD opens an AlertDialog that names the category and shows "Legally required (RA 9994 / RA 10754)", with **Turn off {name}** / Cancel.
  - **Animal Bite Center schedules:** each schedule shows "Day 0, 3, 7". An edit Sheet takes a comma-separated days input.
  - **Queue and prenatal:** the three numbers, with an edit Sheet.
  - Every form follows the Facility form rules: field errors with `aria-describedby`, focus on the first error, pending state that blocks dismissal, and focus returned to the triggering control. Controls are 44 px.
- [x] Tests:
  - migration defaults, an upgrade from 0005 that keeps Facility rows, and the CHECKs;
  - every command: happy path, each I/O Matrix error, no audit row when unchanged, and exactly one row otherwise;
  - getters return new values after a save;
  - a denied non-Admin action changes nothing;
  - the Facility section still works.
- [x] `README.md`: the settings list and the legal note.

**Acceptance Criteria:**
- Given the Admin renames Routine to "Non-urgent" and adds "Semi-urgent" at rank 2 (Non-urgent moves to rank 3), when saved, then `urgencyLevels()` returns Urgent, Semi-urgent, Non-urgent, Emergency, and one audit row holds the old and new lists.
- Given the Admin turns off PWD and confirms, when the page reloads, then PWD shows off and `enabledPriorityCategories()` excludes it.
- Given a Triage Nurse, when calling any clinical settings action directly, then it returns forbidden, and nothing changes.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- Business rules for Urgency Levels (at least one non-ER, unique ranks, unique names ignoring case) live in the service. Zod checks only the shape. Rank and name clashes throw `FieldDomainError` with `fieldErrors` keyed `levels.{i}.rank` / `levels.{i}.name`, naming the later row. All-ER throws `no_non_er_level`, which the form shows as a form-level error.
- A whole-list save moves the changing rows to temporary names and ranks (`~{id}`, 1,000,000+) before writing the final values. This lets levels swap names or ranks under the unique active indexes. A removed level keeps its last name and rank, and `deactivated_at` takes it out of those indexes.
- For an ER level, any rank the form sends is dropped (it becomes `null`). Real ranks go from 1 to 99, and there can be at most 20 levels.
- The `clinical_schedules` table also has a `sort_order` column. `priority_categories`, `clinical_schedules` and `opd_settings` have `updated_at` but no `created_at`. `clinicalSchedules()` is an extra getter, used by the settings page.
- The shared form pieces are in `admin/settings/settings-ui.tsx`. The Facility files are unchanged.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | Whole-list Urgency save deactivates a level another Admin added after the form loaded (lost update) | low: needs two Admins editing levels at once; the level can be re-added; the fix adds a new input parameter | reject |
| 2 | `wholeNumber` reads whitespace-only as 0 and accepts `0x10` / `1e1` / `+5` (blind, edge, verification-gap) | low: only by direct action call, but it silently turns the pre-close warning off; a direct correction | patch |
| 3 | `parseScheduleDays` turns corrupt JSON into `[]` silently | low: only reachable by writing the table outside the service; guards an undemonstrated state | reject |
| 4 | The legal warning names both laws for each category | false: the text "Legally required (RA 9994 / RA 10754)" is required verbatim by FR-24 / epics AC | reject |
| 5 | `LEGALLY_REQUIRED` and the limits (30, 99, thresholds) are duplicated as client literals; `LEVELS_MAX` isn't shown in the UI, so Add level stays enabled past 20 | low: client and server messages drift; the client can't import the `server-only` schemas | patch (shared constants in `src/lib`; Add level disabled at 20) |
| 6 | `settings-ui.tsx` imports `returnFocus` from `facility-form` instead of `src/lib/focus.ts`; `FIELD`/`FieldError` duplicate `staff/form-parts.tsx` | low | patch the `returnFocus` import; reject the form-parts dedup (a cross-route refactor) |
| 7 | Unticking ER leaves Rank empty, so the save always fails; Add level after rank 99 prefills 100 | low: real in normal use; a direct fix | patch (prefill the lowest free rank 1–99) |
| 8 | README doesn't state the 99 rank / 20 level caps | low | patch |
| 9 | Unexpected errors (SQLite constraint or busy) from a clinical action surface as "Couldn't reach the server" | low: the Story 2.5 staff actions already return `failed` | patch |
| 10 | Form-level-only errors leave focus on Save | low: announced through `role="alert"`, the same pattern as the Facility form | reject |
| 11 | Names differing only by Unicode normalization pass the unique checks | low: unlikely for Admin-typed level names | reject |
| 12 | Migration test's last statement isn't wrapped in `expect` | false: an `exec` that throws fails the test | reject |
| 13 | Doc comments: `levelsForm()` mentions overrides it doesn't take; the duplicate "Absent for a level added" comment | low | patch |
| 14 | ER ↔ non-ER switch of an existing level untested (verification-gap), plus the duplicate-id refusal and `LEVELS_MAX` | medium | patch |
| 15 | The Urgency form's mapping of `levels.N.field` server errors to rows is untested (verification-gap) | medium | patch (jsdom component test) |
| 16 | The Priority Category legal-confirmation client flow is untested (verification-gap) | medium | patch (jsdom component test) |

Patches applied: #2, #5, #6 (the `returnFocus` import), #7, #8, #9, #13, #14, #15, #16. Rejected: #1, #3, #4, #10, #11, #12 and the form-parts dedup in #6. Nothing deferred.
Re-verified 2026-09-27 after patches: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 424 tests pass (29 files), `npm run build` OK (lists `/admin/settings`). The browser walkthrough ran before the patches; the patched behavior is covered by the unit and jsdom tests.

## Verification

**Commands:**
- `npm run db:migrate` (dev DB), then `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright, walk the ACs: the legal dialog, the rank error focus, and the 375 px and 768 px layouts.
- Check the audit rows in the DB.
