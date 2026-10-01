---
title: 'Story 3.5: Issue a queue number or direct to the ER'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '3-5-issue-a-queue-number-or-direct-to-the-er'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-record-triage-for-a-visit.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Triage ends with the Visit *Open* and nowhere to go. Patients get no Queue Number and no place in line, and Emergency cases aren't closed as *Directed to ER*.

**Approach:**
- Add a Facility step to the triage form: tiles with waiting counts; closed and not-live tiles are disabled with the reason.
- Extend the 3.4 save into one IMMEDIATE transaction that saves the Visit and Triage Record, issues the Facility's next Queue Number and writes one audit row. The result shows in a cyan banner with "N ahead".
- An ER-flagged level instead asks for confirmation and closes the Visit as *Directed to ER* with no number.
- Create the `queue` module with its counters, entries and the single ordering function.

This follows epics.md Story 3.5, FR-8, FR-9, NFR-4, AD-3, AD-5, AD-6, AD-13 and UX-DR11.

## Boundaries & Constraints

**Always:**
- **`queue` module:**
  - Owns `queue_counters(facility_id, opd_date, last_seq)` (PK on both) and `queue_entries`.
  - `queue_entries` columns: id, `visit_id` (FK), `facility_id`, `opd_date`, `prefix`, `seq`, `status` (CHECK: `waiting`, `called`, `serving`, `completed`, `referred`, `no_show`, `cancelled`), `sort_group`, `urgency_rank`, `urgency_level_id`, `priority_category`, `entered_at`, `call_count` (0), `is_paper` (0), `created_by`, `updated_at`. UNIQUE(`facility_id`, `opd_date`, `seq`).
  - `issue(tx, { visitId, facilityId, snapshot, actor, now })` takes the next `seq` from the counter (insert or increment in the same transaction). It stores `prefix = effectivePrefix(facility, now)`, copies the snapshot and sets `entered_at = now`.
  - Exactly one repo function, `liveQueue(db, facilityId, opdDate)`, reads a queue. It filters status in (waiting, called, serving), `is_paper = 0` and today's `opd_date`, and orders by `sort_group, urgency_rank, entered_at, id`.
  - `aheadOf(entry)` = the waiting and called entries before it in that order.
  - `waitingCounts(opdDate)` gives the count per Facility.
  - `formatQueueNumber(prefix, seq)` (in `src/lib`) pads to 3 digits, e.g. `CN-014`, `CN-1000`. It is the only label maker.
- **Visit state:** `visits.transition(tx, id, "in_queue")` after issuing, or `"directed_to_er"` (with `closed_at`) for ER.
- **One command:** `recordTriage` takes either `facilityId` (non-ER levels) or `directToEr: true` (ER levels only; the confirmation). The server refuses any other combination (`invalid`).
  - **Non-ER:** Visit + Triage Record + Queue Entry + transition.
  - **ER:** Visit + Triage Record + transition to `directed_to_er`.
  - Either way it writes one `triage.recorded` audit row, whose `changes` add `outcome` (`queued` | `directed_to_er`), `facilityId`, `queueNumber` and `ahead`.
- **Facility availability** (checked on the server too): the tiles are the active Facilities in display order.
  - Live and open now (`isOpen`): selectable, and each shows "{n} waiting".
  - Not live but open now: selectable, "Paper number (not live yet)" (see the paper-number rule below; amended 2026-09-28).
  - Closed: disabled, "Closed, opens {weekday} {time}" (the next opening, Manila time).
  - The server refuses a closed, not-live or deactivated Facility with `facility_unavailable` "{Facility} isn't taking patients now."
- **Form:**
  - The Facility tiles come after Priority Category, as a radiogroup (arrow keys; Tab enters and leaves the group).
  - The primary button is **Issue queue number** (green, `Ctrl+Enter`). When an ER level is selected, the tiles are hidden and the button becomes **Direct to ER** (red).
  - Direct to ER opens an AlertDialog: "Direct {Name} to the Emergency Room? No queue number will be issued and the Visit closes." Confirm and Cancel.
