---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-Dashboard-2026-09-26/prd.md
  - _bmad-output/planning-artifacts/prds/prd-Dashboard-2026-09-26/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-Dashboard-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Dashboard-2026-09-26/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Dashboard-2026-09-26/EXPERIENCE.md
  - _bmad-output/implementation-artifacts/1-1-initialize-nextjs-application.md
  - _bmad-output/implementation-artifacts/1-2-example-dashboard.md
  - _bmad-output/implementation-artifacts/1-4-orders-search-filters-pagination.md
  - _bmad-output/implementation-artifacts/1-5-reference-design-restyle.md
---

# Hospital OPD Management System - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the Hospital OPD Management System. It decomposes the requirements from the PRD, the UX design (DESIGN.md + EXPERIENCE.md) and the architecture spine into implementable stories. The codebase is the existing Next.js 16 "Acme Store" dashboard (stories 1.1–1.5), which is converted, not rebuilt.

## Requirements Inventory

### Functional Requirements

FR1: Staff sign in with their own credentials and sign out. Unauthenticated requests (except the Display Board) redirect to sign-in. There is a 15-minute idle timeout, and an account locks after 5 failed attempts until an Admin unlocks it.
FR2: The system limits actions by Role (Triage Nurse, Facility Staff limited to their Facilities, Admin) according to the PRD FR-2 permission matrix. Anything not listed is denied.
FR3: An Admin creates, edits, deactivates and unlocks Staff Accounts and assigns Roles and Facilities. A deactivated account cannot sign in, and its past actions stay attributed to it.
FR4: Staff search Patient Records by name, Hospital Number, birthdate or phone. Results appear while typing (partial, case-insensitive) and show name, age, sex, Hospital Number and last Visit.
FR5: A Triage Nurse registers a Patient (required: full name, sex, birthdate, address, contact number; optional: PhilHealth PIN, Senior Citizen ID, PWD ID, emergency contact) and gets a Hospital Number. Possible duplicates (same name and birthdate) are warned about, a future birthdate is rejected, and age is calculated.
FR6: Staff view a Patient Record with all Visits (Triage Records, Facilities, outcomes, Appointments) and correct demographics. Every change is logged with old and new values, and records are never hard-deleted.
FR7: A Triage Nurse records Vital Signs, Chief Complaint, Urgency Level and Priority Category for a Visit. Required fields must be present before queueing. Impossible values are rejected and abnormal values flagged. Pregnant is offered only for female patients, Senior Citizen is checked against age, and Senior Citizen/PWD prompts for the ID (proceeding with "not presented" is allowed). The Urgency Level scale comes from settings.
FR8: A Triage Nurse assigns one Facility, and the system creates a Queue Entry with the next Queue Number (unique per Facility per day, sequential). The nurse sees the number and how many are ahead, and can print a slip. The ER-flagged Urgency Level issues no number, and the Visit ends as Directed to ER.
FR9: Each Queue is ordered by group (1: Urgency rank above lowest; 2: lowest rank with an enabled Priority Category; 3: others), then by Queue Entry time. Priority is strict. A Referral uses the referral time and a restored No-show keeps its original time. Each entry shows its group as a badge with text. An Admin enables/disables Priority Categories, with Senior Citizen and PWD marked legally required.
FR10: Facility Staff see their Facility's Queue (Waiting, Called, Serving) with Queue Number, name, group and time waited. Changes by others appear within 5 s without a reload.
FR11: Facility Staff Call next (top Waiting entry), Recall, mark Serving, and mark No-show. Call next never skips a higher entry, and calling a specific entry requires a logged reason. No-shows can be restored the same day, and two simultaneous Call next presses never get the same patient.
FR12: Queues start empty each day and number sequences restart at 001. At each Facility's closing time, entries still Waiting or Called become Cancelled (end of day), with a warning 30 minutes before closing.
FR13: Facility Staff record the service given and a note, then complete the Queue Entry. The entry leaves the Queue and the Display Board, and the note appears on the Patient Record.
FR14: Facility Staff refer the Visit to another Facility without repeating Triage. The patient gets that Facility's next Queue Number, ordered by FR9 using the referral time and keeping Urgency and Priority. The original entry ends as Referred, and the Visit shows both Facilities and the reason.
FR15: Facility Staff book a follow-up Appointment at the end of a Visit.
- Animal Bite Center: suggests Day 3 and Day 7 after Day 0 (boosters Day 0/3 for previously immunized patients; to confirm), with schedules from settings.
- Prenatal: shows the contact count against a target (default 8).
FR16: The Display Board shows each live Facility's Called or Serving Queue Numbers and the next 3 Waiting numbers.
- A new call is highlighted, with a chime, within 5 s.
- It shows no names, complaints or priority, is readable at 6 m, and shows "reconnecting" when offline.
- It runs only on registered devices.
FR17: Staff book, reschedule and cancel Appointments (Patient, Facility, date, optional Doctor and note). Booking on a closed day is blocked.
FR18: Staff see a day's Appointments filtered by Facility and status and check a patient in, which starts a Visit at Triage. Appointments not checked in by the end of the day become Missed, and upcoming Appointments show on the Patient Record.
FR19: An Admin creates, edits and deactivates Departments and Doctors (name, Department, specialty, Facilities).
FR20: An Admin sets each Doctor's duty days per Facility, and staff see today's Doctors per Facility. An Appointment with a Doctor can only be booked on that Doctor's duty days.
FR21: The OPD Overview shows, for today and per Facility, how many Visits were triaged and how many patients are waiting, being served and served. It also shows the average and longest wait (with the longest Routine wait shown separately), Appointments booked vs. checked in, and No-shows. Each Facility card links to its Queue.
FR22: Facility Staff record structured fields.
- Animal Bite Center: animal, owned/stray, exposure date, site, category I/II/III, vaccine brand/route/dose day, RIG type, prior vaccination, outcome. Category I schedules no follow-up.
- Prenatal: gestational age/EDD, contact number, BP/weight, fundal height, tetanus toxoid dose, iron/folic acid, notes.
FR23: An Admin manages Facilities (name, unique prefix, opening days and hours). A prefix change applies the next day. Triage cannot assign a closed Facility, and deactivating a Facility with waiting entries is blocked.
FR24: An Admin edits Urgency Levels (name, rank, ER flag), Priority Categories (on/off with a legal warning), Animal Bite Center dose schedules and the prenatal target. At least one non-ER level is required and ranks are unique. Changes apply only to new entries.
FR25: A Triage Nurse or Admin back-enters paper-recorded Visits (real date/times, Triage, outcome), marked Entered from paper. They never create a live Queue Entry or appear on the board.
FR26: An Admin searches the audit log by staff, Patient Record, action and date. All views, creates, updates, calls, referrals, setting changes and sign-ins are present, and no one can edit or delete entries.
FR27: An Admin registers and revokes Display Board devices. Only a registered device opens the board, and a revoked device shows "not authorized" within one refresh.

### NonFunctional Requirements

