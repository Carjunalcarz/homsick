---
title: 'Story 3.2: Register a new patient'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '3-2-register-a-new-patient'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1-find-patients.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A nurse who can't find a patient has no way to create one, so the line stops.

**Approach:** Add a "New patient" row to the Triage finder that opens an inline registration form in the right column. Required fields are shown, optional ones are collapsed. The form has the privacy-notice checkbox and a possible-duplicate check. Saving creates the Patient Record with the next Hospital Number in one audited transaction, then selects the new patient. This follows epics.md Story 3.2, FR-5, PRIV-4 and UX-DR12/19.

## Boundaries & Constraints

**Always:**
- **Permission:** `patients.register` for Triage Nurse and Admin. The "New patient" row shows only for them; the action checks it again.
- **Finder:** the "New patient" row is always the last option, including when there are no results, and reachable with ↓ and Enter. Choosing it opens the form. If the query looks like a name ("dela cruz, juan" or "juan dela cruz"), the last and first names are prefilled.
- **Fields** (Zod on the server; the client mirrors the rules):
  - **Required:** last name, first name, sex (female/male radio), birthdate, barangay, municipality, contact number, and the "Privacy notice explained to the patient" checkbox.
  - **Optional, collapsed under "More details":** middle name, suffix, PhilHealth PIN, Senior Citizen ID, PWD ID, emergency contact name and number.
  - **Names:** 1–60 characters after trimming. Letters (any script, ñ included), spaces, `.`, `'` and `-`.
  - **Birthdate:** a real date from 1900-01-01 up to today in Manila; the future is refused.
  - **Contact number:** stored as digits in the `09XXXXXXXXX` form. `+63`/`63` is turned into `0`, and 7–11 digits are accepted (landlines included). The emergency number follows the same rule.
  - **PhilHealth PIN:** 12 digits, stored as `XX-XXXXXXXXX-X`.
  - **IDs:** free text, up to 30 characters.
- **Duplicate check:** an active patient with the same last name, first name (Unicode case-insensitive) and birthdate is a possible match. The action then returns `possible_match` with those matches (the slim finder row) unless the input has `confirmDuplicate: true`. The UI shows a "Possible match" card listing them, with:
  - **Use this record:** selects that patient and discards the form;
  - **Create anyway:** saves with the confirmation.
- **Command:** `createPatient` in one `withCommandTx`:
  - takes the Hospital Number from `nextHospitalNumber(tx, <Manila year>)` and inserts through the repo (which sets `search_text`);
  - sets `privacy_notice_at` to the save time and `created_by` to the actor;
  - writes one audit row `patient.created`, entity `patient` (added to `AUDIT_ENTITIES`), with the Hospital Number and every field set.
- **After save:** the new patient is selected in the workspace, and a status message announces "Registered DELA CRUZ, Juan · HN-2026-000043". The form closes and focus goes to the selected-patient card heading.
- **Form behavior:** field errors use `aria-describedby`, and focus goes to the first error on submit. Pending state disables Save. Esc (or Cancel) closes the form and returns focus to the finder. Controls are 44 px.

**Never:**
- No editing (Story 3.3).
- No photo or ID scans.
- No Hospital Number typed by hand.
- No audit of failed validations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid | all required fields, privacy ticked | patient created, next `HN-2026-…`, one audit row, selected | N/A |
| Missing privacy | checkbox not ticked | nothing created | field error "Confirm the privacy notice was explained." |
| Future birthdate | tomorrow (Manila) | nothing created | field error "Birthdate can't be in the future." |
| Impossible date | 1990-02-30 | nothing created | field error "Enter a real date." |
| Phone forms | `+63 917 123 4567` | stored `09171234567` | N/A |
| Duplicate | same last/first/birthdate as an active patient | `possible_match` with the matches, nothing created | card shown |
| Duplicate confirmed | same, with `confirmDuplicate: true` | created | N/A |
| Facility Staff | calls the action | nothing created | `forbidden` |
| Year rollover | first save in 2027 | `HN-2027-000001` | N/A |

</frozen-after-approval>

## Code Map