- **Results:**
  - **Issued:** a cyan banner with the number in the `queue-number-issued` style, "{Facility} · {N} ahead" (or "Next in line"), and the level and category. **Next patient** is focused (Esc too). Story 3.6 adds Print slip and moves the focus to it.
  - **ER:** a red-outlined panel "Directed to ER · Visit closed {h:mm AM}", with **Next patient** (Esc).
  - Esc clears the screen and returns focus to the finder (scoped to the workspace, as in 3.4).
- **Old flow:** the 3.4 "Save triage" without a Facility goes away. Every triage now ends queued, Directed to ER, or given a paper number for a not-live Facility.
- **Paper number for a not-live Facility** (PRD §10 pilot; amended 2026-09-28 under delegated approval):
  - An active, open-now Facility that isn't live stays selectable, labelled "Paper number (not live yet)".
  - Choosing it saves the Visit and Triage Record, stores the Facility on the Triage Record (`paper_facility_id`), creates no Queue Entry, and leaves the Visit `open`.
  - The audit `outcome` is `paper_number`.
  - The result panel says "Triage recorded · Give a paper number for {Facility}".

**Never:**
- No Facility queue screens, calling or serving (Epic 4).
- No display board (Epic 5).
- No slip (Story 3.6).
- No reordering by hand.
- No paper entries (Epic 7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First of the day | Consultation, no entries today | `CN-001`, "Next in line"; Visit `in_queue` | N/A |
| Sequence | 13 issued today | `CN-014` | N/A |
| New day | yesterday up to `CN-040` | today starts at `CN-001` | N/A |
| Prefix change pending | new prefix from tomorrow | today still uses the old prefix | N/A |
| Senior after 3 Routine | Routine ×3, then a Senior | the Senior is first in `liveQueue`; "0 ahead" | N/A |
| Same group | two Routine | arrival order | N/A |
| Urgent vs Senior | a Senior waiting, then an Urgent | Urgent first | N/A |
| Concurrency | two workers issuing 25 each, same Facility | 50 distinct, consecutive seqs, no errors | busy_timeout absorbs it |
| Closed Facility | outside hours | nothing saved | `facility_unavailable` |
| Not-live Facility | `is_live` off | nothing saved | `facility_unavailable` |
| ER | Emergency with `directToEr` | Visit `directed_to_er` with `closed_at`, no Queue Entry | N/A |
| ER without confirmation | Emergency with a `facilityId` | nothing saved | `invalid` |
| Non-ER with no Facility | | nothing saved | field error "Choose a Facility." |

</frozen-after-approval>

## Code Map

- `src/server/triage/{service,schemas,actions}.ts` + `src/lib/triage.ts`: `recordTriage` and the schema to extend (the one transaction).
- `src/server/visits/{state,service}.ts`: `transition`.
- `src/server/settings/queries.ts`: `listFacilities`, `liveFacilities`, `isOpen`, `effectivePrefix`. Add a helper `nextOpening(facility, instant)` for the "opens …" text.
- `src/app/(staff)/triage/triage-form.tsx`, `triage-workspace.tsx`: the saved panel becomes the issue banner and the ER panel.
- The `queue-number-issued` style and banner tokens are in `src/app/globals.css` (Story 2.1).
- `drizzle/` for the new migration. `src/server/db/schema-index.ts`.
- For the concurrency test use `node:worker_threads` or child processes with separate better-sqlite3 connections to one temp file. `busy_timeout` is 5000.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/queue/{schema,repo,service,queries}.ts` + migration (next number) + `src/lib/queue-number.ts`.
- [x] Extend `recordTriage` (queue issue, ER branch, Facility availability) and its action and schema; add `nextOpening`.
- [x] The Facility tiles, the Issue / Direct to ER buttons, the ER confirmation, the banner and the ER panel.
- [x] Tests:
  - every I/O Matrix row, including the real multi-connection concurrency test;
  - `formatQueueNumber`;
  - `aheadOf`;
  - jsdom: tiles disabled with the reason text; ER switches the button and needs confirmation; the banner text; Esc.
- [x] `README.md`: the queue module, ordering, numbering and the ER flow.

**Acceptance Criteria:**
- Given three Routine patients queued at Consultation, when the nurse triages Lola Carmen (Senior Citizen) and issues a number, then the banner shows the next `CN-` number with "Next in line", and `liveQueue` lists her first.
- Given Emergency selected, when the nurse confirms Direct to ER, then no Queue Entry exists, and the Visit is `directed_to_er` with `closed_at`.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Files: `src/lib/queue-number.ts` (statuses, `formatQueueNumber`, `formatAhead`), `src/server/queue/{schema,repo,queries,service}.ts` (+ `queue.test.ts`, and `issue-worker.ts`, the child-process helper for the concurrency test), `drizzle/0012_queue.sql` (+ snapshot/journal), `src/server/db/schema-index.ts`, `src/server/settings/queries.ts` (`nextOpening`), `src/lib/facility-format.ts` (`formatClockTime`, `closedReason`, `NOT_LIVE_REASON`, + test), `src/lib/triage.ts` (`facilityId`, `directToEr`, messages, `facilityId` in `TRIAGE_FIELDS`), `src/server/triage/{service,actions}.ts` (+ `triage.test.ts` updated), `src/app/(staff)/triage/{triage-form.tsx, triage-workspace.tsx, page.tsx}` (+ `triage-form.test.tsx`), `README.md`.
- Interpretations: "{n} waiting" on a tile and "N ahead" both count `waiting` + `called` entries (not `serving`), through the shared live predicate, so the two numbers agree. `aheadOf` returns [] for an entry no longer live. `queue_entries.visit_id` is indexed, not unique (a referral in Epic 4 may add a second entry). Not live wins over closed for the tile reason; the closed reason uses the full weekday ("Closed, opens Monday 7:00 AM"). Unknown and deactivated Facilities are `facility_unavailable` too; the action adds `fieldErrors.facilityId` for it so the form points at the tiles. ER + Facility, ER without `directToEr`, and non-ER + `directToEr` are `invalid` (no field). The ER `invalid` check and "Choose a Facility." run right after the Urgency Level lookup. `queue.issue` checks availability itself; `recordTriage` moves the Visit (`in_queue` / `directed_to_er`), keeping queue → visits calls out of `queue`. The banner's Next patient button is white on cyan (`text-banner`). The Direct to ER button uses `bg-destructive text-background` (readable in both themes).
- Review fixes (2026-09-28): paper number for an open, not-live Facility (`paper_facility_id`, migration `0013_paper_number`, which also adds `queue_entries(opd_date, status)`); `RecordTriageOutcome` is a union by `outcome`; tiles refetch on window focus and after `facility_unavailable`; closed reason says today/tomorrow/weekday (+ date a week out); unknown or over-long Facility id → "That Facility isn't available. Choose another."; ER audit adds `closedAt` and the ER panel shows the category; a refused Direct to ER returns focus to the button; the concurrency worker moved to `src/test-support/queue-issue-worker.ts`. The superseded bullet above ("Not live wins over closed") no longer holds: closed wins, and a not-live open Facility is selectable.
- Tests: `triage.test.ts` now fakes `Date` to Monday 10:00 Manila (seeded hours are Mon–Sat 07–17); the "vitals never audited" assertion now skips `*Id` keys (a random UUID could contain "37", a latent flake).
- Verified 2026-09-28: `npm run db:migrate` (dev) applied 0012; `npx tsc --noEmit` 0 errors; `npm run lint` 0 problems; `npm test` 866 tests (56 files) pass; `npm run build` OK. Manual (throwaway DB copied from the 3.4 run, `next start -p 3100`, Edge via playwright-core, all checks PASS): three Routine patients issued by keyboard only (Tab reaches the tiles, Space, Ctrl+Enter) → CN-001 "Next in line", CN-002 "1 ahead", CN-003 "2 ahead", 35–96 ms; the Senior after them → CN-004 "Next in line" and first in the queue order; tiles "Closed, opens Monday 7:00 AM", "Not live yet: use paper number" (disabled), "3 waiting"; Emergency hides the tiles, Direct to ER asks, Confirm → "Directed to ER · Visit closed 12:00 AM", Visit `directed_to_er` with `closed_at`, no entry; audit rows carry outcome/queueNumber/ahead; no horizontal scroll and all targets ≥ 44 px at 375 and 768 px.

## Spec Change Log

- **2026-09-28, review pass 1.**
  - **Trigger:** the blind-hunter finding that non-ER triage for a not-live Facility can't be saved, so the complaint and vitals are lost, although PRD §10 says pilot patients for other Facilities get paper numbers "as today".
  - **Amended:** the frozen Boundaries now have the "Paper number for a not-live Facility" rule. The human delegated spec approval for this run ("build all", everything left).
  - **Known-bad state avoided:** during the pilot, triage for every Facility except Consultation couldn't be recorded at all.
  - **KEEP:** the queue module, `liveQueue` ordering, the counters and concurrency test, the ER flow, the tiles and the banner. The amendment is additive, so the code is patched, not re-derived.

## Review Triage Log

Review pass 1 (2026-09-28). Layers: blind-hunter, edge-case-hunter, verification-gap.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | Non-ER triage for a not-live Facility can't be saved; its vitals and complaint are lost (blind) | high: contradicts PRD §10 pilot | the spec was amended (see Spec Change Log), then patched |
| 2 | The tiles go stale; after `facility_unavailable` the same tile stays enabled (blind, edge) | medium | patch (refetch the tiles on that error and when the form regains focus) |
| 3 | "Closed, opens Monday 7:00 AM" on a Monday evening reads as today (blind) | medium | patch ("today", "tomorrow", or the weekday plus date when 7 days away) |
| 4 | `waitingCounts` can't use an index | low: the table grows daily with no purge | patch (index `(opd_date, status)` in the new migration) |
| 5 | `RecordTriageOutcome` isn't a discriminated union, so a queued result with a null queue would render the ER panel (blind, edge) | low | patch |
| 6 | The unknown-Facility message differs from the README; an over-long `facilityId` shows "Choose a Facility." | low | patch |
| 7 | The "vitals never audited" test skips every `*Id` key | low | patch (fixed test ids) |
| 8 | The ER audit row lacks `closedAt`; the ER panel dropped the Priority Category | low | patch |
| 9 | `issue-worker.ts` is test-only code in `src/server/queue`; `triage.test.ts` fakes timers at module scope without restoring them | low | patch (move it under a test-support folder; `afterAll` restore) |
| 10 | Focus falls to the body after a failed ER save | low | patch |
| 11 | The all-disabled tiles state, the ER → non-ER switch and the server's ER-confirmation errors are untested (verification-gap, blind) | medium | patch |
| 12 | No `UNIQUE` on a Visit's live Queue Entry | low: only a bug could create two; referrals (Epic 4) will add entries | reject |
| 13 | A Directed-to-ER patient can be triaged again the same day | false: intended, as the ER may send the patient back to OPD | reject |
| 14 | `createdBy` falls back to "unknown" | false: `requireStaff()` always gives an id | reject |
| 15 | `open` Visits from Story 3.4 on upgrade day get stuck | low: dev data only; no deployed 3.4 data exists | reject |

Patches applied: #1 (paper-number outcome, migration 0013), #2–#11. Rejected: #12–#15. Nothing deferred. The frozen tile rule was aligned with the amendment.
A full run had a Story 3.3 jsdom test fail intermittently (it passed alone): Testing Library's 1 s async timeout is too tight under parallel load. I added `src/test-support/setup.ts` (`asyncUtilTimeout: 5_000`) as a Vitest `setupFiles` entry.
Re-verified 2026-09-28: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 874 tests pass (56 files, three runs in a row), `npm run build` OK.

## Verification

**Commands:**
- `npm run db:migrate` (dev), `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and Edge via Playwright:
  - issue numbers by keyboard;
  - Direct to ER;
  - check that a closed Facility's tile shows its reason;
  - 375 px and 768 px layouts.
