---
title: 'Story 3.6: Print the queue slip'
type: 'feature'
created: '2026-09-28'
status: 'in-review'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '3-6-print-the-queue-slip'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5-issue-a-queue-number-or-direct-to-the-er.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The nurse sees the Queue Number on screen, but the patient leaves with nothing to match against the waiting-area board.

**Approach:**
- Add a print-only page `/print/slip/[entryId]`. It shows the hospital name, the Facility, the large Queue Number, the issue date and time, and "Please wait for your number on the screen.", with no patient data.
- Lay it out to fit 58 mm, 80 mm and A4 paper.
- Add **Print slip** to the issue banner. It is focused, so Enter prints, and it prints through a hidden iframe without leaving `/triage`.
- Take the hospital name from a new Admin setting.

This follows epics.md Story 3.6, FR-8 and UX-DR17.

## Boundaries & Constraints

**Always:**
- **Route:** `src/app/print/slip/[entryId]/page.tsx`, outside the `(staff)` shell: no header, no session guard UI, no skip link.
  - It still requires a staff session (`requireStaff`) and `triage.record`. A denied user gets a minimal "You don't have access to this page." and no data. An unknown id gives `notFound()`.
  - It isn't audited: the slip holds no patient data.
- **Content** (read through `queue` queries, labels from stored columns only):
  - the hospital name;
  - the Facility name;
  - `formatQueueNumber(prefix, seq)` in a very large mono bold face;
  - the entry's `entered_at` as Manila date and time (e.g. "Sep 28, 2026 · 8:14 AM");
  - "Please wait for your number on the screen.";
  - nothing else: no name, Hospital Number, complaint, priority, group or urgency.
- **Hospital name:** a new `hospital_name` on the `opd_settings` row (migration, default "Hospital OPD", 2–80 characters). It is read through a settings getter and editable by Admins in the OPD Settings "Queue and prenatal" section as "Hospital name (printed on slips)". It is audited like the other thresholds.
- **Print layout:**
  - Uses `@page { margin: 0 }` and a fluid single column that fills the page width.
  - Text sizes scale with the page width (`vw`) and are clamped, so the number never wraps or clips at 48 mm printable width (58 mm roll), 72 mm (80 mm roll) or A4. On A4 the slip is a centered box near the top.
  - Black on white, no background colors; the screen view looks the same.
  - A visually hidden `<h1>`, and page title "Queue slip | OPD".
- **Printing from triage:**
  - The banner gets **Print slip** (primary, focused once the banner appears, so Enter prints).
  - Clicking it loads the slip in a hidden `<iframe>` and calls `print()` on it once loaded. While loading the button says "Preparing…". If loading fails, "Couldn't load the slip. Try again." appears.
  - Pressing it again reprints. **Next patient** (Esc) stays.
- **Paper-number and ER outcomes** print nothing.

**Never:**
- No patient identifiers on the slip.
- No printer drivers or ESC/POS.
- No PDF generation.
- No reprint list (Facility screens in Epic 4 may add one).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slip | a nurse opens `/print/slip/<id>` | the hospital name, Facility, `CN-014`, Manila date and time, and the wait line | N/A |
| No PII | any entry | the HTML has no patient name, Hospital Number, complaint, category or urgency | N/A |
| Unknown | a bad id | 404 | N/A |
| Facility Staff | opens it | no-access text, no data | N/A |
| Signed out | no session | redirect to sign-in (the proxy and `requireStaff`) | N/A |
| Hospital name edit | an Admin sets "Ospital ng Maynila" | the next slip shows it; one audit row | N/A |
| Enter after issue | the banner shows | Print slip is focused; Enter triggers the iframe print | N/A |

</frozen-after-approval>

## Code Map

- `src/server/queue/queries.ts`: add `getSlip(entryId)` → `{ facilityName, prefix, seq, enteredAt }`. Read the Facility name through `settings` queries.
- `src/lib/queue-number.ts` (`formatQueueNumber`), `src/lib/time.ts` (`formatManila`).
- `src/server/settings/{schema,queries,service,schemas,actions}.ts` + `src/app/(staff)/admin/settings/opd-thresholds-section.tsx`: extend the `opd_settings` row and its form. `src/lib/clinical-settings.ts` holds the limits.
- `src/app/(staff)/triage/triage-form.tsx`: the `IssuedBanner`. Move focus from Next patient to Print slip.
- `src/proxy.ts`: check that `/print/*` is covered by the signed-out redirect.
- `src/components/forbidden.tsx`: the pattern for the no-access text. The print page needs its own minimal version without the shell.
- `src/app/globals.css`: the `queue-number-issued` style. Add slip print styles (a scoped stylesheet or module CSS).

