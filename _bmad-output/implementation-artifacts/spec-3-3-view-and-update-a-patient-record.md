---
title: 'Story 3.3: View and update a patient record'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '3-3-view-and-update-a-patient-record'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-2-register-a-new-patient.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff can find a patient but can't open the full record or correct wrong details. Nothing records who looked at a record, although privacy law requires it (PRIV-2).

**Approach:** Add `/patients/[id]`, loaded through `patients.getRecordView()`. It shows demographics, IDs and Visit history (empty until Story 3.4), and each view writes a `patient.viewed` audit row. Triage Nurses and Admins can edit demographics in a sheet; the save is audited with old and new values. Facility Staff see the record read-only. There is no delete anywhere. This follows epics.md Story 3.3, FR-6, PRIV-2, NFR-12 and AD-3.

## Boundaries & Constraints

**Always:**
- **Permissions:** `patients.view` (all Roles) opens the page. A new `patients.edit` (Triage Nurse, Admin) is needed to edit; the action checks it again.
- **`getRecordView(id, actor)`:**
  - Runs only after the permission check. It returns the full record, `age`, `visits: []` (Story 3.4 fills these through `visits` queries) and the formatted name.
  - Writes one `patient.viewed` row (entity `patient`, `entityId` = id, no field values) through `withCommandTx`.
  - An unknown id gives `notFound()` with no audit row.
  - A deactivated patient still opens, with a "Deactivated" badge (no UI deactivates a patient yet).
- **Links to the record:** `/patients` rows (name as the link), the finder's selected-patient card ("Open record") and the post-registration card. All use `prefetch={false}`, because a render writes an audit row.
- **Page:**
  - Title "Patient record | OPD". The name isn't in the browser tab, since tabs are visible on shared screens.
  - Header: the formatted name, Hospital Number (mono), age, sex and birthdate.
  - Sections: Contact & address, IDs (PhilHealth PIN, Senior Citizen ID, PWD ID), Emergency contact, Privacy notice (the Manila time it was explained), and Visit history (an empty state "No visits yet.").
  - Missing optional values show "—" with sr-only "Not recorded".
- **Edit:**
  - An **Edit details** button, only for `patients.edit`, opens a Sheet with the registration fields, pre-filled. It has no privacy checkbox; `privacy_notice_at` never changes.
  - It reuses the Story 3.2 schema rules (NFC names, phone normalization, PhilHealth PIN format, birthdate range) and the shared form parts.
  - If the new name and birthdate match another active patient, it returns `possible_match` with the `confirmedMatchIds` flow, the same as 3.2.
- **`updatePatient` command:**
  - Runs in `withCommandTx`: loads the row, compares the fields, and saves through the repo's `updatePatient`, which recomputes `search_text` and sets `updated_at`.
  - Writes one `patient.updated` audit row with `{ field: { old, new } }` for the changed fields only.
  - A save with no changes writes nothing and returns `changed: false`. The Hospital Number, `created_*` and `privacy_notice_at` can't be changed.
- **After save:** the page revalidates, a status message says "Saved changes to DELA CRUZ, Juan." (or "No changes."), and focus returns to Edit details. The form behavior matches 3.2: first-error focus, pending state, and asking before discarding changes.
- **No delete:** no delete control, and no delete action exists.

**Never:**
- No Visit, triage or appointment data beyond the empty history.
- No deactivate or merge UI.
- No audit row for failed validations.
- No patient name in `<title>` or in app logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| View | nurse opens an existing record | page renders, one `patient.viewed` row | N/A |
| Unknown id | `/patients/nope` | 404, no audit row | N/A |
| Facility Staff | opens a record | read-only, no Edit details, one view row | N/A |
| Edit contact | nurse changes the contact number | saved in normalized form; `patient.updated` with only `contactNumber` old/new | N/A |
| No change | Save without edits | nothing written, "No changes." | N/A |
| Rename to a duplicate | name and birthdate of another active patient | `possible_match`, nothing saved | card shown |
| Forbidden edit | Facility Staff call the action | nothing saved, no audit row | `forbidden` |
| Unknown id edit | the action with a missing id | nothing saved | `not_found` |

</frozen-after-approval>

## Code Map

- `src/server/patients/{service,queries,repo,actions,schemas}.ts`: `createPatient`, `findPossibleMatches`, the repo's `updatePatient(tx, id, changes)` (recomputes `search_text`), and `registerPatientAction`, whose pattern to mirror.
- `src/lib/patient-registration.ts`: the shared Zod rules. Derive an edit schema from it: no privacy field, and an id added.
- `src/components/form-parts.tsx`, `src/lib/field-errors.ts`, `src/lib/focus.ts`: shared form pieces.
- `src/app/(staff)/triage/registration-form.tsx`: reuse its field components or extract them, so registration and edit render the same fields.
- `src/app/(staff)/patients/patients-screen.tsx`: make the row name a link. `triage-workspace.tsx`: add the "Open record" link.
- `src/server/audit/schema.ts`: add `patient.viewed` and `patient.updated` with labels.
- `src/server/auth/permissions.ts` (+ tests): add `patients.edit`.
- `src/app/(staff)/admin/audit/*`: the pattern for "a page render writes an audit row" and its tests.

## Tasks & Acceptance