NFR1: Common actions (search, save Triage, Call next) complete in under 1 s on the hospital network.
NFR2: Queue changes reach other staff screens and the Display Board within 5 s.
NFR3: Available during OPD hours (default 7 AM–5 PM, Mon–Sat). A documented paper fallback covers outages, with back-entry through FR25.
NFR4: Queue Numbers are never duplicated and no two staff get the same patient, even with simultaneous actions.
NFR5: Works in desktop/laptop browsers, on tablets at counters, and in a TV browser for the Display Board.
NFR6: WCAG 2.1 AA contrast, 44 px touch targets, and a fully keyboard-operable triage.
NFR7: The interface is in English.
NFR8 (PRIV-1): Only signed-in staff see Patient data, limited by Role. The Display Board shows only Queue Numbers.
NFR9 (PRIV-2): Every Patient Record view and every create, update, call or referral is logged with staff, time and action. Logs are immutable.
NFR10 (PRIV-3): Patient data is encrypted in transit and at rest.
NFR11 (PRIV-4): Registration records that the privacy notice was given.
NFR12 (PRIV-5): Outpatient records are kept at least 7 years and never hard-deleted.
NFR13 (PRIV-6): The audit trail supports breach investigation within the 72-hour NPC notification window.
NFR14 (PRIV-7): One Staff Account per person, with no shared logins.

### Additional Requirements

From the architecture spine (AD-1…AD-16 and Operations). **There is no starter template.** The project is brownfield: Next.js 16.3.6, React 19.2.8, Tailwind 4, shadcn/ui radix-nova, with the story 1.5 shell and the story 1.4 table pattern. Epic 1 Story 1 therefore removes the Acme Store code and lays the platform foundation instead of scaffolding.

- **Persistence (AD-1):** SQLite via Drizzle ORM 0.45.3 and better-sqlite3 13.0.3 (+ @types/better-sqlite3 9.6.0), in one `next start` process.
  - The database opens lazily in WAL mode with foreign keys on and a busy timeout.
  - Query entry points run at request time.
  - Schema changes go only through drizzle-kit migrations in `drizzle/`.
- **Module structure (AD-2):** schema/repo/service/queries/actions/schemas per module under `src/server/<module>`, with every file starting `import "server-only"`. Table ownership follows the spine's owner table, and cross-module access goes only through services and queries.
- **Commands (AD-3):** `withCommandTx(actor, action, fn)` with an IMMEDIATE, synchronous transaction, `tx` passed down, and one audit row per command from the `AuditAction` enum. `audit_log` is append-only, enforced by triggers. Clinical reads go through the audited `patients.getRecordView()`. The exceptions are the Better Auth handler and system jobs.
- **Permissions (AD-4):** a single `permissions.ts` map of Role × action with a declared Facility scope (Referral and follow-up use the source Facility). `src/proxy.ts` only does an optimistic redirect.
- **Queue (AD-5, AD-6):**
  - `queue_counters` and `UNIQUE(facility_id, opd_date, seq)` make numbers unique.
  - Entries carry a priority snapshot (`sort_group`, `urgency_rank`, `priority_category`), plus `prefix`, `seq`, `entered_at`, `call_count`, `called_by` and `called_at`.
  - Ordering happens in one function, and Call next refuses while the caller already has an active entry.
  - Vitest concurrency tests are required.
- **Time (AD-7):** UTC ISO timestamps. Every day-scoped table has an explicit `opd_date` (Asia/Manila) from `opdDate()`.
- **Settings (AD-8):** tables for Facilities (incl. `is_live` pilot flag), Urgency Levels, Priority Categories, schedules, the prenatal target, the No-show threshold and the pre-close warning. Seed migrations hold the PRD defaults.
- **Auth (AD-9):** Better Auth 1.7.6 with the Drizzle adapter and the username + admin plugins, impersonation off. Sessions use `expiresIn` 900 / `updateAge` 60 with no cookieCache, and polling reads use `disableRefresh`. Lockout uses `failed_attempts`/`locked_at` via hooks, `banned` means deactivated, and rateLimit uses DB storage. Auth events are audited from hooks.
- **Live data (AD-10):** TanStack Query 5.104 polling every 3 s against read-only route handlers, with query-key factories and mutation invalidation.
- **Display Board (AD-11):** the `(display)` route group, `requireDisplayDevice()`, and a numbers-only `DisplayBoardDTO` (with `calledAt`). Devices are registered by pairing code.
- **Data protection (AD-12):** an encrypted volume, TLS at a reverse proxy, a nightly `VACUUM INTO` backup kept 30 days, and soft deletes only.
- **Visits (AD-13):** the `visits` module owns Visit status (`open`, `onEntryTerminal`). The Appointment link is only `appointments.visit_id`.
- **Jobs (AD-14):** one scheduler started from `src/instrumentation.ts`, with system-actor commands made idempotent by `job_runs`, and catch-up on start. Jobs: facility close, appointments missed, pre-close warning, nightly backup.
- **State machines (AD-15):** separate Queue, Visit and Appointment status unions, each with a transition table and CHECK constraint. An invalid transition raises `invalid_transition`.
- **Paper entries (AD-16):** `queue.recordPaperEntry` with no seq and a `paper_number` text. They are excluded from `liveQueue`.
- **Operations:** dev/test/prod environments, a `.env` contract (DATABASE_PATH, BACKUP_DIR, BETTER_AUTH_SECRET, BETTER_AUTH_URL), and a deploy order of build → `db:migrate` (with pre-migration backup) → restart. It also includes:
  - a `create-admin` CLI;
  - `db:seed:demo`, which refuses to run in production;
  - `GET /api/health`;
  - a restore drill.
- **Tooling:** Vitest 5.0.2 service tests against temp-file SQLite, with `@types/node` bumped to ^24. Zod 4.6.5 for every action input.
- **Cleanup:** remove the Acme Store routes, sample data and `orders-*` code. Story 1.3 is superseded, and the `(dashboard)` route group becomes `(staff)`. Known story 1.5 toolbar-sync bug: the list-table toolbar must sync with URL changes when it's reused.

### UX Design Requirements

