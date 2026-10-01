# Epic 3 Context: Patient Registration and Triage

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Triage Nurses find or register Patients, record Triage (Vital Signs, Chief Complaint, Urgency Level, Priority Category), and either issue a printed Queue Number for the chosen Facility in priority order or direct the patient to the ER. Any signed-in staff member can look up a Patient Record. The epic stands alone: before the Facility queue screens (Epic 4) exist, the OPD can already run on system-issued numbers with paper at the counters. It creates the `patients`, `visits` and `triage` modules and the queue issue path, and it sets the ordering and numbering rules that Epics 4 and 5 depend on.

## Stories

- Story 3.1: Find patients
- Story 3.2: Register a new patient
- Story 3.3: View and update a patient record
- Story 3.4: Record triage for a visit
- Story 3.5: Issue a queue number or direct to the ER
- Story 3.6: Print the queue slip

## Requirements & Constraints

- **Search:** one input matches partial names (case-insensitive), Hospital Number, birthdate (`YYYY-MM-DD` or `MM/DD/YYYY`) and phone. Results update 300 ms after typing. Each result shows name, calculated age, sex, Hospital Number and last Visit date (or "No visits").
- **Registration:** required fields are full name, sex, birthdate, address (barangay/municipality) and contact number. Optional fields are PhilHealth PIN, Senior Citizen ID, PWD ID and emergency contact. The "Privacy notice explained to the patient" checkbox is required, and its time is stored on the patient. A future birthdate is rejected. Age is always calculated, never typed. When a name and birthdate match an existing patient, the nurse is warned before anything is created.
- **Records:** every demographic change is audited with old and new values. Every record view is audited. Records have no delete action.
- **Permissions:** everyone can find and view Patient Records. Only a Triage Nurse or Admin can register, edit demographics, record Triage and issue numbers. Facility Staff see records read-only. New actions go into `permissions.ts` with tests.
- **Triage:** a Visit cannot be queued without a Chief Complaint, an Urgency Level and the required Vital Signs. Impossible values are rejected (e.g. temperature outside 30–45 °C). Abnormal values are flagged but still save. The actual ranges are an open assumption, so keep them configurable or centralized. Pregnant is offered only for female patients. Senior Citizen requires age 60 or over. Senior Citizen or PWD without an ID on file needs either the ID or an "ID not presented" choice, and that choice is recorded.
- **Queue Numbers:** unique per Facility per day and sequential (`CN-001`, `CN-002`, …). The nurse sees the number and "N ahead". An ER-flagged Urgency Level issues no number, and the Visit ends as *Directed to ER*.
- **Priority order (strict):** group 1 is Urgency rank above the lowest (ordered by rank), group 2 is the lowest rank with an enabled Priority Category, and group 3 is everyone else. Ties are broken by entry time. A Senior Citizen arriving after three Routine patients goes ahead of all three.
- **Slip:** shows the hospital name, Facility, large Queue Number, date and time, and "Please wait for your number on the screen." It shows no name, complaint or priority. It must fit 58 mm, 80 mm and A4.
- **Definition of Done:** save, search and issue each respond in under 1 s. The UI works at 768 px, meets WCAG 2.1 AA with 44 px targets, and is fully keyboard-operable. Each command writes exactly one audit row. Lint, build and tests pass.

## Technical Decisions