**Execution:**
- [x] Server: `getRecordView`, `updatePatient` (service), `updatePatientAction`, the edit schema, the audit actions and `patients.edit`.
- [x] `src/app/(staff)/patients/[id]/page.tsx` + the record screen + the edit sheet. Share field components with the registration form.
- [x] Links from `/patients`, the finder card and the post-registration card, with `prefetch={false}`.
- [x] Tests:
  - every I/O Matrix row;
  - the audit `changes` holds only the changed fields;
  - `search_text` is updated after a rename (the finder finds the new name);
  - the page test: title, Edit details only for editors, `notFound` for an unknown id;
  - the edit sheet with jsdom: prefill, first-error focus, and the discard prompt.
- [x] `README.md`: the record page, view auditing and edit rules.

**Acceptance Criteria:**
- Given Juan's record opened by a Triage Nurse, when they change his barangay and save, then the page shows the new barangay, and the audit log has one `patient.viewed` row per page render plus one `patient.updated` row with the barangay's old and new values.
- Given any record, when anyone looks for a delete control, then there is none.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Files: `src/lib/patient-registration.ts` (shared `demographicFields`; new `patientEditSchema`, `PATIENT_EDIT_FIELDS`), `src/server/patients/{service.ts (getRecordView, updatePatient), actions.ts (updatePatientAction), queries.ts (selectPatientRecord; selectPossibleMatches excludeId), repo.ts (updatePatient sets updated_at, ignores protected columns; PatientError.NotFound), schemas.ts}` (+ `record.test.ts`), `src/server/audit/schema.ts`, `src/server/auth/permissions.ts` (+ test), `src/components/patient-fields.tsx` (new: `PatientFields`, `PossibleMatchCard`, shared with registration), `src/app/(staff)/triage/{registration-form,triage-workspace}.tsx`, `src/app/(staff)/patients/patients-screen.tsx`, `src/app/(staff)/patients/[id]/{page.tsx, record-screen.tsx, edit-patient-sheet.tsx, record-types.ts}` (+ `page.test.ts`, `record-screen.test.tsx`), `README.md`.
- Interpretations: the possible-match check runs only when the last name, first name or birthdate changed (a contact edit on a record already confirmed as a duplicate never asks); the patient never matches themself. The `patient.updated` row holds only `{ field: { old, new } }` (no `possibleMatchesConfirmed`, unlike registration). A missing or over-long id returns `not_found`. The "Open record" link lives on the Triage selected-patient card, which is also the post-registration card. The edit sheet opens "More details" when an optional field has a value; the possible-match card in the sheet has **Save anyway** and no "Use this record". Display strings (birthdate, age, privacy time) are formatted on the server.
- Verified 2026-09-27: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 712 tests (48 files) pass, `npm run build` OK. Manual (throwaway DB copy, `next start -p 3100`, Edge via Playwright): record opened from `/patients` (keyboard) and from the finder's Open record; title "Patient record | OPD"; keyboard edit of the barangay saved in ~90 ms with "Saved changes to …", focus back on Edit details and the new barangay shown; "No changes." save; discard prompt; unknown id 404; Facility Staff see it without Edit details; no page-level horizontal scroll and sheet controls ≥ 44 px at 375 and 768 px. Audit: one `patient.viewed` per render (none for the unknown id, no field values), and each `patient.updated` held only `addressBarangay` old/new.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | Concurrent edits: the sheet sends every field, so a second editor silently reverts the first editor's changes, and the audit row blames them (blind, edge) | medium | patch (send the `updatedAt` the form opened with; return `stale` if it changed) |
| 2 | `revalidatePath` after a no-change or `possible_match` save re-renders the page and writes a false `patient.viewed` row (blind, edge) | medium: PRIV-2 accuracy | patch (revalidate only after a real change) |
| 3 | Record links' `prefetch={false}` and `href` untested; links encode the id but revalidation doesn't (verification-gap, blind) | medium: a regression would log views nobody made | patch (one `PatientRecordLink` / `patientRecordPath` helper, with a test) |
| 4 | The `updated_at` assertion can't fail (verification-gap) | medium | patch (fixed `now`, exact value) |
| 5 | The dirty check compares against the live `record.sex`, not the opening snapshot | low | patch |
| 6 | The Visit type is defined twice; `EDIT_FIELD_ORDER` can drift from the field list | low | patch |
| 7 | The effect in `EditForm` re-runs on every render (inline `onDirtyChange`) | low | patch (`useCallback`) |
| 8 | The README has grammar slips, and doesn't say `patient.updated` audit rows keep old and new demographic values (Admin-visible) | low | patch |
| 9 | The sheet's network-error and pending-guard paths are untested | low | patch |
| 10 | Revalidation after a no-change save is unasserted (verification-gap) | low: superseded by #1 and #2 | reject |
| 11 | Editing a deactivated patient has no rule | low: nothing can deactivate a patient yet | reject |
| 12 | Parsing runs before the permission check, so a forbidden caller can get field errors | false: AD-3 fixes the order Zod → `requireStaff` → `can`; field errors reveal only the input rules | reject |

Patches applied: #1–#9. Rejected: #10–#12. Nothing deferred.
Re-verified 2026-09-27: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 721 tests pass (49 files), `npm run build` OK. The browser check (20 steps) ran before the patches.

## Verification

**Commands:**
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright:
  - open a record from `/patients` and from the finder;
  - edit and save by keyboard;
  - Facility Staff see it read-only;
  - check the audit rows;
  - no page-level horizontal scroll at 375 px and 768 px.