UX-DR1: Add the semantic color tokens to `globals.css` and `@theme`: `urgent`, `priority`, `routine`, `abnormal`, `board-*` (background, foreground, muted, called, called-foreground), plus the full `-dark` set per DESIGN.md. Filled buttons in dark mode use dark text.
UX-DR2: Typography tokens and utilities: `queue-number` (mono 28/600), `queue-number-issued` (mono 64/700), and `board-now-serving` / `board-next` / `board-facility`. Keep Roboto and Roboto Mono. Uppercase bold only on primary, success and CTA buttons.
UX-DR3: A Queue Number chip component (mono numeral on a muted chip), reused in lists, the triage confirmation and slips. Formatting goes only through `formatQueueNumber(prefix, seq)`.
UX-DR4: Group badge component: an outlined pill with icon and text for each Urgency Level (colors derived from rank) and Priority Category (Senior, PWD, Pregnant), plus Routine. The text is always present.
UX-DR5: Status badge component with text for Queue (Waiting, Called, Serving, Completed, Referred, No-show, Cancelled), Visit and Appointment statuses.
UX-DR6: Vital Sign field: a numeric input with a unit suffix. Abnormal values show an amber border, icon and hint text but can still be saved. Impossible values show a red error and block saving, tied to the field with `aria-describedby`.
UX-DR7: Banner component (cyan, white text) with an optional white "tab" on its lower edge. It is used for the issued Queue Number and the queue summaries.
UX-DR8: Shell update:
- Top nav: Overview, Triage, Queues, Patients, Appointments, Directory. Items are hidden per Role.
- Left rail: one tile per live Facility with its prefix, name and waiting count, scoped to the user's Facilities.
- User menu: Admin pages and Keyboard shortcuts.
- The `(dashboard)` group becomes `(staff)`.
UX-DR9: Keyboard model:
- `Ctrl+K` goes to the finder or search, and `Ctrl+Enter` issues a number.
- On the confirmation, Enter prints and Esc goes to the next patient.
- Queue actions use `Alt+N/R/S/C`, never inside text fields.
- `g x` sequences are off by default and can be turned on per user.
- `?` opens a help dialog.
UX-DR10: Session UX: a "Stay signed in" dialog 60 s before the 15-minute expiry. On expiry, re-authenticate in a dialog that keeps the page and form. A different user signing in gets a fresh page.
UX-DR11: Triage screen (per mockup `triage.html`): the finder on the left (↑/↓/Enter, a "New patient" row last), and the form on the right in the order Complaint → Vitals → Urgency (keys 1…n) → Priority → Facility tiles (with waiting counts; closed or not-live tiles disabled with the reason). Also: the issue confirmation banner, an ER handoff confirmation and panel, and a Today's appointments tab.
UX-DR12: Registration inline form: required fields visible, optional ones collapsed, a required "Privacy notice explained" checkbox, and an inline "Possible match" card (Use this record / Create anyway).
UX-DR13: Facility Queue screen (per mockup `queue.html`):
- All Called and Serving rows are pinned, with the staff member's name, and the user's own entry first with the Serving panel open.
- Call next is the orange CTA, disabled only for the user's own active entry or when nobody is waiting, with the reason shown.
- Recall shows a call count, and No-show appears at the threshold.
- A row "⋯" menu, a collapsed No-show section, and focus kept on the same entry across refreshes.
UX-DR14: Serving panel:
- Triage data with abnormal flags, and the last 3 Visits.
- Animal Bite Center and Prenatal field sets.
- A note.
- Complete, Refer to… (Facilities not live are selectable with a paper-number message), and Book follow-up.
UX-DR15: Appointment sheet: suggested dates first, only on-duty Doctors, closed days disabled, and a "Print appointment card" option (name, Facility and dates only).
UX-DR16: Display Board (per mockup `board.html`): a fixed dark scheme and a 2×2 grid (1×N for fewer live Facilities). Each tile has now-serving numbers (one per counter) and next numbers. It turns gold with dark text and a "Now calling" tag for 8 s whenever `calledAt` changes, and chimes. There is a "Reconnecting…" dim state, a pairing-code screen when unregistered, kiosk autoplay, and a "Sound off" fallback note.
UX-DR17: Print routes: a Queue slip (hospital, Facility, big number, date/time, "Please wait for your number on the screen") and an appointment card, both working at 58–80 mm and A4.
UX-DR18: State patterns:
- skeletons in content shape;
- silent background refresh;
- an amber "Connection lost" strip after 2 failed polls, which disables Call next;
- empty, closed and pre-close banners;
- a conflict toast ("already called by Mark");
- a permission-denied page with no data leak;
- a locked-account message.
UX-DR19: Accessibility:
- a skip link and "{Surface} | OPD" titles;
- polite `aria-live` announcements for queue changes;
- first-error focus;
- reduced motion (no slide or flash);
- usable at 200% text;
- color never the only signal.
UX-DR20: Responsive: two columns at ≥ lg. At md, Triage stacks and the Serving panel becomes a bottom sheet. Below md, the nav and rail move into a ☰ sheet and tables scroll in focusable regions. A TV layout with no scroll.
UX-DR21: Data tables (Patients, Appointments, Directory, Audit log) reuse the story 1.4 URL-driven table pattern, with the toolbar-sync bug fixed.

### FR Coverage Map

FR1: Epic 2 - Staff sign-in, idle timeout, lockout
FR2: Epic 2 - Role and Facility permission map (each later epic adds its own actions to the same map)
FR3: Epic 2 - Staff account management
FR4: Epic 3 - Find a Patient
FR5: Epic 3 - Register a Patient
FR6: Epic 3 - Patient Record view and update (audited)
FR7: Epic 3 - Record Triage
FR8: Epic 3 - Assign Facility, issue Queue Number, print slip, ER handoff
FR9: Epic 3 - Priority ordering (stored snapshot and ordering, needed for "N ahead"); Epic 4 displays and uses it
FR10: Epic 4 - Live Facility Queue view
FR11: Epic 4 - Call next, Recall, Serving, No-show
FR12: Epic 4 - Daily reset and closing-time job
FR13: Epic 4 - Record outcome and complete
FR14: Epic 4 - Referral between Facilities
FR15: Epic 6 - Book follow-up from the Facility with suggested dates
FR16: Epic 5 - Display Board
FR17: Epic 6 - Book, reschedule, cancel Appointments
FR18: Epic 6 - Daily Appointment list and check-in, Missed job
FR19: Epic 6 - Doctors and Departments directory
FR20: Epic 6 - Duty schedule
FR21: Epic 7 - OPD Overview
FR22: Epic 4 - Animal Bite Center and Prenatal fields
FR23: Epic 2 - Manage Facilities (incl. pilot live flag)
FR24: Epic 2 - Urgency Levels, Priority Categories, schedules, thresholds
FR25: Epic 7 - Paper back-entry
FR26: Epic 2 - Audit log review
FR27: Epic 5 - Register display devices

NFRs: NFR8–NFR14 (privacy and security) are set up in Epic 2 and applied by every later epic. NFR2/NFR4 are in Epics 3–5, NFR3 in Epics 2 (backups) and 7 (paper fallback), and NFR1/5/6/7 in every UI story.

## Epic List

Epic 1 is the existing **Acme Store** work (stories 1.1–1.5, done; 1.3 unbuilt and superseded). The hospital system starts at Epic 2, so story keys don't collide with the existing files.

### Epic 2: Secure Staff Access and OPD Setup
The Acme Store is replaced by the hospital app shell. The first Admin is created from the command line; they then create staff accounts with Roles and Facilities and configure the Facilities, Urgency Levels, Priority Categories and schedules. Every staff member signs in with their own account, and every action is recorded in an audit log the Admin can search. The data is backed up nightly.
**FRs covered:** FR1, FR2, FR3, FR23, FR24, FR26
**Also establishes:** the SQLite/Drizzle platform (AD-1–AD-4, AD-7, AD-8, AD-9, AD-12, AD-14 scheduler + backup job), Operations (env contract, migrate, create-admin, demo seed, health), UX-DR1, UX-DR2, UX-DR8, UX-DR10, UX-DR19, UX-DR21 (table toolbar-sync fix).

### Epic 3: Patient Registration and Triage
Triage Nurses find or register Patients, record Triage (Vital Signs, complaint, Urgency, Priority), and issue a printed Queue Number for the right Facility in priority order, or direct the patient to the ER. Staff can look up any Patient Record. Standalone: even before the Facility screens exist, the OPD can run on system-issued numbers with paper at the counters.
**FRs covered:** FR4, FR5, FR6, FR7, FR8, FR9
**Notes:** the visits, triage and patients modules; the queue issue path (AD-5, AD-6, AD-13); UX-DR3, UX-DR4, UX-DR5, UX-DR6, UX-DR7, UX-DR9 (triage part), UX-DR11, UX-DR12, UX-DR17 (slip).

