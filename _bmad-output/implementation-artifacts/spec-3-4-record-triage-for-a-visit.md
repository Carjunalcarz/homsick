---
title: 'Story 3.4: Record triage for a visit'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '3-4-record-triage-for-a-visit'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-view-and-update-a-patient-record.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After finding a patient, the nurse has nowhere to record the Chief Complaint, Vital Signs, Urgency Level and Priority Category, and no Visit exists.

**Approach:** Replace the selected-patient card on `/triage` with a keyboard-first triage form. Saving it (`Ctrl+Enter`) opens a Visit through `visits.open(tx)` and stores a Triage Record with the priority snapshot, in one audited transaction. The Visit stays *Open*, awaiting a Facility (Story 3.5). Create the `visits` module (with the Visit state machine) and the `triage` module. Visit history on the record page and "last visit" in search now read from `visits`. This follows epics.md Story 3.4, FR-7, AD-3, AD-6, AD-13, AD-15 and UX-DR6/11.

## Boundaries & Constraints

**Always:**
- **`visits` module:**
  - Owns `visits`: id, `patient_id` (FK), `opd_date` (written once with `opdDate()`), `status`, `opened_at`, `closed_at`, `created_by`, `updated_at`.
  - `VisitStatus` is `open` | `in_queue` | `completed` | `directed_to_er` | `no_show` | `cancelled`, with a CHECK and one transition table in `visits/state.ts`:
    - `open` → `in_queue` | `directed_to_er` | `cancelled`;
    - `in_queue` → `completed` | `no_show` | `cancelled`;
    - the others are terminal.
  - Only `visits` changes a status; an invalid transition throws `invalid_transition`.
  - API: `open(tx, { patientId, actor, now })`, `transition(tx, id, to, now)`, and queries `visitsForPatient(patientId)` and `lastVisitDates(patientIds)`. `visits` never imports `patients`.
- **One active Visit:** a patient with a Visit today in `open` or `in_queue` can't be triaged again. The save is refused with `visit_already_open` "{Name} already has an open Visit today.", and the form shows it before the nurse starts.
- **`triage` module:** owns `triage_records`, with columns:
  - `visit_id` (unique FK) and `patient_id`;
  - `chief_complaint` (1–500 characters);
  - `temperature_c`, `bp_systolic`, `bp_diastolic`, `pulse`, `respiratory_rate`, `spo2` (optional), `weight_kg` (optional);
  - `abnormal_fields` (a JSON array);
  - the snapshot: `urgency_level_id`, `urgency_name`, `urgency_rank` (null for ER), `urgency_is_er`, `sort_group` (1/2/3; null for ER), `priority_category` (code or null), `priority_id_status` (`on_file` | `entered` | `not_presented` | null);
  - `recorded_by`, `recorded_at`.
- **Vital Sign ranges** live in one file, `src/lib/vital-signs.ts`, marked as an assumption for the nursing lead to confirm (PRD FR-7). Values outside the impossible limits are refused; values outside normal are flagged but saved.

  | Sign | Impossible outside | Normal |
  |---|---|---|
  | Temperature | 30–45 °C | 36.0–37.5 °C |
  | Systolic | 50–300 | 90–139 |
  | Diastolic | 20–200, and below systolic | 60–89 |
  | Pulse | 20–250 | 60–100 (adult) |
  | Respiratory rate | 4–80 | 12–20 (adult) |
  | SpO₂ | 50–100 % | 95 % and up |
  | Weight | 0.3–300 kg | not flagged |

  - Pulse and respiratory-rate normals are age-banded: under 1 year 100–160 / 30–60; 1–12 years 70–120 / 18–30.
  - Required: complaint, temperature, BP, pulse and respiratory rate. SpO₂ and weight are optional.
- **Snapshot rules** (AD-6):
  - `sort_group` is 1 when the level's rank is lower (more urgent) than the lowest active non-ER rank; otherwise 2 when an enabled Priority Category is chosen; otherwise 3.
  - The Urgency Levels and Categories are read through the settings getters at save time.
