# Adversarial Review: ARCHITECTURE-SPINE (OPD v1)

- **Reviewed:** `ARCHITECTURE-SPINE.md` (draft, 2026-09-26) against `prd.md` (final)
- **Lens:** build two units one level down (epics or stories by different developers). Each unit obeys every AD to the letter, yet the two still build incompatibly. Every such pair is a hole to close with a new or tightened AD.
- **Verdict:** **NOT READY. Revise before epics.** The layering and module-ownership rules (AD-2, AD-3) are sound. The spine does not, however, name an owner for the central aggregate (**Visit**), does not say how time-triggered transitions run, and does not define how a command that spans modules composes transactions and audit rows. Each of these gaps lets two compliant stories build incompatibly, and two of them block whole epics.

Severity scale: **Critical** means the compliant units cannot be integrated without rework in one of them, or the gap blocks an epic. **High** means integration works but produces wrong data or breaks a PRD consequence. **Medium** means rework in one unit, or drift in a report or metric.

---

## H-1. Visit has no owning module [Critical]

**Unit A (Triage epic, "record triage and issue number"):** puts `visits` and `triage_records` in `server/triage/schema.ts`, because triage "starts a Visit" (UJ-1, FR-7). Triage writes `visits.status = 'open'` and `'directed_to_er'`.

**Unit B (Facility Service epic, "complete the Queue Entry"):** FR-13 needs the Visit to become *Completed* when its last Queue Entry completes. AD-2 forbids writing `visits` from `queue`. The developer therefore either (a) calls `triage.completeVisit()`, which creates a cycle because `triage → queue → triage`, or (b) sets no Visit status and derives it on read. Unit A stores the status, so the two units now disagree.

**Unit C (Appointments, "check in", FR-18):** "check a Patient in, which starts a Visit at Triage". The appointments developer creates the Visit row by calling… whom? If `patients` owns Visits, because the Patient Record is "identity plus all of their Visits", a third developer builds a third owner.

**Why every AD is satisfied:** the ER diagram lists `VISITS`, but neither AD-2 nor the Capability Map assigns it to a module. Visit status values are not in the Enums convention, which lists only Queue Status. The Visit status rules in the Glossary ("Open while any entry is Waiting/Called/Serving", "No-show at end of day") are derivable, so storing the status and deriving it are both compliant.

**Fix (new AD-13, Visit aggregate):** `visits` is owned by one module, `visits` (or `triage`, stated explicitly). Only its service creates Visits and changes `visits.status`. Visit status is **stored**, as `open | completed | directed_to_er | no_show | cancelled` with a CHECK constraint. The `queue` service calls `visits.onEntryTerminal(visitId, tx)` after every terminal Queue Status change, and `visits` recomputes the status from the entries using a single documented rule. Appointment check-in calls `visits.start(...)`. The dependency direction is fixed: `triage` and `appointments` may call `visits` and `queue`, `queue` may call `visits`, and `visits` calls no one.

---

## H-2. Time-triggered transitions have no legal execution path [Critical]

**Unit A (Queues epic, "daily reset", FR-12):** implements closing-time cancellation lazily. The first `GET /api/queue/[facility]` after closing time marks leftover Waiting and Called entries *Cancelled*.
**Unit B (Appointments epic, "Missed", FR-18):** implements a `setInterval` in `instrumentation.ts` that marks Booked appointments *Missed* at 23:59 Manila time.

**Why both are "compliant", and why neither actually is:** AD-3 says every write goes through a Server Action with `requireStaff()` and `can()`, and that "no route-handler writes" are allowed. There is therefore **no** compliant way to perform a write with no user behind it. Each developer breaks the rule in a different place, or invents a fake "system" staff account, which conflicts with PRIV-7 (unique accounts). The results are two cut-off rules, two audit-actor conventions, and some cases where end-of-day processing never runs. The lazy path only runs if someone opens the screen, so an overnight Saturday-to-Monday gap can leave entries open, and Monday's queue reads them through a different `opd_date`. The Visit *No-show* ("last entry No-show **at end of day**") and SM-5 ("left Waiting at end of day") depend on the same missing mechanism.

**Fix (new AD-14, scheduled commands):** a single in-process scheduler, started once from `instrumentation.ts` on the one `next start` process (AD-1), runs **system commands**. These call a service method with `actor = { kind: 'system', job: '<name>' }`. `audit.record` accepts a system actor, which is not a user account. All jobs are idempotent, and on startup they catch up on every missed `opd_date`. The closing job runs per Facility at `closing_time`, using the `opd_date` computed by `opdDate()`. It cancels Waiting and Called entries, finalizes Visits (H-1), and marks unchecked Appointments as Missed. Amend AD-3 to name this as the only permitted non-Action write path.

---

## H-3. A command that crosses modules has no defined transaction or audit composition [High]