### Epic 4: Facility Queues and Service
Staff at Prenatal, Animal Bite Center, Treatment and Consultation see their live queue, call patients in the right order (several counters at once), record the outcome, including the Animal Bite Center and Prenatal fields, and refer patients to other Facilities. Queues close and reset each day automatically.
**FRs covered:** FR10, FR11, FR12, FR13, FR14, FR22
**Notes:** AD-5 call serialization, AD-10 polling, AD-14 facility-close job, AD-15 state machines; UX-DR9 (queue keys), UX-DR13, UX-DR14, UX-DR18, UX-DR20.

### Epic 5: Waiting-Area Display Board
Patients in the waiting area see each Facility's now-serving and next numbers on a TV, with a highlight and chime when a number is called. No personal data is shown, and only Admin-registered screens can show it.
**FRs covered:** FR16, FR27
**Notes:** AD-11, `DisplayBoardDTO` with `calledAt`, pairing code; UX-DR16.

### Epic 6: Appointments, Follow-ups and Doctor Directory
Staff book, reschedule and check in Appointments, including suggested Animal Bite Center dose days and prenatal visits from the Serving panel, and print appointment cards. Admins keep the Doctor and Department directory and duty days. Missed appointments are marked automatically.
**FRs covered:** FR15, FR17, FR18, FR19, FR20
**Notes:** appointments and directory modules, AD-13 check-in via `visits.open`, AD-14 appointments-missed job; UX-DR15, UX-DR17 (appointment card).

### Epic 7: OPD Overview and Outage Recovery
Staff and Admins open the day's OPD overview: patients waiting, being served and served per Facility, and waiting times, including the longest Routine wait. After an outage, they back-enter paper-recorded Visits so the records and metrics stay complete.
**FRs covered:** FR21, FR25
**Notes:** the overview module (read-only joins), AD-16 paper entries.

## Definition of Done (every story in Epics 2–7)

Each story is done only when it also meets these cross-cutting requirements:

- **NFR1:** the story's common actions respond in under 1 s on the hospital network, with realistic demo data loaded.
- **NFR5:** it works in current desktop browsers and at tablet width (768 px). Board stories also work in a TV browser.
- **NFR6 and UX-DR19:** WCAG 2.1 AA. Specifically:
  - keyboard operable, with visible focus;
  - 44 px targets;
  - errors tied to their fields;
  - color never the only signal.
- **NFR7:** interface text is in English and follows the EXPERIENCE.md voice.
- **Access and audit (NFR8, NFR9):** new actions are added to `permissions.ts` with tests, and new commands write exactly one audit row.
- **Quality:** `npm run lint`, `npm run build` and `npm test` pass.

## Epic 1: Acme Store Example Dashboard (legacy, done)

The existing work that the hospital system replaces. It is recorded in `_bmad-output/implementation-artifacts/`: 1.1 Initialize Next.js application, 1.2 Example dashboard, 1.3 Stats API (never built; superseded by this plan and not to be implemented), 1.4 Orders search, filters and pagination, 1.5 Restyle to the reference design. No new stories.

## Epic 2: Secure Staff Access and OPD Setup

The Acme Store is replaced by the hospital app shell. Staff sign in with their own accounts, Admins configure the OPD, every action is audited, and the data is backed up nightly.

### Story 2.1: Hospital app shell replaces the store

As a hospital staff member,
I want the app to open as the OPD system instead of the Acme Store,
So that no store screens or sample data remain in a hospital tool.

**Acceptance Criteria:**

**Given** the current codebase
**When** this story is done
**Then** the Acme Store routes, the store sample data in `src/lib/data.ts`, the `orders-*` components and the store copy are removed
**And** the route group `(dashboard)` is renamed `(staff)`, with the top nav reading Overview, Triage, Queues, Patients, Appointments, Directory, each leading to a placeholder page titled "{Surface} | OPD" (UX-DR8, UX-DR19)

**Given** `globals.css`
**When** this story is done
**Then** the semantic tokens `urgent`, `priority`, `routine`, `abnormal`, `board-*` and the full dark set from DESIGN.md exist in `:root`, `.dark` and `@theme`, and typography utilities for `queue-number`, `queue-number-issued` and `board-*` are available (UX-DR1, UX-DR2)
**And** filled buttons use dark text in dark mode

**Given** the story 1.4 table pattern (`orders-toolbar`, `orders-pagination`, `orders-query`, `orders-href`)
**When** the store pages are removed
**Then** the pattern is kept as generic, reusable pieces in `src/components/data-table/` and `src/lib/url-query.ts` (toolbar, pagination, URL parse/build helpers) with unit tests, before the `orders-*` files are deleted (UX-DR21)
**And** the toolbar's search, select and page values follow the URL when it changes from outside (back/forward or a link), fixing the known story 1.5 bug

**Given** the app
**When** `npm run lint` and `npm run build` run
**Then** both pass, and every staff page has a skip link to `<main id="content">`

### Story 2.2: First Admin signs in

As the hospital's first Admin,
I want to create my account on the server and sign in with a username and password,
So that the system is protected from day one without a default password.

**Acceptance Criteria:**

**Given** a fresh install with `.env` holding `DATABASE_PATH`, `BACKUP_DIR`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
**When** `npm run db:migrate` and then `npm run create-admin` run
**Then** Drizzle migrations create the SQLite database (WAL, foreign keys on), and one Admin account exists with the entered username and password (AD-1, AD-9, Operations)
**And** in production, the app refuses to start if any required env value is missing

**Given** a signed-out visitor
**When** they open any staff URL
**Then** `src/proxy.ts` redirects them to `/sign-in`, and after a valid sign-in they land on the URL they asked for (FR1)

**Given** wrong credentials
**When** the Admin tries to sign in
**Then** a generic "Wrong username or password" message is shown, without saying which field was wrong

**Given** any sign-in or sign-out
**When** it happens
**Then** one row is written to the append-only `audit_log` (actor, action, time) through the audit module, and SQLite triggers reject `UPDATE` and `DELETE` on `audit_log` (AD-3, NFR9, NFR14)

**Given** the codebase
**When** this story is done
**Then** these exist: `withCommandTx`, `requireStaff()`, `opdDate()` (Asia/Manila), `GET /api/health` (DB reachability, no patient data), and a Vitest 5 setup against a temp-file SQLite
**And** tests cover `opdDate` at the midnight boundary and audit-log immutability

### Story 2.3: Idle sign-out and account lockout

As a hospital,
I want idle sessions to end and repeated wrong passwords to lock the account,
So that unattended counter PCs and guessed passwords don't expose patient data.

**Acceptance Criteria:**

**Given** a signed-in user with no activity
**When** 14 minutes have passed
**Then** a "You'll be signed out in 60 seconds" dialog appears with **Stay signed in** focused, and it is announced to screen readers (UX-DR10)
**And** if nothing is pressed, the session ends at 15 minutes (FR1)

**Given** an expired session while a form is in progress
**When** the user signs in again in the dialog that opens over the page
**Then** the same user keeps their form input, and a different user gets a fresh page

