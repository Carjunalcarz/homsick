# Hospital OPD Management System

A web app for the hospital's Outpatient Department (OPD): triage, per-Facility queues, the waiting-area Display Board, appointments and the Doctor directory. Built with [Next.js](https://nextjs.org) (App Router), TypeScript, Tailwind CSS 4 and shadcn/ui.

Status: the app shell, the SQLite database, staff sign-in, the audit log, OPD settings (Facilities, Urgency Levels, Priority Categories, schedules and thresholds) and staff account management, the nightly backup with its jobs scheduler, finding patients (the `/patients` list and the Patient finder on `/triage`), registering new patients on `/triage`, and viewing and editing a Patient Record (`/patients/[id]`) are in place. The other staff pages (Overview, Queues, Appointments, Directory) are placeholders that the following stories fill in.

## Requirements

- Node.js 24
- npm (this project uses npm; don't mix in other package managers)

## Setup

```bash
npm install
cp .env.example .env        # then set BETTER_AUTH_SECRET (see the file)
npm run db:migrate          # creates data/dev.sqlite and applies drizzle/ migrations
npm run create-admin        # prompts for full name, username and password
npm run db:seed:demo        # optional: 42 fictional patients (never in production)
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) and sign in with the Admin you created. There is no default account or password; every Admin comes from `create-admin`, and each person gets their own account.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server at [http://localhost:3000](http://localhost:3000) |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run lint` | Run ESLint |
| `npm test` | Run the unit tests once (Vitest) |
| `npm run db:migrate` | Back up an existing database to `BACKUP_DIR/pre-migrate-<UTC timestamp>.sqlite`, then apply the committed migrations in `drizzle/` to `DATABASE_PATH` (a failed backup stops it with exit code 1) |
| `npm run db:generate` | Generate a new migration from the `src/server/*/schema.ts` files (add `-- --custom --name=x` for hand-written SQL) |
| `npm run create-admin` | Create an Admin account. Prompts for full name, username and password (hidden, entered twice). For scripts: set `OPD_ADMIN_PASSWORD` and run `npm run create-admin -- --name "Ana Cruz" --username ana.cruz` |
| `npm run db:seed:demo` | Add 42 fictional demo patients (see "Patients"). Refuses with exit code 1 when `NODE_ENV=production` ("Demo data is never loaded in production.") and on a second run |
| `npm run unlock-user -- --username x` | Unlock an account locked after 5 failed sign-ins (see "Sessions and lockout") |

Usernames are 3–30 characters: lowercase letters, digits, `.`, `_` and `-`, not starting or ending with `.`, `_` or `-` and without two dots in a row. Generic names such as `admin` or `root` are refused, because each person gets their own account. Passwords are 10–128 characters.

`create-admin` also accepts `--password "..."`, but avoid it: the password then ends up in your shell history and is visible in the process list. Use the hidden prompt, or `OPD_ADMIN_PASSWORD` for scripts. `create-admin`, `unlock-user` and `db:migrate` print the mode and database path before writing, and refuse to run when `NODE_ENV=production` and `DATABASE_PATH` is not set.

## Sessions and lockout

- **15-minute idle sign-out.** A session ends 15 minutes after the last real activity (keys, pointer, scrolling, returning to the tab). Activity refreshes the session at most once a minute. Background polling of `/api/auth-status` never extends it. One minute before the end a dialog says "You'll be signed out in 60 seconds." with **Stay signed in** focused. When the session ends, a sign-in dialog opens over the page: signing in again as the same person keeps the page as it was, anyone else gets a fresh page.
- **Lockout.** After 5 consecutive wrong passwords the account locks, and every sign-in shows "Account locked after 5 failed attempts. Ask an Admin to unlock it." until it is unlocked, even with the right password. A successful sign-in resets the count. Lock and unlock are audited (`auth.locked`, `auth.unlocked`). Deactivation is separate (see "Staff accounts").
- **Rate limit.** At most 10 failed sign-ins per minute from one address on the sign-in page (successful sign-ins don't count), and 10 attempts per minute on the `/api/auth` sign-in route. Further attempts get "Too many sign-in attempts. Wait a minute and try again." without a password check. The address is the **rightmost** `X-Forwarded-For` entry, then `X-Real-IP`: the reverse proxy must set or overwrite these headers (for nginx, `proxy_set_header X-Forwarded-For $remote_addr;` or `$proxy_add_x_forwarded_for` as the last hop, and `proxy_set_header X-Real-IP $remote_addr;`). Without an address, the limit applies per attempted username instead.
- **Unlocking.** Admins choose **Unlock** in the row menu on `/admin/staff`. When the only Admin is locked out, unlock from the server:

  ```bash
  npm run unlock-user -- --username liza.test
  ```

  It prints the mode and database path, writes one `auth.unlocked` row (actor `system`), and exits non-zero for an unknown username. For an account that isn't locked it only resets the failure count, with no audit row.
- **Testing the idle flow.** Outside production only, `OPD_SESSION_SECONDS` (shorter than 900, at least 30) and `OPD_WARN_SECONDS` shorten the timings, e.g. `OPD_SESSION_SECONDS=90 OPD_WARN_SECONDS=30`. Both are ignored when `NODE_ENV=production`.

## Environment variables

Copy `.env.example` to `.env` (git ignores it). In production (`next start`) every value is required, and the server refuses to start if one is missing.

| Variable | Meaning | Development default |
|---|---|---|
| `DATABASE_PATH` | The SQLite database file | `data/dev.sqlite` |
| `BACKUP_DIR` | Where the nightly and pre-migrate backups go (a separate encrypted disk in production) | `data/backups` |
| `BETTER_AUTH_SECRET` | Session signing secret, at least 32 characters | Better Auth's dev secret |
| `BETTER_AUTH_URL` | The URL staff open the app at | `http://localhost:3000` |
| `OPD_SESSION_SECONDS` | Non-production only, for manual testing: a shorter idle session (30–900 seconds). Ignored in production; an invalid value logs a warning and is ignored | 900 |
| `OPD_WARN_SECONDS` | Non-production only, for manual testing: how long before expiry the warning opens. Ignored in production; an invalid value logs a warning and is ignored | 60 |

`data/` is git-ignored.

## Operations

[docs/operations.md](docs/operations.md) covers the production deploy order (`npm ci`, build, `db:migrate`, restart), the `.env` contract, `create-admin` and `unlock-user`, the scheduled jobs, backups (nightly at 02:00 Manila, the newest 30 kept, plus pre-migrate copies) and how to check them in `/api/health`, the restore drill, disk encryption and TLS, and the paper-slip fallback during outages.

## Pages

| Route | Surface |
|---|---|
| `/sign-in` | Sign in (the only page reachable signed out, with `/api/health`) |
| `/` | Overview |
| `/triage` | Triage: the Patient finder (see "Patients") |
| `/queues` | Queues |
| `/patients` | Find patients (the header search submits to `/patients?q=`; see "Patients") |
| `/patients/[id]` | A Patient Record, "Patient record" in the tab (every view is audited; see "Patients") |
| `/appointments` | Appointments |
| `/directory` | Directory |
| `/admin/staff` | Staff accounts, Roles and Facilities (Admins only; see "Staff accounts") |
| `/admin/settings` | OPD Settings: Facilities, triage and clinical settings (Admins only; see "Admin settings") |
| `/admin/audit` | The read-only audit log (Admins only; see "Audit log") |
| `/print/slip/[entryId]` | A printable queue slip, "Queue slip" in the tab, outside the staff shell (Triage Nurses and Admins; see "Queue slips") |
| `/api/health` | `{ ok, db: "up" \| "down", time, lastBackupAt, backupStale, jobs: [{ job, key, status, finishedAt }] }`: 200 when the database answers, otherwise 503. `backupStale` is true when there is no successful backup in the last 26 hours (it does not change the status). No user or patient data |
| `/api/auth-status` | `{ signedIn, userId, expiresAt, now }` for the idle-timeout guard; reads the session without extending it |

Every page title reads "{Surface} | OPD". Signed-out visits to a staff page go to `/sign-in?next=<page>` and return there after sign-in; `next` only accepts a path on this site.

## Admin settings

Admins reach **OPD Settings** (`/admin/settings`) and **Staff** (`/admin/staff`) from the Admin links in the header's user area (or the menu sheet on small screens). Other Roles don't see the link, and opening the page directly shows "You don't have access to this page." with a link to Overview and no data.

**Facilities.** A fresh `db:migrate` seeds the four default Facilities (in migration `0003_facilities`, the only place the list is written down): Prenatal (PN), Animal Bite Center (AB), Treatment (TR) and Consultation (CN), all live, open Mon–Sat 07:00–17:00. Each card shows the prefix, open days, hours, Live / Not live and Active / Deactivated. **Edit** opens a side sheet:

- **Name:** 2–60 characters, unique among active Facilities.
- **Queue prefix:** 2–3 letters A–Z, unique across every other Facility's current and pending prefix ("Prefix already in use"). A new prefix takes effect on the **next OPD day** (Manila midnight); today keeps the old one, and the card shows "Prefix changes to XY on {date}". Entering the current prefix again cancels a pending change.
- **Open days** (at least one), **Opens at** / **Closes at** (`HH:MM`, closing later than opening) and **Live** apply at once. A Facility that is not live is left out of `liveFacilities()`.
- **Deactivate** / **Reactivate** ask for confirmation naming the Facility. Nothing is deleted. Blocking deactivation while patients are waiting comes with the queues (Story 4.1).

Every change writes one audit row (`settings.facility_updated`, `settings.facility_deactivated`, `settings.facility_reactivated`) with the old and new values of the changed fields. A save that changes nothing writes nothing.

**Triage and clinical settings.** Below Facilities, the same page holds four more sections (migration `0006_clinical_settings` seeds the defaults). Every change applies to **new entries only**; nothing already stored is rewritten.

| Setting | Default | Rules |
|---|---|---|
| **Urgency Levels** | Emergency (ER), Urgent (rank 1), Routine (rank 2) | Names 2–30 characters, unique ignoring case. ER levels have no rank; the others have a unique whole-number rank, lower served first (ranks 1–99, at most 20 levels). At least one level must not be ER ("Keep at least one level that isn't ER."). **Edit** saves the whole list: rename, re-rank, **Add level**, **Remove** (soft: `deactivated_at`; ids never change). |
| **Priority Categories** | Senior Citizen (RA 9994), PWD (RA 10754), Pregnant (hospital policy), all on | A fixed set: only on/off can change. |
| **Animal Bite Center schedules** | New patient Day 0, 3, 7; previously immunized Day 0, 3 | Comma-separated dose days: start at Day 0, then later days in order, whole days 0–90, 2–10 doses. |
| **Queue and prenatal** | Prenatal target 8, No-show after 3 calls, pre-close warning 30 min, hospital name "Hospital OPD" | Prenatal target 1–20, No-show threshold 1–10 calls, pre-close warning 0–120 minutes (0 = off). **Hospital name (printed on slips)**: 2–80 characters (trimmed, inner spaces collapsed; migration `0014_hospital_name`), read through `hospitalName()`. |

**Legal note.** Priority for Senior Citizens and PWDs is required by law (RA 9994, RA 10754). Turning either off asks for confirmation that names the category and shows "Legally required (RA 9994 / RA 10754)". The server refuses it too (`confirmation_required`) unless the request carries `confirmLegal: true`.

Each save writes one audit row with the old and new values: `settings.urgency_levels_updated` (the old and new lists), `settings.priority_category_updated`, `settings.schedule_updated` and `settings.opd_thresholds_updated`. Only Admins can change them (`settings.clinical.manage`).

**Permissions.** `src/server/auth/permissions.ts` is the single Role × action map. `can(user, action, facilityId?)` denies anything not in the map; each action declares a Facility scope (`none`, or `facility` for actions on one Facility, limited to the user's active assigned Facilities, `StaffUser.facilityIds`). Pages call `requirePermission(action)` and render `<Forbidden />` when it is denied; Server Actions validate with Zod, then `requireStaff()`, then `can()`, then run one command. The `nav.*` actions decide which top-nav items each Role sees (Triage Nurses don't see Queues; Facility Staff don't see Triage). Hiding a link is cosmetic only.

## Staff accounts

Admins manage accounts at **Staff** (`/admin/staff`). The list searches name or username ("Name or username"), filters by Role (Admin, Triage Nurse, Facility Staff) and status (Active, Locked, Deactivated), shows 25 per page, and keeps all of it in the URL. **NEW STAFF ACCOUNT** and each row's "⋯" menu open:

- **Create:** full name, username, Role, Facilities and a temporary password (at least 10 characters, with a show/hide toggle). Usernames follow the `create-admin` rules, and shared names such as `admin` are refused. Give the temporary password to the person directly; it is never logged or audited.
- **Edit:** name, Role and Facilities (the username can't change).
- **Set temporary password:** replaces the password, clears a lockout and signs the person out everywhere. There is no email and no self-service reset.
- **Unlock:** clears a lockout after 5 failed sign-ins (shown when the account is locked or has failures).
- **Deactivate / Reactivate:** a confirmation names the person. Reactivating also clears a lockout left from before. Admins don't get Deactivate on their own row, and can't change their own Role.
- A Facility Staff row with no active Facility shows a "No active Facility" badge: edit it to assign one.

**Roles and Facilities.** Facility Staff have at least one active Facility and work only those Facilities' queues. Triage Nurses and Admins have no Facilities. A deactivated Facility can't be newly assigned; if someone still has one, it shows struck through and can be removed. Assignments live in `user_facilities` (owned by `auth`) and reach `can()` through `requireStaff().facilityIds`, which lists only active Facilities.

**Deactivation vs lockout.** Deactivating sets Better Auth's `banned` and revokes every session, so the person is signed out on their next request and can't sign in until an Admin reactivates them. Nothing is deleted, and their past audit rows keep their name. The lockout is separate: it is `locked_at` after 5 failed sign-ins, and **Unlock** clears it. An Admin can't deactivate or demote themself, and the last active Admin can't be deactivated or demoted.

Every command that changes something writes one audit row: `staff.created` (name, username, Role, Facilities), `staff.updated` (old and new values), `staff.password_set` (`lockCleared`, `sessionsRevoked`; never the password), `staff.deactivated`, `staff.reactivated` (`lockCleared`) and `auth.unlocked`. Name search is Unicode-aware ("peña" finds "PEÑA"). The code is in `src/server/auth/staff-*.ts`: Better Auth's admin API writes the user fields it owns, and when the audit row then can't be written, that change is undone.

**Reading settings from other modules.** Use the getters in `src/server/settings/queries.ts`, never the table: `listFacilities()`, `liveFacilities(instant?)`, `effectivePrefix(facility, instant?)` (the prefix on the OPD day of `instant`; also on each Facility as `currentPrefix`) and `isOpen(facility, instant)` (the Manila weekday is an open day and the Manila time is in `[open, close)`). A due prefix change is folded into the stored `prefix` on that Facility's next write. Clinical settings: `urgencyLevels()` (active levels, non-ER by rank, then ER), `priorityCategories()` / `enabledPriorityCategories()`, `abcSchedule("new" | "previously_immunized")` and `opdThresholds()` (`{ prenatalTarget, noShowThreshold, preCloseWarningMinutes }`). Getters read the database each time, so a save shows at once.

## Audit log

Admins review the audit log at **Audit log** (`/admin/audit`, the "Admin: Audit log" link in the header). It answers "who saw or changed what, and when", e.g. for a breach report within 72 hours. It is read-only: there is no edit, delete or export, and the database rejects UPDATE and DELETE on `audit_log` anyway. Other Roles get the no-access page, and nothing is read.

- **Search:** the staff name (Unicode-aware, case-insensitive) or part of a record ID.
- **Action** and **Entity** filters (`user`, `facility`, `urgency_levels`, `priority_category`, `clinical_schedule`, `opd_settings`, `audit_log`, `job_run`, `patient`).
- **From / To:** Manila dates, both inclusive and each optional (From 2026-09-27 starts at 2026-09-26T16:00Z). A reversed range is swapped; an invalid date, or a year outside 1900–9998, is ignored. Like typing in the search, date changes go to the URL once, 300 ms after the last change.
- Rows are newest first, 25 per page, with the time in Manila (with seconds), the actor, the action's label and raw value, the entity and record ID, and the changed fields as `field: old → new`. The actor is the staff name, "System" for the CLI and jobs, or "Unknown" for a staff row with no stored name (a failed sign-in with an unknown username). Everything is in the URL, so back/forward and links work.

**Viewing is audited.** Each render of the page writes one `audit.viewed` row (entity `audit_log`, with the filters and the `requestedPage` from the URL in `changes`; the list may clamp that page to the last one), so the view itself shows at the top of the default list. The header link never prefetches the page, so hovering or scrolling past it logs nothing. The code is in `src/server/audit/queries.ts` (`listAudit`) and `views.ts` (`recordAuditView`).

## Patients

`src/server/patients/` owns `patients` and `hospital_number_counters` (migrations `0008_patients` and `0009_patients_search_text`).

- **Record:** the name in parts (`last_name`, `first_name`, optional `middle_name` and `suffix`), shown everywhere through `formatPatientName()` in `src/lib/patient-name.ts` as "DELA CRUZ, Juan Santos". Also `sex` (`female`/`male`), `birthdate` (`YYYY-MM-DD`), barangay, municipality, contact number, the optional PhilHealth PIN, Senior Citizen ID, PWD ID and emergency contact, `privacy_notice_at`, `created_at`/`updated_at`/`created_by` and `deactivated_at`. Patients are never deleted. `search_text` holds the lowercased name forms that search matches ("juan dela cruz", "dela cruz, juan santos"); only the repo writes it (`insertPatient`, `updatePatient`), so search is one cheap `instr` per row (about 40 ms on 50,000 patients).
- **Age** is never stored: `ageOn(birthdate, opdDate())` in `src/lib/age.ts` (a Feb 29 birth turns a year older on Mar 1; a future birthdate gives no age).
- **Hospital Number** `HN-YYYY-NNNNNN` (the Manila year): `nextHospitalNumber(tx, year)` in `repo.ts` is the only way to issue one. It increments `hospital_number_counters` inside the caller's transaction, so numbers are sequential per year and a rolled-back registration gives its number back.
- **Search:** `searchPatients({ q, page, pageSize })` in `queries.ts`, used by `/patients` (25 per page, URL-driven like the other lists) and by the Patient finder (`searchPatientsAction`, at most 8). The trimmed query matches, in any combination:
  - part of any name field, Unicode case-insensitive ("PEÑA" finds "Peña"), also "first last" and "last, first" typed together;
  - part of the Hospital Number, ignoring case;
  - a whole birthdate, `YYYY-MM-DD` or `MM/DD/YYYY`, when it is a real date (02/30/1950 is searched as text);
  - a phone number: when the query has only digits and `+ ( ) - .` or spaces and at least 4 digits, those digits are looked for in the stored contact number. `+63` (also "+ 63" or "(+63)") reads as `0`; a bare `63` prefix is tried both ways.
  Deactivated patients are never listed. Results are sorted by last name, then first name, and show name, age, sex, Hospital Number (mono) and the last Visit's OPD date (from `visits.lastVisitDates`, cancelled Visits not counted, or "No visits"). The query parsing is in `src/lib/patient-search.ts`.
- **Permissions and privacy:** `patients.view` (every Role) guards `/patients` and the finder action; `triage.view` (Triage Nurse, Admin) guards `/triage`; `patients.register` (Triage Nurse, Admin) shows the "New patient" row and guards `registerPatientAction`; `patients.edit` (Triage Nurse, Admin) shows **Edit details** on a record and guards `updatePatientAction`. The finder gets no address or contact details. Searching is not audited (viewing a record is), and logs never contain names, numbers or queries.
- **Patient finder** (`/triage`, left column; stacked below lg): an ARIA combobox. Results update 300 ms after typing; ↑/↓ move the highlight, Enter selects, Esc clears, and leaving the field closes the list. With more than 8 matches, "See all N results" opens `/patients?q=`. Picking a patient opens the triage form on the right (see "Triage"). **Ctrl+K** (⌘K) focuses the finder on `/triage` and the header search elsewhere (`src/components/search-shortcut.tsx`); below lg, where the header search is in the menu sheet, the browser keeps the key outside `/triage`.
- **Registration** (Story 3.2): a Triage Nurse or Admin (`patients.register`) chooses **New patient**, always the last option in the finder (also when nothing matches; with an empty query, ↓ opens the list on it). The inline form opens in the right column with the last and first names guessed from the query ("dela cruz, juan" or "juan dela cruz"; `guessNameFromQuery` in `src/lib/patient-search.ts`) and focus on the first empty required field. The rules live in one Zod schema, `src/lib/patient-registration.ts`, which the form runs before submitting and `registerPatientAction` runs again:
  - required: last name, first name, sex, birthdate, barangay, municipality, contact number and the "Privacy notice explained to the patient" checkbox; optional, collapsed under "More details": middle name, suffix, PhilHealth PIN, Senior Citizen ID, PWD ID, emergency contact name and number;
  - names: 1–60 characters after trimming (spaces collapsed, Unicode NFC, so a decomposed "ñ" matches), letters of any script plus spaces, `.`, `'` and `-`;
  - birthdate: a real date from 1900-01-01 to today in Manila ("Enter a real date.", "Birthdate must be 1900 or later.", "Birthdate can't be in the future.");
  - contact and emergency numbers: stored as digits in the `0…` form: after a `+63` or bare `63` country code a trunk `0` is dropped and `0` put in front (`+63 917 123 4567` and `(+63) 0917 123 4567` → `09171234567`, `632 8123 4567` → `0281234567`), and a 10-digit number starting with 9 gets its `0`; 7–11 digits (landlines included); other `+` codes are refused;
  - PhilHealth PIN: 12 digits, stored as `XX-XXXXXXXXX-X`; Senior Citizen and PWD IDs: up to 30 characters.
  
  **Possible match:** an active patient with the same last name, first name (Unicode case-insensitive) and birthdate. The action then returns `possible_match` with those patients (finder rows, no contact details) and creates nothing; the form shows a "Possible match" card with **Use this record** (selects that patient, discards the form) and **Create anyway** (saves again with `confirmedMatchIds`, the ids shown on the card; a match found at save time that isn't in that list returns `possible_match` again with the full current list). `createPatient` in `service.ts` runs in one `withCommandTx`: the duplicate check, `nextHospitalNumber(tx, <Manila year>)`, the insert (`privacy_notice_at` = the save time, `created_by` = the nurse) and one `patient.created` audit row (entity `patient`) with the Hospital Number and every field set (plus the confirmed matches' Hospital Numbers when **Create anyway** was used). Failed validation, a possible match and a refused call write nothing. After saving, the new patient is selected, "Registered DELA CRUZ, Juan · HN-2026-000043" is announced and focus goes to the card heading; Esc or Cancel closes the form and returns focus to the finder. When anything has been typed, Esc, Cancel, picking a finder result or choosing New patient again first asks "Discard this registration?" (Discard / Keep editing; Keep editing returns focus where it was). A save still in flight when the form closes registers the patient but no longer selects it or moves focus. No Hospital Number is ever typed by hand. The form's fields (`src/components/patient-fields.tsx`) are shared with the Edit details sheet.
- **Patient Record** (`/patients/[id]`, Story 3.3): opened from the name on `/patients` or **Open record** on the Triage selected-patient card (also right after registering). Every Role with `patients.view` can open it. The page shows the name, Hospital Number (mono), age, sex and birthdate, then Contact & address, IDs (PhilHealth PIN, Senior Citizen ID, PWD ID), Emergency contact, Privacy notice (when it was explained, Manila time) and Visit history: each Visit's date, status and Urgency Level, newest first ("No visits yet." when there are none), assembled by `getRecordView` from the `visits` and `triage` queries. No Vital Signs or complaint appear on the record, so Facility Staff see no clinical values beyond this list. A missing optional value shows "—" (read out as "Not recorded"). A deactivated patient still opens, with a "Deactivated" badge. The browser tab says only "Patient record | OPD": tabs are visible on shared screens. An unknown id is a 404.
  - **Viewing is audited** (PRIV-2): the page loads through `getRecordView(id, actor)` in `service.ts`, after the permission check, which writes one `patient.viewed` row (entity `patient`, the patient id, no field values) per render in its own `withCommandTx`. An unknown id writes nothing. Every link to a record goes through `PatientRecordLink` (`src/components/patient-record-link.tsx`, path from `patientRecordPath()` in `src/lib/patient-links.ts`), which never prefetches, so hovering or scrolling past one logs nothing. A save that changes something revalidates the page, so its re-render is a view too; a save with no changes or a possible match doesn't.
  - **Edit details** (Triage Nurse, Admin; Facility Staff see the record read-only): a side sheet with the registration fields, pre-filled, and no privacy checkbox. `patientEditSchema` in `src/lib/patient-registration.ts` applies the same rules plus the id. `updatePatient` in `service.ts` runs in one `withCommandTx`: it loads the row, compares the fields, saves the changed ones through the repo's `updatePatient` (which recomputes `search_text`, so the finder finds a new name at once, and sets `updated_at`), and writes one `patient.updated` row with `{ field: { old, new } }` for the changed fields only. These rows keep the old and new demographic values (names, address, phone numbers, IDs), which Admins can see at `/admin/audit`. The sheet sends back the `updated_at` it opened with; if the record was saved since, the save is refused (`stale`: "This record changed since you opened it. Reload to see the latest details.", with a **Reload** button), so one editor never silently reverts another's change. A save with no changes writes nothing and says "No changes."; otherwise "Saved changes to DELA CRUZ, Juan." is announced and focus returns to Edit details. When a changed name or birthdate matches another active patient, it returns `possible_match` and saves nothing; the card's **Save anyway** sends `confirmedMatchIds` as in registration. The Hospital Number, `created_*` and `privacy_notice_at` never change. Esc, Cancel or clicking outside asks "Discard your changes?" when anything was changed. Failed validation, a refusal (`forbidden`, `not_found`) and a possible match write nothing.
  - **No delete:** there is no delete control and no delete action; patients are only ever deactivated (no UI yet).
- **Demo data:** `npm run db:seed:demo` adds 42 fictional Filipino patients (children, adults and seniors, both sexes, two "Juan Dela Cruz" and two "Maria Santos" with different birthdates, a few with IDs, contact numbers on a fictional 0917 555 exchange; enough "Cruz" to fill two pages). It numbers them with `nextHospitalNumber()`, so later registrations continue the sequence. It marks them `created_by = 'demo-seed'`, refuses to run twice, with `NODE_ENV=production`, or before `db:migrate` ("Run npm run db:migrate first.", without creating a file), and writes no audit rows (demo data is not a staff action).

## Triage

Story 3.4 (FR-7). On `/triage`, picking a patient in the finder opens the triage form in the right column (`src/app/(staff)/triage/triage-form.tsx`), with focus on the Chief Complaint. The form first loads `getTriageContextAction` (the active Urgency Levels and enabled Priority Categories through the settings getters, the patient's sex and age, whether a Senior Citizen or PWD ID is on file, never the ID itself, and whether a Visit is already open today; not audited).

- **Order and keys:** Chief Complaint → Vital Signs (temperature, BP systolic and diastolic, pulse, respiratory rate, SpO₂, weight) → Urgency Level → Priority Category; Tab follows it. Vitals are numeric text fields with a unit suffix. Plain Enter in a field never saves. The Urgency Level is a radiogroup in rank order with the ER level last; while it has focus, keys `1`–`9` pick the first nine levels (arrow keys move through all of them). Badge colors come from the rank (`urgent` for rank 1 and ER, `routine` for the lowest non-ER rank, `abnormal` between), always with an icon and the name. After Priority Category come the **Facility tiles** (see "Queue Numbers and the ER handoff"). `Ctrl+Enter` or the green **Issue queue number** button saves the triage and issues the number in one go; there is no save without a Facility or Direct to ER. **Next patient** (focused; Esc while focus is in the triage workspace too) clears the screen and focuses the finder. Picking another patient, or New patient, with anything entered asks "Discard this triage?".
- **Vital Sign ranges** live in one file, `src/lib/vital-signs.ts`. **They are an assumption for the nursing lead to confirm** (PRD FR-7). A value outside the impossible limits is refused (red error, e.g. "Temperature must be between 30 and 45 °C.", shown once the field is left, and it blocks the save); a value outside normal gets an amber border, an icon and a hint such as "Above normal (37.5 °C max)" but saves. A diastolic at or above the systolic is refused. Pulse and respiratory-rate normals are age-banded (under 1 year, 1–12 years, adult). Required: complaint (1–500 characters), temperature, BP, pulse and respiratory rate; SpO₂ and weight are optional.

  | Sign | Impossible outside | Normal |
  |---|---|---|
  | Temperature | 30–45 °C | 36.0–37.5 °C |
  | Systolic | 50–300 | 90–139 |
  | Diastolic | 20–200, and below systolic | 60–89 |
  | Pulse | 20–250 | 60–100 adult; 100–160 under 1; 70–120 age 1–12 |
  | Respiratory rate | 4–80 | 12–20 adult; 30–60 under 1; 18–30 age 1–12 |
  | SpO₂ | 50–100 % | 95 % and up |
  | Weight | 0.3–300 kg | not flagged |
- **Priority Category:** only enabled categories, plus "None"; Pregnant only for female patients. Senior Citizen for a patient under 60 is refused ("Senior Citizen is for patients aged 60 and over."). Senior Citizen or PWD with no ID on file needs the ID (saved to the Patient Record) or "ID not presented"; the choice is stored as `priority_id_status` (`on_file`, `entered`, `not_presented`).
- **Deactivated patients** can't be triaged (`patient_deactivated`).
- **One active Visit:** a patient with an `open` or `in_queue` Visit today can't be triaged again (`visit_already_open`: "{Name} already has an open Visit today."); the form says so before the nurse starts. A race on the unique index gets the same answer.
- **Command:** `recordTriageAction` (Zod → `requireStaff()` → `can("triage.record")`, Triage Nurse and Admin) → `recordTriage` in `src/server/triage/service.ts`, one `withCommandTx`: `visits.open`, the Triage Record insert with the snapshot, then (when typed) the patient's ID through the patients service `setPriorityId`, then `queue.issue` and the Visit to `in_queue`, or (ER) the Visit to `directed_to_er`, or (a not-live Facility) nothing more: the Visit stays open for a paper number. It writes one `triage.recorded` row (entity `visit`) with `patientId`, the snapshot, the ID choice (plus `{ seniorCitizenId|pwdId: { old, new } }` when an ID was entered; the record page is then revalidated), `outcome` (`queued` | `directed_to_er` | `paper_number`), `facilityId`, `queueNumber`, `ahead` and `closedAt` (null where they don't apply). Vital values and the complaint are never audited or logged. A saved triage is never edited.
- **Snapshot** (AD-6): `urgency_level_id`, `urgency_name`, `urgency_rank` (null for ER), `urgency_is_er`, `urgency_tone` (the badge colour, so old Visits never recolour; migration `0011_triage_urgency_tone` backfilled existing rows), `sort_group` and `priority_category`, read through the settings getters at save time. `sort_group` is 1 when the level's rank is lower (more urgent) than the lowest active non-ER rank, otherwise 2 with an enabled Priority Category, otherwise 3; null for an ER level.
- **Modules:** `src/server/visits/` owns `visits` (migration `0010_visits_triage`): `open(tx, { patientId, actor, now })` writes `opd_date` once from `opdDate()`; `transition(tx, id, to, now)` applies the one transition table in `state.ts` (`open` → `in_queue` | `directed_to_er` | `cancelled`; `in_queue` → `completed` | `no_show` | `cancelled`; the rest are terminal) and throws `invalid_transition` otherwise; `visitsForPatient()` and `lastVisitDates()` are its queries. A CHECK constrains the status and a partial unique index allows one active Visit per patient per day. `visits` never imports `patients` (its schema only declares the foreign key). `src/server/triage/` owns `triage_records` (one per Visit; vitals, `abnormal_fields` JSON array, the snapshot, `recorded_by`/`recorded_at`); `triageSummaries()` gives other modules only the snapshot.

## Queue Numbers and the ER handoff

Story 3.5 (FR-8, FR-9). Every triage ends **queued** (a Queue Number at a Facility), **Directed to ER**, or with a **paper number** for a Facility that isn't live yet.

- **Facility tiles:** the active Facilities in display order, as a radiogroup after Priority Category (Tab enters and leaves the group; arrow keys move within it). A live Facility that is open now (`isOpen`, Manila time) is selectable and shows "{n} waiting" (its waiting and called entries today). A Facility that is open now but not live is selectable too, labelled "Paper number (not live yet)" (see below). A closed one is disabled with "Closed, opens today|tomorrow|{weekday} {time}", with the date added when the opening is a week away ("Closed, opens Monday Oct 5, 7:00 AM"; `nextOpening()` in `settings/queries.ts`, `closedReason()` in `src/lib/facility-format.ts`). The tiles reload when the window regains focus and after a `facility_unavailable` refusal.
- **Server checks:** live + open → a Queue Number; not live + open → a paper number; closed or deactivated → `facility_unavailable` ("{Facility} isn't taking patients now."); an unknown (or over-long) Facility id → "That Facility isn't available. Choose another." (`facility_unavailable` from the service, a field error from the schema). A non-ER level with no Facility gets "Choose a Facility.".
- **Paper number** (PRD §10 pilot): choosing a not-live Facility (the button reads **Record triage (paper number)**) saves the Visit and the Triage Record with `paper_facility_id` (migration `0013_paper_number`), creates no Queue Entry and leaves the Visit **Open**. The audit `outcome` is `paper_number` with the `facilityId`. The panel says "Triage recorded · Give a paper number for {Facility}".
- **Issued:** a cyan banner shows the number (`text-queue-number-issued`), "{Facility} · {N} ahead" (or "Next in line"), and the level and category, with **Print slip** (focused, so Enter prints; see "Queue slips") and **Next patient** (Esc).
- **ER handoff:** an ER-flagged Urgency Level hides the tiles and turns the button into the red **Direct to ER**. It asks "Direct {Name} to the Emergency Room? No queue number will be issued and the Visit closes." (Confirm / Cancel). Confirmed, the Visit becomes `directed_to_er` with `closed_at`, no Queue Entry is created, and a red-outlined panel says "Directed to ER · Visit closed {h:mm AM}" with the level and category (the audit row adds `closedAt`). The action takes `facilityId` (non-ER levels) or `directToEr: true` (ER levels); any other combination is refused (`invalid`).
- **Numbering:** `queue_counters(facility_id, opd_date, last_seq)` is inserted or incremented inside the triage command's IMMEDIATE transaction, so numbers are consecutive per Facility per OPD day, a new day starts at 1, and a refused command gives its number back. Two nurses issuing at once get different, consecutive numbers (`busy_timeout` absorbs the lock; tested with two processes on one file). The entry stores `prefix = effectivePrefix(facility, now)`, so a pending prefix change never relabels today. Labels always come from `formatQueueNumber(prefix, seq)` in `src/lib/queue-number.ts` (`CN-001`, `CN-014`, `CN-1000`).
- **Ordering (AD-5):** exactly one function reads a queue: `liveQueue(db, facilityId, opdDate)` in `src/server/queue/repo.ts`. It keeps today's `waiting`, `called` and `serving` entries that aren't paper entries, ordered by `sort_group, urgency_rank, entered_at, id` (the snapshot copied from the Triage Record). So an Urgent patient goes first, a Senior Citizen arriving after three Routine patients goes ahead of all three, and ties go by arrival. `aheadOf(entry)` is the waiting and called entries before it in that order; `waitingCounts(opdDate)` counts per Facility.
- **Module:** `src/server/queue/` owns `queue_counters` and `queue_entries` (migration `0012_queue`; status CHECK `waiting`, `called`, `serving`, `completed`, `referred`, `no_show`, `cancelled`; `UNIQUE(facility_id, opd_date, seq)`; `0013_paper_number` adds an `(opd_date, status)` index for `waitingCounts`). `issue(tx, { visitId, facilityId, snapshot, actor, now })` is its one command; it writes no audit row of its own. The concurrency test's second-nurse process lives in `src/test-support/queue-issue-worker.ts` (test support only). No Facility queue screens, calling, display board, paper entries or manual reordering yet (Epics 4, 5 and 7). `getSlip(entryId)` in `queries.ts` gives the slip page only the Facility name, `prefix`, `seq` and `entered_at`.

## Queue slips

Story 3.6 (FR-8, UX-DR17). The patient leaves triage with a printed slip to match against the waiting-area screen.

- **Page:** `/print/slip/[entryId]` (`src/app/print/slip/[entryId]/page.tsx`), outside the `(staff)` shell: no header, session guard or skip link. It still needs a staff session (the proxy and `requireStaff()` send signed-out visits to sign-in) and `triage.record` (Triage Nurses and Admins); anyone else gets only "You don't have access to this page." and no data. An unknown id, or a paper entry, is a 404. The tab reads "Queue slip | OPD"; the `<h1>` is visually hidden.
- **Content:** the hospital name (the Admin setting "Hospital name (printed on slips)", default "Hospital OPD"), the Facility name, the Queue Number (`formatQueueNumber(prefix, seq)` from the stored columns, very large mono bold), the issue date and time in Manila ("Sep 28, 2026 · 8:14 AM", `formatSlipDateTime`) and "Please wait for your number on the screen.". Nothing else: no name, Hospital Number, complaint, Priority Category, group or Urgency Level. So the slip isn't audited.
- **Paper sizes:** one fluid column with `@page { margin: 0 }` (`slip.module.css`). Text sizes follow the page width (`vw`) and are clamped, and the number never wraps, so it fits a 58 mm roll (48 mm printable), an 80 mm roll (72 mm printable) and A4, where the slip is a bordered box (at most 96 mm wide) near the top. Black on white only, whatever the theme; the screen view looks the same. The paper size is chosen in the browser's print dialog: there are no printer drivers, ESC/POS commands or PDFs.
- **Printing from triage:** the issue banner's **Print slip** (white, primary) has focus when the banner appears, so Enter prints. It loads the slip in a hidden `<iframe>` and calls `print()` on it once loaded, without leaving `/triage`; meanwhile it reads "Preparing…". If the frame doesn't load the slip (an error, a 404, no access, or nothing after 20 s) it says "Couldn't load the slip. Try again.". Pressing it again reprints. **Next patient** (Esc) is unchanged. The paper-number and ER outcomes print nothing. There is no reprint list yet (the Facility screens in Epic 4 may add one).

## Server code

Server code lives in `src/server/<module>/`, and every file there starts with `import "server-only"`.

- `src/server/db/`: `getDb()` opens the one SQLite file lazily (WAL, foreign keys on, 5 s busy timeout). `withCommandTx(actor, action, fn)` runs a command in an IMMEDIATE transaction; `fn` is synchronous and records exactly one audit row through its `audit` argument, and any throw rolls everything back. Services throw `DomainError(code)` for expected failures.
- `src/server/audit/`: the append-only `audit_log` (database triggers reject UPDATE and DELETE), the `AuditAction` values and their labels, `listAudit()` in `queries.ts` and `recordAuditView()` in `views.ts` (see "Audit log").
- `src/server/auth/`: Better Auth (username sign-in, the admin plugin with impersonation off, no public sign-up), `requireStaff()` for the current user (`getStaffNoRefresh()` for polling), and the sign-in, re-auth, keep-alive and sign-out actions. Sign-in, failed sign-in and sign-out are audited from Better Auth's hooks. `lockout.ts` keeps `failed_attempts` / `locked_at` on `users`; `sign-in-limit.ts` is the per-IP limit for the server-action path; `session-config.ts` holds the idle timings.
- `src/proxy.ts`: redirects requests without a session cookie to `/sign-in`. It never touches the database; pages check the session for real with `requireStaff()`.
- `src/server/settings/`: owns `facilities`, `urgency_levels`, `priority_categories`, `clinical_schedules` and `opd_settings`; getters in `queries.ts`, commands in `service.ts`, Server Actions in `actions.ts` (see "Admin settings").
- `src/server/patients/`: owns `patients` and `hospital_number_counters`; `searchPatients()` in `queries.ts`, `nextHospitalNumber()` in `repo.ts`, `createPatient()`, `getRecordView()` and `updatePatient()` in `service.ts`, the finder, registration and edit actions in `actions.ts`, the demo seed in `demo-seed.ts` (see "Patients").
- `src/server/visits/`: owns `visits` and the Visit state machine; `src/server/triage/`: owns `triage_records` and `recordTriage` (see "Triage").
- `src/server/queue/`: owns `queue_counters` and `queue_entries`, `issue()` and the one ordering function `liveQueue()` (see "Queue Numbers and the ER handoff").
- `src/server/jobs/`: owns `job_runs`. One in-process scheduler (`scheduler.ts`), started once from `src/instrumentation.ts` (Node.js runtime only; never during `next build` or under Vitest; a `globalThis` guard stops dev hot reloads from starting a second). It ticks every 60 s and right after start, and `runDueJobs(now, deps)` runs each job in `registry.ts` for its latest due Manila key. A run claims `job_runs(job, key)` first, so a key that succeeded never runs again; a failed key is retried no sooner than 30 minutes later (`RETRY_DELAY_MS`), up to 3 attempts, and a run left `running` by a crash is marked failed "Interrupted" after an hour. Each run writes one audit row as the `system` actor (entity `job_run`). Jobs: `backup-job.ts` (02:00, `VACUUM INTO BACKUP_DIR/opd-<date>.sqlite`, keeps 30, through `src/server/db/backup.ts`) and `rate-limit-job.ts` (03:00, deletes `rate_limits` rows older than 24 h through `auth`'s `purgeRateLimits`). `queries.ts` has `lastBackupAt()` and `latestRuns()` for `/api/health`. Later epics add their jobs to the registry. See [docs/operations.md](docs/operations.md).
- `src/lib/time.ts`: `opdDate(instant)` gives the OPD day (`YYYY-MM-DD` in Asia/Manila), `nextOpdDate()` the day after, `manilaWeekday()` / `manilaMinutes()` the Manila clock, `manilaDayStart(date)` the UTC instant a Manila date begins, and `formatManila(instant)` formats for display.
- Schema changes go only through migrations: edit a `schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`.

Database tests use `createTestDb()` from `src/server/db/test-db.ts`: a temp-file SQLite migrated fresh for each test file. Component tests (`*.test.tsx`) opt into jsdom with a `// @vitest-environment jsdom` first line and use React Testing Library (see `src/components/data-table/toolbar.test.tsx`).

## Project structure

```text
public/                        Static assets
src/app/                       App Router routes
  layout.tsx                   Root layout: fonts, metadata ("%s | OPD"), theme provider
  globals.css                  Tailwind, design tokens (light and .dark), typography utilities, shadcn variants
  error.tsx                    Error boundary
  not-found.tsx                404 page
  global-error.tsx             Fallback when the root layout fails
  (auth)/sign-in/              Sign-in page and form (no shell)
  api/auth/[...all]/           Better Auth route handler
  api/health/                  Health check
  api/auth-status/             Session status poll (never extends the session)
  (staff)/                     Route group for staff pages, sharing the shell
    layout.tsx                 requireStaff(), skip link, header, <main id="content">
    page.tsx                   Overview (/)
    patients/                  Patient list (search, table, pagination); [id]/ the Patient Record and Edit details sheet
    triage/                    Patient finder, registration form and triage form
    queues/ appointments/ directory/
                               Placeholder pages
    admin/settings/            OPD Settings: Facility cards, clinical settings sections, edit sheets, confirmations
    admin/staff/               Staff list, create/edit and password sheets, row menu, confirmations
src/components/                App components
  app-header.tsx               White top bar: logo, search, page nav, theme toggle, account
  header-search.tsx            Header search form, submits to /patients?q=
  top-nav.tsx                  Page links, icon above label (client)
  mobile-menu.tsx              Menu sheet below 768px with nav and search (client)
  nav-items.ts                 The staff page links
  page-title.tsx               Page title and shared uppercase button classes
  theme-provider.tsx           next-themes provider (client)
  theme-toggle.tsx             Light/dark toggle button (client)
  forbidden.tsx                "You don't have access to this page." state
  session-guard.tsx            Idle-timeout warning and re-auth dialogs (client)
  sign-in-fields.tsx           Username/password fields shared by sign-in and re-auth
  data-table/                  Reusable URL-driven list pattern
    toolbar.tsx                Debounced search and filter selects that update the URL (client)
    toolbar-state.ts           Pure toolbar state logic: follows outside URL changes
    pagination.tsx             Page links that keep the search and filters
    empty-state.tsx            "No results" message with a clear-filters link
src/components/ui/             shadcn/ui components (generated, edit with care)
src/lib/url-query.ts           Parse list URLs (whitelisted filters, search, page) and build them
src/lib/utils.ts               `cn` class name helper
src/lib/time.ts                opdDate() and formatManila()
src/lib/safe-next.ts           Validates the post-sign-in `next` path
src/lib/session-guard.ts       Pure idle-timeout timing rules (nextGuardState)
src/server/                    Server-only modules (db, audit, auth, env); see "Server code"
src/proxy.ts                   Optimistic sign-in redirect
src/instrumentation.ts         Startup check of the .env contract, then starts the jobs scheduler
drizzle/                       Committed migrations
docs/operations.md             Deploy, backups, restore drill, security baseline, paper fallback
scripts/                       migrate, create-admin, unlock-user and seed-demo CLIs (run with tsx)
```

The `@/*` import alias points to `src/*`. Tests sit next to the code they cover as `*.test.ts`.

Components are Server Components unless they need the browser.

## List pages

The staff list (`/admin/staff`) is the first page on this pattern. List pages keep their search, filters and page in the URL (for example `/patients?q=ana&page=2`), so every view can be bookmarked, shared and reached with back/forward:

1. Describe the filters once as a schema and read the URL on the server with `parseListParams(searchParams, schema)`. Unknown or malformed values fall back to the defaults.
2. Render `DataTableToolbar` with the current values. Typing is debounced by 300 ms, and any change goes back to page 1. When the URL changes from outside, the toolbar follows it.
3. Render `DataTablePagination` below the table, and `DataTableEmptyState` when nothing matches.

`buildListHref(basePath, values, defaults)` leaves default values out, so the plain path is the default view.

## UI and dependencies

- [shadcn/ui](https://ui.shadcn.com) components (radix-nova), configured in `components.json`. Add more with `npx shadcn@4.21.0 add <component>`. The shadcn CLI is not a project dependency; the few Tailwind variants its components need are copied into `globals.css`.
- [next-themes](https://github.com/pacocoursey/next-themes) for light and dark mode. The theme follows the system setting until the user picks one with the toggle; the choice is stored in `localStorage`.
- [Lucide](https://lucide.dev) icons.
- [Vitest](https://vitest.dev) for unit tests, with `vite-tsconfig-paths` for the `@/*` alias.
- Supporting packages installed by shadcn: `radix-ui`, `class-variance-authority`, `cn`, `tw-animate-css`.

The look is a flat admin design: a white top bar with icon-over-label navigation, a light gray page, white cards, a cyan banner, and green and orange uppercase buttons, set in Roboto (Roboto Mono for Queue Numbers). Colors are CSS variables in `globals.css` (`:root` for light, `.dark` for dark), matching the project's DESIGN.md:

- The clinical colors `urgent`, `priority`, `routine` and `abnormal` are always paired with text and an icon.
- The `board-*` colors are the Display Board's fixed dark scheme.
- The typography utilities are `text-queue-number`, `text-queue-number-issued`, `text-board-now-serving`, `text-board-next` and `text-board-facility`.

Every text color pair meets WCAG AA (4.5:1). In dark mode, filled buttons use dark text.