- **Priority Category:**
  - Only enabled categories are offered, plus "None". Pregnant is offered only for female patients.
  - Senior Citizen for a patient under 60 is refused ("Senior Citizen is for patients aged 60 and over.").
  - Senior Citizen or PWD with no ID on file requires either the ID (saved to the Patient Record through `patients` service `setPriorityId(tx, …)`) or ticking "ID not presented". The choice is stored in `priority_id_status`.
- **Command:** `recordTriage` in one `withCommandTx`: `visits.open`, then the Triage Record insert, then (when entered) the patient ID update. It writes one `triage.recorded` audit row: entity `visit`, with `patientId`, the snapshot and the ID choice. When an ID was entered, the row holds `{ seniorCitizenId|pwdId: { old, new } }`. Vital values and the complaint are not audited.
- **Permission:** `triage.record` (Triage Nurse, Admin).
- **Form (UX-DR11):**
  - Order: Chief Complaint → Vital Signs → Urgency Level → Priority Category. Tab follows it.
  - Vital fields are numeric with a unit suffix. BP is two fields.
  - An abnormal value gets the amber style, an icon and a hint (e.g. "Above normal (37.5 °C max)"). An impossible value gets a red error that blocks the save.
  - Urgency is a radiogroup in rank order with ER last. While it has focus, keys `1…n` pick a level. Badge colors come from the rank, with text.
  - `Ctrl+Enter` or **Save triage** saves. Afterwards a panel shows "Triage saved · Visit open, awaiting a Facility" with the level and category, and **Next patient** (Esc) clears the screen and focuses the finder.
  - First-error focus and the discard prompt behave as in 3.2 and 3.3.
- **Reads:**
  - The finder and `/patients` "last visit" come from `visits.lastVisitDates`.
  - The record page's Visit history lists date (Manila), status and Urgency Level, newest first, through the owners' queries.
  - No clinical values are shown to Facility Staff beyond this list.