**Unit A (Queue service):** `queue.issueNumber()` opens its own transaction, `db.transaction(fn, { behavior: 'immediate' })`, as AD-5 literally requires, and calls `audit.record('queue.issue')`.
**Unit B (Triage service):** `triage.recordAndIssue()` opens a transaction because AD-3 says "one transaction per command", writes the triage record, calls `queue.issueNumber()`, and calls `audit.record('triage.record')`.

**Result:** the inner transaction becomes a SAVEPOINT inside a DEFERRED outer transaction, so the `BEGIN IMMEDIATE` required by AD-5 is silently dropped. Alternatively, the team rewrites Unit A to detect nesting. A single command also writes **two** audit rows with different action vocabularies, although AD-3's title promises "one audit row". FR-26 searches by action, so the Admin sees `triage.record` for some Visits and `queue.issue` for others, depending on the entry path (triage, referral, or paper). A third developer passes `tx` into service calls while a fourth uses the global `db`. With one connection both appear to work, until someone adds an `await` inside a transaction.

**Fix (tighten AD-3 and AD-5):** only the **entry** service method, the one the Action calls, opens a transaction, and every write command uses `behavior: 'immediate'`, not just those in AD-5. Service methods called by another module take `tx` as their first argument and never open a transaction. Transaction callbacks are synchronous and never `await`. There is exactly **one** `audit.record` per command, written by the entry method, and a cross-module method returns the facts to include in it. Audit `action` names come from one enum in `server/audit/actions.ts`, using `<module>.<verb>`.

---

## H-4. The Appointment and Visit link, and Appointment status transitions, are unowned [High]

**Unit A (Facility follow-up, FR-15):** `queue` books follow-ups by calling `appointments.book()`, as the map says. The Facility Staff developer also marks the Appointment that triggered today's Visit as *Completed* when the Queue Entry completes. They can do this only by calling a new method, `appointments.complete(apptId)`, and the `queue_entries` table carries no `appointment_id`, so they add one.
**Unit B (Appointments, FR-18):** has check-in set *Checked in* and store `visit_id` on `appointments`. It treats *Completed* as "the linked Visit is Completed" and derives it on read.

**Result:** the link is stored in two places, in opposite directions, and the two units encode different meanings of *Completed*. The ER diagram shows no link between `APPOINTMENTS` and `VISITS`. The Overview's "booked vs checked in" count (FR-21) will disagree with the list screen.

**Fix (new AD, or part of AD-13):** `appointments.visit_id` (nullable FK) is the **only** link, and check-in sets it through `appointments.checkIn(apptId, tx)`, which calls `visits.start`. Appointment status is stored as `booked | checked_in | completed | missed | cancelled`, and only `appointments` changes it. *Completed* is set when `visits` finalizes a Visit that has a linked Appointment, with `visits` calling `appointments.onVisitClosed(tx)`. *Missed* is set by the H-2 job. Add an explicit state machine (a table of allowed transitions) for Queue Status, Visit and Appointment. An illegal transition throws `DomainError('invalid_transition')`.

---

## H-5. Snapshot semantics for Referrals, No-show restores and Queue Numbers are ambiguous [High]

**Unit A (Referral, FR-14):** creates the target entry by calling `queue.createEntry(visitId, targetFacility)`. Following AD-6 ("when a Queue Entry is created, the queue service stores sort_group…"), it **recomputes** `sort_group` from the triage record's Urgency Level and today's settings.
**Unit B (No-show restore, FR-11):** copies the stored `sort_group` and `urgency_rank` from the original row.

**Result:** if an Admin re-ranks an Urgency Level or disables *Pregnant* mid-day, a referred Patient changes group, which violates FR-24 ("existing entries keep the group they were given") and UJ-4 ("keep their Urgency Level and Priority Category"). A restored Patient does not change group. The same ambiguity applies to the Queue Number. `formatQueueNumber()` is "the only formatter", but the spine does not say whether it formats from the **stored** prefix or from the Facility's **current** prefix. FR-23 lets the prefix change take effect the next day, so a developer who formats on read shows yesterday's history, and the audit log, with the new prefix.

**Fix (tighten AD-6):** a Visit's priority snapshot, `{urgency_level_id, urgency_rank, sort_group, priority_category}`, is computed **once, at triage**, and stored on the Visit or the triage record. Every Queue Entry for that Visit, whether created by triage, a referral or a restore, copies it and never recomputes it. `queue_entries` also stores `prefix` at creation, and `formatQueueNumber(prefix, seq)` is a pure function of stored columns. Prefix edits are written as `pending_prefix` with an `effective_opd_date`, not as an in-place change.

---

## H-6. Patient Record read path and view auditing are undefined [Medium]