**Given** background polling requests
**When** they run
**Then** they read the session with `disableRefresh` and never extend it (AD-9)

**Given** 5 failed sign-ins in a row for one username
**When** the 5th fails
**Then** the account is locked (`locked_at` set, audited), and sign-in shows "Account locked after 5 failed attempts. Ask an Admin to unlock it."

### Story 2.4: Admin configures OPD Facilities

As an Admin,
I want to set up the Facilities with their prefixes, opening days, hours and pilot live flag,
So that queues, triage and appointments follow the hospital's real schedule.

**Acceptance Criteria:**

**Given** a fresh database
**When** migrations run
**Then** the four default Facilities exist, all live, open Mon–Sat 7:00–17:00: Prenatal (PN), Animal Bite Center (AB), Treatment (TR) and Consultation (CN) (AD-8)

**Given** the Admin on `/admin/settings` → Facilities
**When** they edit a Facility's name, prefix, days, hours or `is_live`
**Then** the change is saved and audited, and prefixes must be unique (FR23)
**And** a prefix change takes effect on the next OPD day

**Given** a Facility
**When** the Admin deactivates it
**Then** it is hidden from new assignments (the rule that blocks deactivation while patients are waiting is added with the queue in Story 4.1)

**Given** the settings module
**When** other modules need Facilities
**Then** they call `settings.liveFacilities()` and `settings.isOpen(facility, instant)`, both covered by tests that include the day boundary

**Given** `src/server/auth/permissions.ts` (created in this story)
**When** a settings action runs
**Then** it calls `can()` against the Role × action map, which declares the Facility scope for each action, and only Admins may change settings (AD-4, FR2)
**And** a non-Admin opening `/admin/settings` sees "You don't have access to this page." with no data

### Story 2.5: Admin manages staff accounts and roles

As an Admin,
I want to create staff accounts, assign a Role and Facilities, and unlock or deactivate accounts,
So that every nurse and staff member has their own login with the right access.

**Acceptance Criteria:**

**Given** the Admin on `/admin/staff`
**When** they create an account with full name, username, temporary password, Role (Triage Nurse, Facility Staff or Admin) and, for Facility Staff, one or more of the configured Facilities
**Then** the account is created and audited, and appears in a story 1.4-pattern table that can be searched and filtered by Role and status (FR3)

**Given** a locked account
**When** the Admin chooses **Unlock**
**Then** `failed_attempts` resets, `locked_at` clears, and the unlock is audited

**Given** an active account
**When** the Admin deactivates it
**Then** it can no longer sign in, and its past audit rows still show the person's name (FR3, NFR14)

**Given** the permission map from Story 2.4
**When** this story is done
**Then** it covers the staff-management actions, and the top nav hides items a Role cannot use (FR2)
**And** Vitest tests check each Role against every action defined so far, and every later story adds its actions to the map with tests

### Story 2.6: Admin configures triage and clinical settings

As an Admin,
I want to manage Urgency Levels, Priority Categories, Animal Bite Center dose schedules, the prenatal target and queue thresholds,
So that hospital policy changes don't need a developer.

**Acceptance Criteria:**

**Given** a fresh database
**When** migrations run
**Then** these defaults exist:
- Urgency Levels: Emergency (ER flag), Urgent (rank 1), Routine (rank 2).
- Priority Categories: Senior Citizen and PWD (on, legally required), Pregnant (on).
- Animal Bite Center schedules: new patient Day 0/3/7; previously immunized Day 0/3.
- Prenatal target 8, No-show threshold 3 calls, pre-close warning 30 minutes.

**Given** the Admin editing Urgency Levels
**When** they save
**Then** the save is rejected with an error on the field unless at least one non-ER level exists and every rank is unique (FR24)

**Given** the Admin turning off Senior Citizen or PWD
**When** they toggle it
**Then** a warning, "Legally required (RA 9994 / RA 10754)", asks for confirmation before saving

**Given** any settings change
**When** it is saved
**Then** it is audited with old and new values, and the settings getters return the new values

### Story 2.7: Admin reviews the audit log

As an Admin,
I want to search the audit log by staff member, record, action and date,
So that the hospital can quickly answer "who saw or changed what", including for a breach report.

**Acceptance Criteria:**

**Given** the Admin on `/admin/audit`
**When** they filter by staff member, action, entity or record ID, and date range
**Then** matching rows are listed newest first, with time (Manila), actor, action, entity and changed fields, in a story 1.4-pattern table with filters kept in the URL (FR26, NFR13)

**Given** any non-Admin
**When** they open `/admin/audit`
**Then** they see the no-access page and no rows

**Given** the audit page
**When** it is viewed
**Then** there is no edit or delete control, and the view itself is audited

### Story 2.8: Nightly backup and scheduled jobs

As a hospital IT officer,
I want the database backed up automatically every night and scheduled jobs to run reliably,
So that a disk failure never loses the OPD's records.

**Acceptance Criteria:**

**Given** the server starts
**When** `src/instrumentation.ts` runs
**Then** one in-process scheduler starts, once per process, and runs its jobs as the `system` actor (AD-14)
**And** each job is idempotent through `job_runs(job, key)`, and missed keys are caught up on startup

**Given** 02:00 Manila time each day
**When** the backup job runs
**Then** `VACUUM INTO` writes a dated file to `BACKUP_DIR`, the newest 30 files are kept and older ones deleted, and the run is audited (AD-12)

**Given** `npm run db:migrate`
**When** it runs
**Then** it writes a pre-migration backup first

**Given** `GET /api/health`
**When** it is called
**Then** it reports DB reachability, the last successful backup time and the last run of each job, with no patient data

**Given** the repository
**When** this story is done
**Then** `docs/operations.md` describes:
- the deploy order and the env contract;
- create-admin and the restore drill;
- the OS-encrypted volume for the database and backups, and TLS at the reverse proxy (NFR10);
- the paper-slip fallback for outages during OPD hours (NFR3).

## Epic 3: Patient Registration and Triage

Triage Nurses find or register Patients, record Triage, and issue a printed Queue Number in priority order, or direct the patient to the ER.

### Story 3.1: Find patients

As a Triage Nurse,
I want to search patients by name, Hospital Number, birthdate or phone,
So that I find returning patients in seconds instead of creating duplicates.

**Acceptance Criteria:**

**Given** the `patients` table (created here) and fictional patients loaded by `npm run db:seed:demo`, which refuses to run in production
**When** staff type in the Patients search or the Triage finder
**Then** results update 300 ms after typing and match, regardless of case: partial names, Hospital Numbers, birthdates in `YYYY-MM-DD` or `MM/DD/YYYY`, and phone numbers (FR4)
**And** each result shows name, calculated age, sex, Hospital Number (mono) and last Visit date or "No visits"

**Given** the finder
**When** the nurse uses ↑/↓ and Enter
**Then** the highlighted patient is selected, Esc clears the search, and `Ctrl+K` focuses the finder (UX-DR9)

**Given** `/patients`
**When** it loads
**Then** it uses the story 1.4 URL-driven table with pagination, and shows the empty state "No patients match …" with suggestions (UX-DR21)

### Story 3.2: Register a new patient

As a Triage Nurse,
I want to register a new patient with only the essential fields,
So that the line keeps moving and the patient gets a Hospital Number.