## Tasks & Acceptance

**Execution:**
- [x] Migration adding `opd_settings.hospital_name`, plus the getter, the service/schema/action, the settings form field and its tests.
- [x] `getSlip` + `src/app/print/slip/[entryId]/page.tsx` (+ layout if needed) + print CSS.
- [x] Print slip in the banner (hidden iframe print, focus, loading and error states).
- [x] Tests:
  - every I/O Matrix row: the page test checks the rendered text and that no PII appears;
  - the iframe print with jsdom, using a mocked `contentWindow.print`;
  - the settings field.
- [x] `README.md`: slips, paper sizes and the hospital name setting.

**Acceptance Criteria:**
- Given `CN-014` just issued, when the nurse presses Enter, then the print dialog opens with a slip showing the hospital name, "Consultation", "CN-014", the date and time, and the wait line, and nothing identifying the patient.
- Given the slip printed at 58 mm, 80 mm and A4 (checked with Playwright PDF output at those widths), when viewed, then the number is whole and on one line.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Files: `drizzle/0014_hospital_name.sql` (+ snapshot/journal; drizzle-kit's generated copy selected the not-yet-existing column, fixed by hand), `src/server/settings/{schema,queries,service,schemas}.ts` (`hospital_name` + CHECK 2–80 trimmed; `OpdThresholds.hospitalName`; getter `hospitalName()`; `updateOpdThresholds` diffs it with the thresholds, one `settings.opd_thresholds_updated` row), `src/lib/clinical-settings.ts` (limits, message), `src/app/(staff)/admin/settings/opd-thresholds-section.tsx` (field "Hospital name (printed on slips)"), `src/server/queue/{repo,queries}.ts` (`selectQueueEntry`, `getSlip`), `src/server/triage/service.ts` (`IssuedNumber.entryId`), `src/lib/queue-number.ts` (`SLIP_WAIT_LINE`, `SLIP_MARKER_ATTRIBUTE`, `slipPath`), `src/lib/time.ts` (`formatSlipDateTime`), `src/app/print/slip/[entryId]/{page.tsx,slip.module.css}`, `src/app/(staff)/triage/{print-slip.tsx,triage-form.tsx}`, `README.md`.
- Tests: `src/app/print/slip/[entryId]/page.test.tsx` (real temp DB; every I/O row incl. no-PII and the hospital-name edit), `src/app/(staff)/triage/print-slip.test.tsx` (jsdom iframe, mocked `contentWindow.print`, loading/error/timeout/reprint/unmount), `triage-form.test.tsx` (Enter prints; focus on Print slip; ER and paper outcomes have no Print slip), `opd-thresholds-section.test.tsx`, `clinical.test.ts` (field rules, audit), `migrations.test.ts` (0014), `queue.test.ts` (`getSlip`), `time.test.ts`, `proxy.test.ts` (`/print/*` redirect).
- Interpretations: `hospitalName` is optional in the thresholds action schema (left out, the stored name is kept) so older callers still validate; the form always sends it. Inner whitespace is collapsed. The slip page needs `triage.record` (Triage Nurse, Admin). A paper entry (`is_paper`) has no slip (404); ids over 64 characters are a 404 without a query. The iframe treats a load without the `data-queue-slip` marker (404, no access, sign-in page) as a failure, plus a 20 s timeout; the frame stays in the DOM until the next print or unmount (removing it during `print()` can cancel the job). On wide pages (≥110 mm) the slip is a bordered box, max 96 mm wide, 12 mm from the top. The denied page title is "No access" (like other pages).
- Verified 2026-09-28: `npm run db:migrate` (dev) applied 0014; `npx tsc --noEmit` 0 errors; `npm run lint` clean; `npm test` 910 tests (59 files) pass (one unrelated intermittent failure in `record-screen.test.tsx` on one full run, passed alone and on the next full run); `npm run build` OK. Manual (throwaway DB, `next start -p 3100`, Edge via playwright-core, all PASS): signed-out slip → sign-in; CN-001 issued, Print slip focused, Enter printed the hidden iframe (52 ms) while staying on /triage, printed text exactly the five lines, no name/HN/complaint/urgency/contact in the HTML; Enter again reprints; title "Queue slip | OPD"; print-media at 48 mm, 72 mm and A4 widths the number is whole on one line (also a worst-case "CQX-1000"); `page.pdf()` at 48 mm, 72 mm and A4 viewed; dark theme stays black on white; Admin edit to "Ospital ng Maynila" shows on the next slip with one audit row; unknown id 404.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run db:migrate` (dev), `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright:
  - issue a number and print the slip;
  - render `page.pdf()` at 58 mm, 80 mm and A4 widths and view the images;
  - edit the hospital name.