**Unit A (Patients, FR-6):** the Patient Record page shows Visits, Triage Records, outcomes and Appointments. AD-2 forbids cross-table joins outside `overview` or the owner's repo, so the developer calls four services per Visit, which is N+1, and calls `audit.recordView()` in `patients.getRecord()`.
**Unit B (Facility Service, UJ-2):** the Serving panel shows "Triage data and past Visits". This developer calls `triage.getRecord()` and `queue.getHistory()` directly, never touches `patients.getRecord()`, and so **writes no view audit**.

**Result:** the audit log misses Patient Record views, which breaks PRIV-2, FR-26 and PRIV-6, depending on which screen was used. Performance also varies by screen.

**Fix (tighten AD-3 and AD-2):** define "Patient Record view" as any read that returns clinical or history data tied to a Patient. Every such read goes through one query, `patients.getRecordView(patientId, purpose)`, which audits the view and composes the data from the owners' **read-only query functions** (`<module>/queries.ts`, exported for cross-module reads). Other modules' services and screens may not assemble history themselves. The same rule governs other cross-module reads, such as the Facility Queue showing patient names or the Display Board reading Facility names: they call the owner's `queries.ts`, never join its tables.

---

## Additional holes (lower severity)

| # | Conflicting units | Severity | AD fix |
|---|---|---|---|
| H-7 | **Referral permission scope.** One unit calls `can(role,'queue.refer',{facility: source})` and another calls it with `target`. Facility Staff referring Treatment → Consultation are then allowed in one and denied in the other. The same applies to follow-up bookings at another Facility. | High | AD-4: the permission map declares, for each action, **which** Facility is the scope. For refer and book follow-up, it is the **source** entry's Facility. |
| H-8 | **Paper back-entry (FR-25).** The Triage unit creates a past-dated `queue_entries` row with status `completed`, which skips transitions and uses `queue_counters` for a past day. The Queue unit forbids non-sequential transitions. The Overview counts one version or the other. | Medium | New rule: paper Visits create `visits` (`entered_from_paper=1`, `occurred_at`) and a queue entry through `queue.recordPaperEntry()`. That entry takes **no** counter seq (it stores the paper number as text) and is excluded by the shared "live queue" predicate. |
| H-9 | **Which instant defines the OPD day.** Overview "today" uses `opdDate(created_at)`, while metrics use `opdDate(entered_at)`. A referral or paper Visit then lands on different days. | Medium | AD-7: every day-scoped table stores an explicit `opd_date` column, written once by its owner at creation. Every query filters on `opd_date` and never derives it on read. Paper Visits use the real date. |
| H-10 | **Pilot "live" Facilities (PRD §10).** The Triage unit filters by a `settings.facilities.is_live` column. The Display unit filters with an environment-variable list. | Medium | AD-8: `is_live` is a settings column exposed through a `settings.liveFacilities()` getter. Triage, referral and the display endpoint all use it. |
| H-11 | **Recall count and the No-show threshold (UJ-2).** One unit stores `call_count` on the entry. Another counts `queue.call` audit rows. The "agreed number of calls" is hard-coded in one and in settings in the other. | Medium | AD-6 and AD-8: `queue_entries.call_count` is owned by `queue`. The threshold is a settings row. |
| H-12 | **Display Board read handler.** AD-4 says "read handlers call `can()`", but the board has no role. One developer adds a `display` pseudo-role to the permission map, and another skips `can()`. | Low | AD-11: the display endpoint's only check is `requireDisplayDevice()`, which is an explicit exception to AD-4. The response type is `DisplayBoardDTO`, built only from `queue/queries.ts`. |
| H-13 | **Status enum collision.** Queue, Visit and Appointment share values (`completed`, `cancelled`, `no_show`), and the Enums convention lists only Queue Status. Developers may reuse one TS union across entities. | Low | Conventions: one union per entity (`QueueStatus`, `VisitStatus`, `AppointmentStatus`), each with its own CHECK constraint, defined in its owner's `schema.ts`. |

## Summary of required spine changes

1. **AD-13, Visit aggregate:** names an owner, stores the status, fixes the dependency direction, and adds `onEntryTerminal` (H-1, H-4).
2. **AD-14, scheduled system commands:** covers the system actor, idempotent catch-up, and the per-Facility close job (H-2).
3. **Tighten AD-3 and AD-5:** only the entry method opens the transaction, every write command uses IMMEDIATE, `tx` is passed down, transactions are synchronous, there is one audit row per command, and audit action names come from an enum (H-3). The Patient Record view goes through one audited query (H-6).
4. **Tighten AD-6:** the priority snapshot is taken once at triage and copied thereafter, and the prefix is stored per entry (H-5). The entry also stores `call_count` (H-11).
5. **Add state machines** for Queue, Visit and Appointment status, with a transition table and `invalid_transition` (H-4, H-13).
6. **Tighten AD-4:** a scope rule for each action (H-7). **AD-7:** an explicit `opd_date` column (H-9). **AD-8:** `is_live` and the No-show threshold (H-10, H-11). **AD-11:** the device-guard exception (H-12). **A new FR-25 rule** for paper entries (H-8).