**Acceptance Criteria:**

**Given** no match in the finder
**When** the nurse chooses the "New patient" row
**Then** an inline form opens (FR5, NFR11, UX-DR12) with:
- the required fields shown: full name, sex, birthdate, address, contact number;
- the optional fields collapsed: PhilHealth PIN, Senior Citizen ID, PWD ID, emergency contact;
- a required "Privacy notice explained to the patient" checkbox.

**Given** a valid form
**When** it is saved
**Then** in one transaction the Patient Record is created with a Hospital Number `HN-YYYY-NNNNNN` from the counter, the consent time is stored, and one audit row is written

**Given** a name and birthdate matching an existing patient
**When** the nurse saves
**Then** a "Possible match" card offers **Use this record** or **Create anyway** before anything is created

**Given** a future birthdate or a missing required field
**When** the nurse saves
**Then** the error is shown on the field, and focus moves to the first error (UX-DR19)

### Story 3.3: View and update a patient record

As a staff member,
I want to open a patient's record and correct their details,
So that everyone works from accurate information and every look at it is accountable.

**Acceptance Criteria:**

**Given** a patient
**When** staff open `/patients/[id]`
**Then** it shows demographics, IDs and Visit history (empty until visits exist), loaded through `patients.getRecordView()`, which writes a `patient.view` audit row (FR6, AD-3, NFR9)

**Given** a Triage Nurse or Admin
**When** they edit demographics and save
**Then** the change is saved with an audit row holding the old and new values, and Facility Staff see the record read-only (FR2 matrix)

**Given** any patient record
**When** a user looks for a delete action
**Then** none exists (NFR12)

### Story 3.4: Record triage for a visit

As a Triage Nurse,
I want to record the chief complaint, Vital Signs, Urgency Level and Priority Category in one keyboard-friendly form,
So that every patient is assessed the same, safe way.

**Acceptance Criteria:**

**Given** a selected patient on `/triage`
**When** the nurse fills in the form: Chief Complaint, then Vital Signs (temperature, BP, pulse, respiratory rate, SpO₂, weight), then Urgency Level, then Priority Category
**Then** Tab follows that order, number keys pick the Urgency Level only while that control has focus, and levels and categories come from settings (FR7, UX-DR11)

**Given** a Vital Sign outside the normal range (e.g. 39.2 °C)
**When** it is entered
**Then** the field shows the amber abnormal style with an icon and hint text, and can still be saved (UX-DR6)

**Given** an impossible value (e.g. 93.2 °C)
**When** the nurse tries to continue
**Then** a red error on the field blocks it

**Given** Priority Category options
**When** the patient is male
**Then** Pregnant is not offered
**And** choosing Senior Citizen for a patient under 60 shows an error

**Given** Senior Citizen or PWD is chosen and no ID is on file
**When** the nurse continues
**Then** they either enter the ID or tick "ID not presented", and that choice is recorded

**Given** a completed form
**When** the nurse saves it (`Ctrl+Enter`)
**Then** in one transaction `visits.open(tx)` opens a Visit with its `opd_date`, a Triage Record stores the priority snapshot (`urgency_rank`, `sort_group`, `priority_category`), and one audit row is written (AD-3, AD-6, AD-13)
**And** the Visit stays *Open*, awaiting a Facility, and appears in the patient's Visit history

### Story 3.5: Issue a queue number or direct to the ER

As a Triage Nurse,
I want to choose the Facility and issue the next Queue Number in the right priority position,
So that the patient knows where to go and how many are ahead of them.

**Acceptance Criteria:**

**Given** a valid triage form and a live, open Facility tile
**When** the nurse presses **Issue queue number** or `Ctrl+Enter`
**Then** the Story 3.4 save command is extended into one IMMEDIATE transaction (FR8, AD-3, AD-5, AD-6) that:
- saves the Visit and Triage Record;
- creates a Queue Entry with the next `seq` from `queue_counters` for that Facility and OPD day, plus the stored `prefix`, the priority snapshot and `entered_at`;
- writes one audit row.

**And** a cyan banner shows the number (e.g. `CN-014`) in `queue-number-issued` with "{Facility} · N ahead", where N follows the FR9 order

**Given** two nurses issuing numbers for the same Facility at the same moment
**When** both commit
**Then** they get different, consecutive numbers, as a Vitest concurrency test proves (NFR4)

**Given** existing Queue Entries
**When** they are listed
**Then** one repo function orders them by `sort_group`, `urgency_rank`, then `entered_at` (FR9)
**And** tests prove a Senior Citizen arriving after three Routine patients goes ahead of all three, and patients in the same group keep arrival order

**Given** a closed or not-live Facility
**When** the Facility tiles show
**Then** that tile is disabled, with the reason as text

**Given** the ER-flagged Urgency Level
**When** the nurse confirms "No queue number will be issued"
**Then** the Visit ends as *Directed to ER*, the panel shows "Directed to ER · Visit closed {time}", and Esc starts the next patient (UX-DR11)

**Given** the confirmation screen
**When** the nurse presses Esc
**Then** the screen clears and focus returns to the finder

### Story 3.6: Print the queue slip

As a Triage Nurse,
I want to print a small slip with the Queue Number,
So that the patient can match it to the waiting-area screen.

**Acceptance Criteria:**

**Given** the issue confirmation
**When** the nurse presses Enter or **Print slip**
**Then** `/print/slip/[entryId]` opens the print dialog with the hospital name, Facility, the large Queue Number, the date and time, and "Please wait for your number on the screen." (UX-DR17)
**And** the slip contains no name, complaint or priority

**Given** 58 mm, 80 mm and A4 paper
**When** the slip is printed
**Then** the layout fits each size without cutting off the number

## Epic 4: Facility Queues and Service

Staff at each Facility work their live queue: calling, serving, recording outcomes and Facility fields, and referring. Queues close and reset every day.

### Story 4.1: Live facility queue

As a Facility Staff member,
I want to see my Facility's queue update by itself, in the right order,
So that I always know who is next without refreshing.

**Acceptance Criteria:**

**Given** Facility Staff assigned to the Animal Bite Center
**When** they open `/queues/animal-bite-center`
**Then** they see Waiting, Called and Serving entries in FR9 order (FR10, UX-DR3–5, UX-DR13), each showing:
- the Queue Number chip;
- name, age and sex;
- the group badge (text and icon) and the status badge;
- time waited and the complaint, truncated.

**And** staff of other Facilities get the no-access page

**Given** a new entry issued at Triage
**When** up to 5 seconds pass
**Then** it appears without a reload, through TanStack Query polling a read-only handler every 3 s (AD-10, NFR2, UX-DR19)
**And** the rail tile's waiting count updates, and an `aria-live` message announces "AB-011 added, routine"

**Given** the list refreshes while a row has keyboard focus
**When** the refresh finishes
**Then** focus stays on the same entry and the page does not scroll

**Given** 2 polls fail in a row
**When** the connection is lost
**Then** an amber strip shows "Connection lost, the list may be out of date. Retrying…" (UX-DR18)

**Given** the left rail
**When** any staff page loads
**Then** it shows one tile per live Facility the user may access, with its prefix, name and waiting count (UX-DR8)

**Given** a Facility with entries still waiting
**When** an Admin tries to deactivate it
**Then** deactivation is blocked with "{Facility} still has {N} waiting." (FR23)