- `src/server/patients/repo.ts`: `nextHospitalNumber`, `insertPatient` (sets `search_text`), `patientSearchText`. `queries.ts` has the slim finder row type.
- `src/server/patients/actions.ts` / `schemas.ts`: add `registerPatientAction` (Zod, then `requireStaff`, then `can("patients.register")`, then `createPatient`). Follow the result shape and `fieldErrorsOf` pattern in `src/server/settings/actions.ts`.
- `src/server/patients/service.ts` (new): `createPatient`, `findPossibleMatches(tx, …)`.
- `src/lib/patient-search.ts`: phone normalization and the name-guess helpers to reuse.
- `src/server/audit/schema.ts`: add `PatientCreated` "patient.created", its label, and the entity `patient` with its label.
- `src/server/auth/permissions.ts` (+ tests): add `patients.register`.
- `src/app/(staff)/triage/patient-finder.tsx`, `triage-workspace.tsx`: add the row, and a new `registration-form.tsx`. Reuse the form pieces in `src/app/(staff)/admin/settings/settings-ui.tsx` and `src/lib/focus.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `patients/service.ts` + `schemas.ts` + `actions.ts`: `createPatient`, the duplicate check and `registerPatientAction`.
- [x] Audit action and entity; `patients.register` permission with tests.
- [x] The finder's "New patient" row, the `registration-form.tsx` inline form with the collapsed optional section, the Possible match card, and the workspace wiring.
- [x] Tests:
  - every I/O Matrix row (service + action);
  - Hospital Numbers stay sequential when two creates run one after another in the same transaction pattern;
  - the form with jsdom: first-error focus, the collapsed section, the Possible match flow (Use this record / Create anyway), and Esc back to the finder;
  - the "New patient" row is keyboard reachable, and hidden for Facility Staff.
- [x] `README.md`: registration rules.

**Acceptance Criteria:**
- Given no match for "Reyes, Ana", when the nurse presses ↓ to "New patient" and Enter, then the form opens with Last name "Reyes" and First name "Ana" filled, the optional fields collapsed, and focus on the first empty required field.
- Given a saved registration, when the finder searches the new Hospital Number, then the patient is found.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Files: `src/lib/patient-registration.ts` (new: the one Zod schema, shared by the action and the form's pre-submit check), `src/lib/patient-search.ts` (`normalizeContactNumber`, `guessNameFromQuery`, `PERSON_NAME_PATTERN`), `src/server/patients/{service.ts (new), actions.ts, schemas.ts, queries.ts}` (+ `register.test.ts`), `src/server/audit/schema.ts`, `src/server/auth/permissions.ts` (+ test), `src/app/(staff)/triage/{page,triage-workspace,patient-finder,registration-form}.tsx` (+ `registration-form.test.tsx`, finder and page tests), `README.md`.
- `PatientFinderRow`/`toFinderRow` moved to `queries.ts` (re-exported as a type from `actions.ts`); `selectPossibleMatches` there compares `unicode_lower(trim(name))` with the folded input.
- `createPatient` runs the duplicate check inside the `withCommandTx`; a possible match throws an internal error that rolls the transaction back (no number, no audit row) and is turned into `{ status: "possible_match", matches }`. `registerPatientAction` returns `ok: true` with `status: "created" | "possible_match"`.
- Interpretations: a bare `63` is read as a country code only on a 12-digit number (`63` + 10); any other `+` country code is refused. A one-word query prefills only the last name; an all-lower/all-upper query is title-cased. The audit row also lists `possibleMatchesConfirmed` (the matched Hospital Numbers) when "Create anyway" was used. Addresses are limited to 100 characters (the spec gives no limit).
- Facility Staff can't open `/triage` at all (`triage.view`), so the hidden row is covered by the finder test without `onNewPatient` and the page passing `canRegister`.
- Review fixes (coordinator, 2026-09-27): `confirmDuplicate` replaced by `confirmedMatchIds` (the ids on the card; an unseen match asks again with the full list); a "Discard this registration?" AlertDialog guards Esc, Cancel, a finder pick and New patient when the form is dirty; a save that lands after the form closed is ignored by the UI; contact numbers drop a trunk 0 after +63/63 and add the 0 to a 10-digit 9… number; names and name folds are NFC; birthdate `min="1900-01-01"` with "Birthdate must be 1900 or later."; shared form pieces moved to `src/components/form-parts.tsx` and `fieldErrorsOf` to `src/lib/field-errors.ts` (settings, staff and triage import them).
- Verified 2026-09-27 (before the review fixes): `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 661 tests (45 files) pass, `npm run build` OK. Manual (throwaway DB, `next start -p 3100`, Edge via Playwright): keyboard-only registration of "Reyes, Ana" (prefill, focus on Sex, first-error focus, save 33 ms, HN-2026-000043 announced, focus on the card heading, found by HN in the finder), duplicate card with focus on its heading and Create anyway → 000044, Esc back to the finder, Facility Staff get "No access", no page-level horizontal scroll and all form controls ≥ 44 px at 375 and 768 px.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | "Create anyway" is a bare boolean, so it also confirms matches the nurse never saw (e.g. one registered meanwhile) (blind, edge) | medium | patch (send the shown match ids; re-return `possible_match` if others appear) |
| 2 | A half-filled form is discarded without warning (Esc, Cancel, a finder pick, New patient again) (blind, edge) | medium: data loss at a busy desk | patch (ask "Discard this registration?" when fields have changed) |
| 3 | A pending save that returns after the form closed still selects the new patient and moves focus | low | patch (ignore a result for a closed form; the patient stays registered and findable) |
| 4 | `(+63) 0917…` becomes 12 digits and is refused; `632…` and `917…` are stored in forms other than `0…` (blind, edge) | low: weakens phone search | patch (normalize to the `0…` form) |
| 5 | Names aren't NFC-normalized, so a decomposed "ñ" misses matches | low: a direct correction | patch |
| 6 | The date input has no `min`; a pre-1900 date says "Enter a real date." | low | patch (`min="1900-01-01"` and a message "Birthdate must be 1900 or later.") |
| 7 | The triage form imports its form helpers from `admin/settings/settings-ui`; the action imports `fieldErrorsOf` from the settings module; `firstErrors` is a copy | medium: patients code depends on admin settings UI and two copies can drift | patch (move them to shared `src/components` / `src/lib` modules; update settings, staff and triage imports) |
| 8 | `guessNameFromQuery` uses a literal 60 instead of `PATIENT_NAME_MAX` | low | patch |
| 9 | Possible match with ñ/accents in a different case is untested (verification-gap) | medium | patch |
| 10 | The `hospital_numbers_exhausted` action path is untested (verification-gap) | medium | patch |
| 11 | The form's form-level error for failed and network errors is untested (verification-gap) | medium | patch |
| 12 | The stored side of the match check doesn't collapse inner spaces | low: every writer collapses them | reject |
| 13 | A lost response followed by a retry can give a duplicate | low: rare; the match card shows the new record | reject |
| 14 | Emergency contact name/number not required together | low: the PRD makes the contact optional as a whole | reject |
| 15 | The name guess splits two-word first names wrongly | low: the prefill is editable | reject |
| 16 | The `patient.created` audit row holds IDs and contact data | false: the audit log is Admin-only by design and holds field values (PRIV-2); the "never in logs" rule is about app logs | reject |
| 17 | Fragile tests (hard-coded `reg-sex-female`, a `canRegister` prop probe); no failed-finder or `requireStaff`-throws test | low | reject |

Patches applied: #1–#11. Rejected: #12–#17. Nothing deferred. Deviation: finding #1 replaces the frozen intent's `confirmDuplicate: true` with `confirmedMatchIds` (the ids shown on the card). It is stricter, with the same intent. The human can update the frozen wording when approving.
Re-verified 2026-09-27: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 677 tests pass (45 files), `npm run build` OK. The browser check (28 steps) ran before the patches.

## Verification

**Commands:**
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright:
  - register a patient by keyboard only;
  - trigger the duplicate card;
  - check that a Facility Staff user sees no "New patient" row;
  - no page-level horizontal scroll at 375 px and 768 px.