**Never:**
- No Facility choice, Queue Number or ER handoff (Story 3.5).
- No slip.
- No editing a saved triage.
- No hard-coded Urgency Levels or Categories.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal save | valid form, Routine, None | Visit `open` (today's `opd_date`), Triage Record with `sort_group` 3, one audit row | N/A |
| Abnormal | temperature 39.2 | saved, `abnormal_fields` includes `temperatureC` | N/A |
| Impossible | temperature 93.2 | nothing saved | field error "Temperature must be between 30 and 45 °C." |
| Diastolic ≥ systolic | 120/130 | nothing saved | field error on diastolic |
| Urgent | rank 1 | `sort_group` 1, `urgency_rank` 1 | N/A |
| Senior, ID on file, age 72 | Senior Citizen | `sort_group` 2, `priority_id_status` `on_file` | N/A |
| Senior under 60 | age 45 | nothing saved | field error |
| PWD, no ID, not presented ticked | | saved, `not_presented` | N/A |
| PWD, ID typed | "PWD-123" | saved; the patient's `pwd_id` set; audit has old/new | N/A |
| Pregnant, male | | refused (not offered in UI; server rejects) | `invalid` |
| Disabled category | Pregnant turned off in settings | refused | `invalid` |
| Already open | an open Visit today | nothing saved | `visit_already_open` |
| Facility Staff | calls the action | nothing saved | `forbidden` |
| ER level chosen | Emergency | saved with `urgency_is_er` and `sort_group` null; the Visit stays `open` (the ER handoff is 3.5) | N/A |

</frozen-after-approval>

## Code Map

- `src/server/patients/{service,queries,actions}.ts`: `getRecordView` (fill `visits` from `visits` queries) and the finder row's `lastVisit`. Add `setPriorityId(tx, patientId, kind, value)` to the service (no audit of its own).
- `src/app/(staff)/patients/[id]/record-types.ts`: the Visit placeholder type becomes the real summary.
- `src/server/settings/queries.ts`: `urgencyLevels()` and `enabledPriorityCategories()`.
- `src/lib/age.ts` (`ageOn`), `src/lib/time.ts` (`opdDate`, `formatManila`).
- `src/app/(staff)/triage/triage-workspace.tsx`: replace the selected-patient card with `triage-form.tsx`. Keep "Open record" and registration.
- `src/components/form-parts.tsx`, `patient-fields.tsx`, `src/lib/field-errors.ts`: the form patterns.
- DESIGN tokens `urgent`, `routine`, `abnormal` in `src/app/globals.css` for the badges and the amber style.
- `deferred-work.md` (Story 3.1 item): add the jsdom test that picking a patient fills the form, and an `AppHeader` render test that Ctrl+K reaches the real inputs.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/visits/{schema,state,repo,service,queries}.ts` and `src/server/triage/{schema,repo,service,schemas,actions}.ts`, plus migration `0010_visits_triage`.
- [x] `src/lib/vital-signs.ts` (the ranges table, `checkVital`, messages) with tests.
- [x] `triage.record` permission and the `triage.recorded` audit action (entity `visit`), with tests.
- [x] `triage-form.tsx` + workspace wiring + the saved panel.
- [x] Record page Visit history and last visit in search, from `visits` queries.
- [x] Tests:
  - every I/O Matrix row (service + action);
  - the state machine: every allowed and forbidden transition;
  - the `sort_group` computation with custom settings (e.g. 4 levels);
  - jsdom: Tab order, number keys only while Urgency has focus, the amber and red states, Pregnant hidden for a male, the ID prompt, `Ctrl+Enter`, and Esc to the finder;
  - the deferred 3.1 items above.
- [x] `README.md`: triage, the ranges assumption, the visits and triage modules.

**Acceptance Criteria:**
- Given Lola Carmen (female, 72, Senior Citizen ID on file) selected, when the nurse types the complaint, tabs through the vitals (temperature 37.8 flagged amber), presses `2` on Urgency for Routine, picks Senior Citizen and presses `Ctrl+Enter`, then the Visit is Open with `sort_group` 2, and her record shows today's Visit.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Files: `src/server/visits/{schema,state,repo,service,queries}.ts` (+ `visits.test.ts`), `src/server/triage/{schema,repo,service,schemas,actions,queries}.ts` (+ `triage.test.ts`), `drizzle/0010_visits_triage.sql` (+ snapshot/journal), `src/lib/{vital-signs,triage,visit-status}.ts` (+ `vital-signs.test.ts`), `src/server/patients/{service,queries}.ts` (`getTriagePatient`, `setPriorityId`, Visit history in `getRecordView`, `lastVisit` from `lastVisitDates`), `src/server/audit/schema.ts` (`triage.recorded`, entity `visit`), `src/server/auth/permissions.ts` (+ test: `triage.record`), `src/server/db/schema-index.ts`, `src/components/urgency-badge.tsx`, `src/app/(staff)/triage/{triage-form.tsx (new), triage-workspace.tsx, page.tsx}` (+ `triage-form.test.tsx`), `src/app/(staff)/patients/[id]/{record-screen.tsx, record-types.ts}` (+ test), `src/components/app-header.test.tsx`, `README.md`, `deferred-work.md`.
- Interpretations: the form loads `getTriageContextAction` per pick (fresh levels/categories, sex, age, "ID on file" booleans only, open Visit today; guarded by `triage.record`, not audited). `visits.open` also refuses a second active Visit, and a partial unique index backs it; `recordTriage` checks first so the message carries the name. Schema files import `patients`/`settings`/`visits` tables for foreign keys only (the existing auth → settings pattern); `visits` code never imports `patients`. `patients.getRecordView` reads `triage.triageSummaries` (snapshot only, no vitals) for the Urgency column, so patients → triage/visits queries is a read-only dependency. `sort_group` for a level whose rank equals the lowest active non-ER rank uses that level's own rank when computing "lowest". Impossible vitals show red once the field is left (or on save); abnormal amber shows live. The urgency badge tone treats ER like rank 1 (`urgent`) with a siren icon. `setPriorityId` bumps `patients.updated_at`, so an Edit details sheet open at the same time gets `stale` (intended).
- Verified 2026-09-27: `npm run db:migrate` (dev) applied 0010; `npx tsc --noEmit` 0 errors; `npm run lint` 0 problems; `npm test` 820 tests (54 files) pass; `npm run build` OK. Manual (throwaway DB, `next start -p 3100`, Edge via playwright-core, 26 checks all PASS): keyboard-only AC flow (Rosario Cruz, 76, SC on file: complaint → Tab vitals, 37.8 amber with hint, `2` → Routine, Senior Citizen, Ctrl+Enter saved in ~41 ms, `sort_group` 2 / `on_file`, Next patient focused, Esc back to an empty finder); finder then shows the last visit and the open-Visit notice; impossible temperature and diastolic ≥ systolic red, first-error focus, nothing saved; Pregnant hidden for a male; PWD ID prompt, typed ID saved to the record with `pwdId {old,new}` in the one `triage.recorded` row; record page Visit history "Sep 27, 2026 · Open · Urgent"; no horizontal scroll and all form targets ≥ 44 px at 375 and 768 px.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | Plain Enter in a Vital Sign or ID input submits the form and saves the triage early (edge) | medium: a half-finished triage gets saved | patch (only Ctrl+Enter or the Save button saves) |
| 2 | A deactivated patient can be triaged through the actions (blind, edge) | medium | patch (refuse in `recordTriage` and `getTriageContext`) |
| 3 | Visit history recomputes the badge tone from today's Urgency Levels, so old Visits recolour after a settings change; the "lowest non-ER rank" logic is copied in 4 places (blind, verification-gap) | medium: breaks the AD-6 snapshot rule | patch (store `urgency_tone` in the snapshot through a new migration with backfill; one shared helper) |
| 4 | The saved panel's Esc listener is on `document`, so Esc in the header search resets the screen (blind) | medium | patch (scope it to the triage workspace) |
| 5 | A DB-level duplicate active Visit (unique index) returns a generic error | low | patch (map it to `visit_already_open`) |
| 6 | "Last visit" counts cancelled Visits | low | patch (exclude `cancelled`) |
| 7 | A server error on Priority Category focuses the "None" radio | low | patch (focus the refused option) |
| 8 | The triage context sends full level rows; `sex` is typed as string | low | patch |
| 9 | The README says keys `1…n`, but only 1–9 work | low | patch (README says 1–9) |
| 10 | An ID typed at triage doesn't revalidate `/patients/[id]` | low | patch (revalidate); the audit is already in the `triage.recorded` row with old/new, so keeping it there is intentional |
| 11 | `urgencyTone` routine/abnormal branches untested; "not dirty after save" untested (verification-gap) | medium | patch |
| 12 | The Possible-match `lastVisit` with a real Visit is untested (verification-gap) | low: display-only; the helper is covered through search | defer |
| 13 | No empty state when no Urgency Level is active | false: settings (Story 2.6) always keep at least one active non-ER level | reject |
| 14 | `recordedBy` falls back to "unknown" | false: `requireStaff()` always gives an id | reject |

Patches applied: #1–#11. Deferred: #12. Rejected: #13, #14.
One full run had the file's first test fail intermittently (it passed alone and on reruns): the cold import went past Vitest's 5 s default under parallel load. I set `testTimeout: 15_000` in `vitest.config.mts`.
Re-verified 2026-09-27: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 831 tests pass (55 files, two runs in a row), `npm run build` OK.

## Verification

**Commands:**
- `npm run db:migrate` (dev), `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright:
  - keyboard-only triage;
  - the abnormal and impossible states;
  - the ID prompt;
  - Visit history on the record;
  - 375 px and 768 px layouts.