### Story 4.2: Call next, recall and start serving

As a Facility Staff member,
I want to call the next patient, recall them and start serving,
So that patients are served in the fair order and several counters can work at once.

**Acceptance Criteria:**

**Given** Waiting entries and no active entry of my own
**When** I press **Call next** (the orange CTA) or `Alt+N`
**Then** one IMMEDIATE transaction makes the top Waiting entry Called, with `called_by` set to me, `called_at` to now and `call_count` to 1, and audits it (FR11, AD-5)

**Given** two staff at the same Facility pressing Call next at the same moment
**When** both commit
**Then** each gets a different patient, as a Vitest concurrency test proves (NFR4)

**Given** I already have a Called or Serving entry
**When** I look at Call next
**Then** it is disabled with the reason "AB-006 is yours. Complete or refer it to call the next number.", and colleagues can still call

**Given** my Called entry
**When** I press **Recall** or `Alt+R`
**Then** `call_count` goes up by one and `called_at` is refreshed
**And** **Start serving** or `Alt+S` moves the entry to Serving

**Given** Called and Serving entries from several staff
**When** the list shows
**Then** those entries are pinned at the top with the staff name ("Serving · Mark"), mine first

**Given** an invalid transition, such as serving a Waiting entry
**When** it is attempted
**Then** the service raises `invalid_transition`, and the UI shows a toast and keeps working (AD-15, UX-DR18)

**Given** focus is in a text field
**When** an `Alt+` shortcut is pressed
**Then** nothing happens
**And** `?` opens the shortcut help dialog (UX-DR9)

### Story 4.3: No-show, restore and calling a specific patient

As a Facility Staff member,
I want to mark a patient who doesn't come as No-show, restore them if they return, and call someone out of order only with a reason,
So that the queue keeps moving and exceptions are accountable.

**Acceptance Criteria:**

**Given** my Called entry with `call_count` at or above the No-show threshold from settings
**When** I choose **Mark No-show** and confirm "Mark AB-006 as No-show?"
**Then** the entry becomes No-show, is audited, and moves to a collapsed "No-show (restore)" section (FR11)

**Given** a No-show entry on the same OPD day
**When** staff choose **Restore**
**Then** it goes back to Waiting at its original `entered_at` position

**Given** a Waiting entry that is not first
**When** staff choose **Call this one** from the row's "⋯" menu
**Then** a reason is required, and it is stored in the audit row

### Story 4.4: Serve and complete a visit

As a Facility Staff member,
I want to see the patient's triage data and history while serving, and record what I did,
So that I work from the right information and the visit is closed properly.

**Acceptance Criteria:**

**Given** my Serving entry
**When** the Serving panel opens
**Then** it shows, through the audited `patients.getRecordView()`, the Vital Signs with abnormal flags, the complaint, Urgency and Priority, and the last 3 Visits (UX-DR14, AD-3)

**Given** the Serving panel
**When** I write the service note and press **Complete** (green) or `Alt+C`
**Then** (FR13, AD-13):
- a `facility_records` row stores the outcome and note;
- the entry becomes Completed;
- `visits.onEntryTerminal(tx)` updates the Visit;
- one audit row is written.

**And** the entry leaves the list, and the note shows in the Patient Record's Visit history

**Given** a tablet (768–1023 px)
**When** the panel opens
**Then** it is a bottom sheet, and every target is at least 44 px (UX-DR20)

### Story 4.5: Animal Bite Center and Prenatal fields

As an Animal Bite Center or Prenatal staff member,
I want structured fields for my Facility's visits,
So that vaccination and prenatal data is complete and consistent.

**Acceptance Criteria:**

**Given** an Animal Bite Center Serving entry
**When** the panel shows
**Then** it has these fields, stored in `facility_records` on Complete (FR22):
- biting animal, owned or stray, exposure date, bite site;
- exposure category (I, II or III);
- vaccine brand, route and dose day (0, 3 or 7);
- RIG type: ERIG, HRIG, not given or not indicated;
- prior vaccination status and outcome.

**Given** exposure category I
**When** the entry is saved
**Then** no vaccine dose fields are required

**Given** a Prenatal Serving entry
**When** the panel shows
**Then** it has these fields:
- gestational age and expected date of delivery;
- contact number, pre-filled with the count plus 1;
- BP and weight from Triage, read-only;
- fundal height, tetanus toxoid dose, iron/folic acid given, and notes.

**Given** a missing required Facility field
**When** staff press Complete
**Then** the error shows on the field and completion is blocked

### Story 4.6: Refer a patient to another facility

As a Facility Staff member,
I want to refer the patient to another Facility without triaging them again,
So that patients who need two services don't start over.

**Acceptance Criteria:**

**Given** my Serving entry
**When** I choose **Refer to… → Consultation**, enter a reason and confirm
**Then** one transaction (FR14, AD-6):
- ends the current entry as Referred;
- creates a Consultation entry with the next CN number, a copy of the Urgency and Priority snapshot, and the referral time as `entered_at`;
- writes one audit row naming both numbers.

**And** the confirmation shows the new number, and the old row shows "Referred → CN-021"

**Given** Treatment Facility Staff
**When** they refer a patient to Consultation
**Then** it is allowed, because the scope is the source Facility (AD-4)

**Given** a target Facility that is not live yet (pilot)
**When** it is chosen
**Then** it is selectable, labeled "(not live yet)"
**And** the Referral is recorded with no new entry, with the message "give the patient a paper number" (PRD §10)

### Story 4.7: Closing time and daily reset

As an OPD head,
I want queues to close automatically at each Facility's closing time and start fresh the next day,
So that nobody is left in an invisible queue overnight and numbering restarts at 001.

**Acceptance Criteria:**

**Given** a Facility with entries still Waiting 30 minutes before closing
**When** that time is reached
**Then** its queue page shows the banner "Closes at 5:00 PM. 6 still waiting." (UX-DR18)

**Given** the Facility's closing time
**When** the facility-close job runs with key `facility-close:<facility>:<opd_date>`
**Then** the `system` actor, through the queue service, cancels Waiting and Called entries (end of day), and `visits` finalizes their Visits (FR12, AD-14)
**And** the run is recorded once, even if the job runs again

**Given** the server was down at closing time
**When** it starts
**Then** the job catches up the missed key

**Given** the next OPD day
**When** the first number is issued
**Then** it is `{prefix}-001`, and a prefix changed the day before is now in effect (FR23)

## Epic 5: Waiting-Area Display Board

The waiting-area TV shows each Facility's now-serving and next numbers, with a highlight and chime on every call. It only runs on registered screens.

### Story 5.1: Register display screens

As an Admin,
I want to register a TV as a display screen with a pairing code, and revoke it,
So that only the hospital's screens can show the queue.

**Acceptance Criteria:**

**Given** a browser opening `/board` without a device token
**When** the page loads
**Then** it shows a 6-character pairing code and "Ask an Admin to register this screen.", with no queue data (FR27, UX-DR16)

**Given** the Admin on `/admin/devices`
**When** they enter the code and a name ("Main waiting hall") and choose **Register**
**Then** a `display_devices` row is created, the TV gets an httpOnly device token within 3 s, and the registration is audited (AD-11)