- **Modules:** `src/server/{patients,visits,triage,queue}`, each with `schema/repo/service/queries/actions/schemas`, and every file starts with `import "server-only"`. Table ownership: `patients` owns `patients` and `hospital_number_counters`; `visits` owns `visits`; `triage` owns `triage_records`; `queue` owns `queue_entries` and `queue_counters`. Other modules reach these tables only through the owner's service or queries. Dependencies run one way: triage → visits, queue, patients; queue → visits. Everything → settings and audit.
- **Commands:** each command follows Zod `safeParse` → `requireStaff()` → `can()` → one service command. It runs inside `withCommandTx(actor, action, fn)`, a synchronous IMMEDIATE transaction with no `async`. `tx` is passed to repos, to cross-module services and to `audit.record`. Action names come from the `AuditAction` enum. Actions return `{ ok, data } | { ok: false, error: { code, message, fieldErrors? } }`, and services throw `DomainError(code)`.
- **Hospital Number:** `HN-YYYY-NNNNNN`, taken from `hospital_number_counters` inside the patient-creation transaction. Primary keys are text UUIDs.
- **Record view:** `/patients/[id]` loads through `patients.getRecordView()`. It assembles data from the owners' queries and writes a `patient.view` audit row. No screen reads clinical tables directly.
- **Visits:** `visits.open(tx, …)` creates the Visit with its `opd_date`, and only the `visits` module sets Visit status. VisitStatus is its own union with a transition table and a CHECK constraint. Invalid transitions throw `invalid_transition`.
- **Triage snapshot:** `triage_records` stores `urgency_level_id`, `urgency_rank`, `sort_group` and `priority_category` once. Story 3.5 extends the story 3.4 save into a single IMMEDIATE transaction covering Visit, Triage Record, Queue Entry and one audit row.
- **Queue issue:** increment `queue_counters(facility_id, opd_date)`. `queue_entries` has `UNIQUE(facility_id, opd_date, seq)` and copies the snapshot plus `prefix`, `seq`, `entered_at` and `call_count`. QueueStatus values are lowercase text with a CHECK constraint: `waiting`, `called`, `serving`, `completed`, `referred`, `no_show`, `cancelled`.
- **Ordering:** exactly one queue repo function orders by `sort_group, urgency_rank, entered_at` and filters with the shared `liveQueue` predicate: today's `opd_date`, status waiting/called/serving, not a paper entry. "N ahead" comes from this function.
- **Labels:** always use `formatQueueNumber(prefix, seq)` on the stored columns.
- **Time:** store UTC ISO text, and write `opd_date` once from `opdDate()` in `src/lib/time.ts` (Asia/Manila). Display uses `Intl` with `timeZone: "Asia/Manila"`.
- **Settings:** Urgency Levels, Priority Categories and Facilities (hours, days, `is_live`) are read only through `settings` getters. Never hard-code them.
- **Tests:** Vitest service tests against a temp-file SQLite are required for ordering, numbering, two nurses issuing numbers at once (different, consecutive numbers), permissions and state transitions.
- **Logging:** app logs never contain patient names, complaints or Hospital Numbers.
- **Demo data:** fictional patients load through `npm run db:seed:demo`, which refuses to run in production.

## UX & Interaction Patterns

- **`/triage` layout:** at lg and above, the finder is on the left and the form on the right. At md the columns stack. The finder supports ↑/↓/Enter and Esc to clear, with a "New patient" row always last. `Ctrl+K` focuses the finder.
- **Registration:** an inline form, not a modal. Optional fields are collapsed. The "Possible match" card offers **Use this record** / **Create anyway**. On submit, focus moves to the first error, and errors are tied to their fields with `aria-describedby`.
- **Form order:** Complaint → Vital Signs (temperature, BP, pulse, respiratory rate, SpO₂, weight) → Urgency Level → Priority Category → Facility tiles. Tab follows this order.
- **Urgency Level:** a segmented control ordered by rank with the ER level last. Keys `1…n` pick a level only while the control has focus. Badge colors: rank 1 is `urgent`, the lowest non-ER rank is `routine`, and anything in between is `abnormal`.
- **Vital Sign field:** a numeric input with a unit suffix. An abnormal value gets an amber border, an icon and a hint such as "Above normal (37.5 °C max)". An impossible value gets a red error that blocks saving.
- **Facility tiles:** each tile shows its waiting count. A disabled tile gives the reason as text: "Closed, opens 7:00 AM" or "Not live yet: use paper number".
- **Issue:** `Ctrl+Enter` or the green **Issue queue number** button. A cyan banner then shows the number in `queue-number-issued` with "{Facility} · N ahead". **Print slip** has focus, so Enter prints. Esc clears the screen and returns focus to the finder.
- **ER handoff:** the ER level turns the button into **Direct to ER**. A confirmation says "No queue number will be issued and the Visit closes." A red-outlined panel then shows "Directed to ER · Visit closed {time}", and Esc goes to the next patient.
- **Components:** Queue Number chip (mono on a muted chip), Group badge (outlined pill with icon and text: Urgent / Senior / PWD / Pregnant / Routine), Status badge (pill with text), and Banner (cyan with an optional white tab). Color is never the only signal.
- **Pages:** `/patients` uses the story 1.4 URL-driven table, including the toolbar-sync fix, with the empty state "No patients match …". Page titles follow "{Surface} | OPD". The voice is plain and clinical, e.g. "Temperature must be between 30 and 45 °C."
- **Out of scope here:** the Today's appointments tab and check-in on Triage belong to Epic 6.

## Cross-Story Dependencies

- **Depends on Epic 2:** the DB platform and `withCommandTx`, auth (`requireStaff`, `permissions.ts`), audit, settings tables and getters, the `(staff)` shell, design tokens, `time.ts` and the table pattern.
- **Within the epic:** 3.1 creates the `patients` table and demo seed that 3.2 and 3.3 use. 3.4 creates `visits` and `triage_records`. 3.5 extends the 3.4 save command into the issue transaction and adds the `queue` tables and ordering function. 3.6 needs the Queue Entry from 3.5.
- **Downstream:** Epic 4 reuses the ordering function, `liveQueue`, the snapshot columns and the badges. Epic 5 reads the same queue data. Epic 6 check-in calls `visits.open`. Epic 7 paper entry reuses the triage layout and `visits.open`.