**Given** a registered device
**When** the Admin chooses **Revoke**
**Then** the TV returns to the pairing screen within one refresh cycle

### Story 5.2: Now-serving display board

As a patient in the waiting area,
I want to see which number each Facility is serving and be alerted when a number is called,
So that I don't miss my turn and nobody has to shout names.

**Acceptance Criteria:**

**Given** a registered TV at 1920×1080
**When** `/board` loads
**Then** it uses the fixed dark scheme with a 2×2 grid of live Facilities (1×N if there are fewer) (FR16, UX-DR16)
**And** each tile shows the Facility name and prefix, the now-serving numbers (one per counter) and the next 3 Waiting numbers
**And** the page never scrolls

**Given** the board data
**When** the endpoint responds
**Then** `DisplayBoardDTO` contains only the Facility name and prefix, and Queue Numbers with their status and `calledAt`: no names, complaints or priority (AD-11, NFR8)
**And** a type-level test asserts this shape

**Given** a number is called or recalled
**When** its `calledAt` changes
**Then** within 5 s the tile turns gold with dark text and "Now calling" for 8 s, and the chime plays once (NFR2)
**And** under reduced motion the tile changes without the flash

**Given** the TV browser blocks audio
**When** the board loads
**Then** a small note shows "Sound off: click to enable", and the visuals still work

**Given** 2 polls fail in a row
**When** the connection drops
**Then** "Reconnecting…" shows and the numbers dim until data returns

## Epic 6: Appointments, Follow-ups and Doctor Directory

Staff book and check in Appointments and follow-ups. Admins keep the doctor directory and duty days.

### Story 6.1: Doctors and departments directory

As an Admin,
I want to keep a list of Departments and Doctors with the Facilities they serve,
So that staff know who works where.

**Acceptance Criteria:**

**Given** the Admin on `/directory`
**When** they create, edit or deactivate a Department or a Doctor (name, Department, specialty, Facilities)
**Then** the change is saved and audited, and the list uses the story 1.4 table pattern with search and a Department filter (FR19)

**Given** a non-Admin
**When** they open `/directory`
**Then** they can read it but see no edit controls

### Story 6.2: Doctor duty days

As an Admin,
I want to set which days each Doctor works at each Facility,
So that staff can see who is on duty and appointments match doctor availability.

**Acceptance Criteria:**

**Given** a Doctor
**When** the Admin sets duty days per Facility (weekday, and morning, afternoon or whole day)
**Then** the schedule is saved and audited (FR20)

**Given** any staff member
**When** they open **On duty today**
**Then** today's Doctors are listed per Facility, and a Facility with nobody on duty shows "No doctor on duty"

### Story 6.3: Book and manage appointments

As a staff member,
I want to book, reschedule and cancel appointments and see each day's list,
So that returning patients have a planned date.

**Acceptance Criteria:**

**Given** a patient
**When** staff book an Appointment with a Facility, date, optional Doctor and note
**Then** it is saved as Booked with its `opd_date`, audited, and shown in the Patient Record's upcoming list (FR17)

**Given** a date when the Facility is closed or the Doctor is off duty
**When** staff pick that date
**Then** it is disabled in the picker, and the server rejects it anyway

**Given** `/appointments`
**When** staff filter by day, Facility and status
**Then** the list uses the story 1.4 table pattern (FR18, AD-15)
**And** rows offer Reschedule and Cancel (with a reason), following the Appointment state machine

### Story 6.4: Check in appointments and mark missed

As a Triage Nurse,
I want to check in a patient who has an appointment today, and have unchecked appointments marked missed,
So that appointment patients flow into triage and missed appointments are counted.

**Acceptance Criteria:**

**Given** `/triage`
**When** the nurse opens the **Today's appointments** tab and chooses **Check in**
**Then** `appointments.checkIn(tx)` (FR18, AD-13):
- opens the Visit through `visits.open`;
- sets `appointments.visit_id` and marks the Appointment Checked in;
- loads the patient into the triage form with the Facility preset.

**Given** the checked-in Visit
**When** its queue entry is later completed
**Then** the Appointment shows Completed

**Given** the last Facility closing time of the day
**When** the appointments-missed job runs
**Then** that day's Booked appointments become Missed, as the `system` actor and idempotently (AD-14)

### Story 6.5: Book a follow-up from the Serving panel

As a Facility Staff member,
I want the next dose or visit date suggested when I finish serving,
So that Animal Bite Center and Prenatal patients return on schedule.

**Acceptance Criteria:**

**Given** a new Animal Bite Center patient's visit completed with a Day 0 dose
**When** staff choose **Book follow-up**
**Then** the Appointment sheet suggests Day 3 and Day 7 dates from the settings schedule, moved to the next open day if the Facility is closed (FR15, UX-DR15)
**And** staff can change the dates before booking

**Given** a previously immunized patient
**When** the sheet opens
**Then** it suggests the booster schedule from settings

**Given** a Prenatal visit
**When** the sheet opens
**Then** it shows "Contact 4 of 8", with the target taken from settings

**Given** booked follow-ups
**When** staff choose **Print appointment card**
**Then** it prints only the patient name, Facility and dates, with no clinical data, on 58–80 mm or A4 paper (UX-DR17)

**Given** staff booking a follow-up at another Facility
**When** the permission check runs
**Then** it is allowed, because the scope is the source entry's Facility (AD-4)

## Epic 7: OPD Overview and Outage Recovery

The day's OPD overview, and back-entry of paper-recorded visits after an outage.

### Story 7.1: OPD overview

As an OPD head or staff member,
I want a live overview of today's queues and waiting times for each Facility,
So that I can move staff to where the queue is longest and see if Routine patients wait too long.

**Acceptance Criteria:**

**Given** any signed-in staff member opening `/`
**When** it loads
**Then** each Facility card shows, for today's `opd_date` (FR21):
- Visits triaged;
- entries waiting, being served, served and No-show;
- the average and longest current wait.

**And** the cyan banner reads "{N} waiting · longest Routine wait {M} min", and each card links to its queue

**Given** the page is open
**When** queues change
**Then** the tiles refresh by polling within 5 s (AD-10)

**Given** Appointments exist for today
**When** the overview loads
**Then** it shows how many were booked and how many checked in

**Given** test data
**When** the overview numbers are computed
**Then** a test proves they match the queue and appointment rows for the same `opd_date` (AD-7)

### Story 7.2: Enter paper-recorded visits after an outage

As a Triage Nurse or Admin,
I want to enter visits that were recorded on paper during an outage,
So that patient histories and daily numbers stay complete.

**Acceptance Criteria:**

**Given** `/admin/paper-entry`
**When** the user enters the patient (found or registered), the real date and times, the triage data, the handwritten number and the outcome (Completed, Referred, No-show or Directed to ER)
**Then** (FR25, AD-16):
- `visits.open` creates a Visit marked `entered_from_paper`, with the real `opd_date`;
- `queue.recordPaperEntry()` stores the paper number with no counter `seq`;
- it is audited as "Entered from paper".

**Given** a paper entry for today
**When** the queues, the board and the overview show
**Then** the entry never appears as live, but it counts in the day's served totals and the Visit history

**Given** the form
**When** it is saved
**Then** the day's paper entries are listed below the form, with who entered them
