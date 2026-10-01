# Epic 2 Context: Secure Staff Access and OPD Setup

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Replace the legacy Acme Store dashboard with the hospital OPD app shell and lay the platform every later epic builds on. That means the SQLite/Drizzle persistence layer, per-module server layering, command transactions with an append-only audit log, Better Auth staff sign-in with idle timeout and lockout, a single Role × action permission map, Admin-editable OPD settings (Facilities, Urgency Levels, Priority Categories, schedules, thresholds), staff account management, audit log search, and a jobs scheduler that runs a nightly backup. When the epic is done, the first Admin can be created from the CLI, can set up staff and policy, and every action is traceable to one person. This is the privacy and security baseline (Philippine Data Privacy Act) that all patient-facing epics rely on.

## Stories

- Story 2.1: Hospital app shell replaces the store
- Story 2.2: First Admin signs in
- Story 2.3: Idle sign-out and account lockout
- Story 2.4: Admin configures OPD Facilities
- Story 2.5: Admin manages staff accounts and roles
- Story 2.6: Admin configures triage and clinical settings
- Story 2.7: Admin reviews the audit log
- Story 2.8: Nightly backup and scheduled jobs

## Requirements & Constraints

- **Sign-in:** every page except the Display Board requires sign-in. Signed-out requests redirect to `/sign-in` and return to the requested URL afterwards. Wrong credentials show only a generic "Wrong username or password".
- **Sessions:** a session ends after 15 minutes of inactivity. After 5 consecutive failed sign-ins the account locks until an Admin unlocks it.
- **Accounts:** each person has one account, and shared logins are not allowed. A deactivated account cannot sign in, but its past actions stay attributed to the person by name. There is no default password: the first Admin comes from a CLI.
- **Roles:** Triage Nurse, Facility Staff (limited to their assigned Facilities) and Admin. Anything not explicitly granted is denied. Only Admins manage staff, settings, Doctors/Departments, and view the audit log. The full Role matrix (patients, triage, queue, appointments, paper entry, overview) must be mirrored in the map, and later epics add their actions to it with tests.
- **Facilities:** name, a unique prefix, opening days and hours, an `is_live` pilot flag, and active/deactivated. Prefix changes take effect the next OPD day. A deactivated Facility is hidden from new assignments. Blocking deactivation while patients are waiting comes later, in Story 4.1.
- **Default Facilities:** Prenatal (PN), Animal Bite Center (AB), Treatment (TR) and Consultation (CN), all live, open Mon–Sat 7:00–17:00.
- **Clinical settings:** Urgency Levels need at least one non-ER level and unique ranks. Turning off Senior Citizen or PWD needs a confirmation with the warning "Legally required (RA 9994 / RA 10754)". Changes apply only to new entries.
- **Clinical defaults:**
  - Urgency Levels: Emergency (ER flag), Urgent rank 1, Routine rank 2.
  - Priority Categories: Senior Citizen and PWD (on, legally required), Pregnant (on).
  - Animal Bite Center schedules: new patient Day 0/3/7; previously immunized Day 0/3.
  - Prenatal target 8, No-show threshold 3 calls, pre-close warning 30 min.
- **Audit:** every create, update, setting change, sign-in, sign-out, lockout and unlock is logged with actor, time, action, entity and changed fields (old and new values for settings). No one, including Admins, can edit or delete entries. Admins search the log by staff, action, entity or record ID, and date range, newest first, with times shown in Manila time. Viewing the audit page is itself audited. The log must support breach investigation within 72 hours.
- **Data protection:** the database and backups live on OS-encrypted volumes, and TLS ends at a reverse proxy. A nightly backup keeps 30 days. Nothing is hard-deleted (soft deletes only). App logs never contain patient identifiers.
- **Definition of Done:** every story responds in under 1 s, works at desktop and 768 px tablet width, and meets WCAG 2.1 AA (keyboard, visible focus, 44 px targets, errors tied to their fields, color never the only signal). Text is in English. New actions go into the permission map with tests, and each new command writes exactly one audit row. `npm run lint`, `npm run build` and `npm test` pass.

## Technical Decisions

- **Stack (pinned):**
  - Next.js 16.3.6 (App Router), React 19.2.8, Tailwind 4, shadcn/ui radix-nova.
  - better-sqlite3 13.0.3, Drizzle ORM 0.45.3 / drizzle-kit 0.31.11 (exact pins).
  - Better Auth 1.7.6, Zod 4.6.5, TanStack Query 5.104.
  - Vitest 5.0.2, which needs `@types/node` bumped to ^24. Node 24.
- **Database:**
  - One SQLite file, opened lazily in `src/server/db` with WAL, `foreign_keys=ON` and `busy_timeout=5000`.
  - Runs only under a single `next start` process, never serverless or edge.
  - Every query entry point runs at request time (`requireStaff()`, `requireDisplayDevice()` or `await connection()`).
  - Schema changes only through drizzle-kit migrations in `drizzle/`. Seed migrations hold the defaults.
- **Modules:**
  - Each module lives in `src/server/<module>/` with `schema.ts`, `repo.ts`, `service.ts`, `queries.ts`, `actions.ts` and `schemas.ts`. Every file starts with `import "server-only"`.
  - Each table has one owner module. Other modules read it only through the owner's queries and change it only through its service. The module dependency graph stays acyclic.
  - Owners in this epic: `auth` owns `users` (role, facility assignments, `failed_attempts`, `locked_at`), `sessions`, `accounts`, `verifications` and `rate_limits`. `settings` owns `facilities`, `urgency_levels`, `priority_categories`, `clinical_schedules` and `opd_settings`. `audit` owns `audit_log`. `jobs` owns `job_runs`.
- **Commands:**
  - A Server Action runs `safeParse` with Zod, then `requireStaff()`, then `can(user, action, scope)`, then exactly one service command.
  - The command runs in `withCommandTx(actor, action, fn)`, which uses `db.transaction(fn, { behavior: "immediate" })`. `fn` is synchronous (no async/await). `tx` is passed down to repos, other services and `audit.record(tx, …)`. Cross-module methods never open their own transaction.
  - Each command writes one `audit_log` row: `id, at, actor_type (staff/system), actor_id, action (AuditAction enum), entity, entity_id, changes JSON`. SQLite triggers reject UPDATE and DELETE on `audit_log`.
  - The Better Auth handler (auditing through its hooks) and system jobs are the only exceptions.
- **Permissions:**
  - `src/server/auth/permissions.ts` is the single Role × action map, and it declares the Facility scope for each action. Hiding UI is cosmetic only.
  - `src/proxy.ts` only does an optimistic redirect based on the session cookie and never queries the DB.
- **Auth (Better Auth):**
  - Drizzle adapter with the `username()` and `admin()` plugins. Impersonation is off.
  - Sessions: `expiresIn: 900`, `updateAge: 60`, no `cookieCache`. Polling reads use `getSession({ query: { disableRefresh: true } })`.
  - Lockout: a `hooks.after` on `/sign-in/username` counts `failed_attempts` and sets `locked_at` at 5. `banned` is reserved for deactivation.
  - `rateLimit` uses DB storage. Better Auth tables keep the library's integer timestamps.
- **Time:** timestamps are stored as UTC ISO text. Day-scoped tables store `opd_date` (YYYY-MM-DD, Asia/Manila) from `opdDate()` in `src/lib/time.ts`. Display uses `Intl` with `timeZone: "Asia/Manila"`.
- **Settings:** policy is read only through settings getters (`liveFacilities()`, `isOpen(facility, instant)`, `urgencyLevels()` and so on), with tests that cover the day boundary.
- **Jobs:**
  - One in-process scheduler, started once from `src/instrumentation.ts` `register()`, runs as the `system` actor through `withCommandTx`.
  - Jobs are idempotent via a unique `job_runs(job, key)` row, and missed keys are caught up on startup.
  - The backup job runs at 02:00 Manila, does `VACUUM INTO` a dated file in `BACKUP_DIR`, and keeps the newest 30.
- **Operations:**
  - `.env` contract: `DATABASE_PATH`, `BACKUP_DIR`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NODE_ENV`. In production the app refuses to start if any is missing.
  - Deploy order: `npm ci`, then build, then `db:migrate` (which takes a pre-migration backup first), then restart.
  - `npm run create-admin` creates the first Admin. `db:seed:demo` refuses to run in production.
  - `GET /api/health` reports DB reachability, the last backup and the last run of each job, with no patient data.
  - `docs/operations.md` covers the deploy order, env contract, restore drill, encrypted volume and TLS, and the paper fallback.
- **Conventions:**
  - IDs are text UUIDs. Tables are snake_case plural. TS types are PascalCase singular, and files are kebab-case. PRD glossary terms are used verbatim in code.
  - Action results are `{ ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`. Services throw `DomainError(code)`, and expected failures never throw to the client.
  - Tests use Vitest against a temp-file SQLite migrated fresh per test file.
- **Cleanup:**
  - Remove the Acme Store routes, the sample data in `src/lib/data.ts`, the `orders-*` components and the store copy. Story 1.3 is superseded.
  - First extract the story 1.4 table pattern into `src/components/data-table/` and `src/lib/url-query.ts`, with tests.
  - Rename `(dashboard)` to `(staff)`. Planned route groups: `(auth)/sign-in`, `(staff)/…`, `(staff)/admin/*`.

## UX & Interaction Patterns

- **Shell:** keep the story 1.5 look: a 72 px top bar, a 96 px left rail, a gray page and white cards.
  - Top nav, icon over label: Overview, Triage, Queues, Patients, Appointments, Directory. Items a Role cannot use are hidden, not disabled.
  - The left rail has one tile per live Facility, scoped to the user's Facilities.
  - The user menu holds the Admin pages (`/admin/staff`, `/admin/settings`, `/admin/audit`) and Keyboard shortcuts.
  - Below 768 px, the nav and rail move into a ☰ sheet.
- **Tokens:**
  - Colors: `urgent`, `priority`, `routine`, `abnormal`, `board-*` (background, foreground, muted, called, called-foreground), plus the full `-dark` set. They go in `:root`, `.dark` and `@theme`.
  - Filled buttons in dark mode use dark text `#111820`.
  - Typography utilities: `queue-number` (mono 28/600), `queue-number-issued` (mono 64/700), and `board-now-serving` / `board-next` / `board-facility`.
  - Keep Roboto and Roboto Mono. Uppercase bold only on primary, success and CTA buttons.
  - DESIGN.md has the exact hex values.
- **Data tables** (staff list, audit log): use the story 1.4 URL-driven pattern: debounced search, filter selects, 10 or 25 rows per page, a live result count, and an empty state. The toolbar must follow the URL when it changes externally (back/forward or a link). This fixes the story 1.5 bug.
- **Session:**
  - At 14 minutes idle, show the dialog "You'll be signed out in 60 seconds." with **Stay signed in** focused, announced to screen readers. Background polling does not count as activity.
  - On expiry, a sign-in dialog opens over the page: "Signed out after 15 minutes of inactivity. Sign in to continue." The same user keeps their form input. A different user gets a fresh page.
- **Messages:**
  - Locked account: "Account locked after 5 failed attempts. Ask an Admin to unlock it."
  - Permission denied: "You don't have access to this page." with a link to Overview and no data.
- **Accessibility:** a skip link to `<main id="content">`, and page titles "{Surface} | OPD". Errors are tied to their fields with `aria-describedby`, and the first error gets focus on submit. Respect reduced motion, stay usable at 200% text, and never use color as the only signal.
- **Voice:** plain, short, clinical-neutral. Confirmations name the specific thing rather than asking "Are you sure?".

## Cross-Story Dependencies

- **2.1 first:** removes the store code, extracts the reusable table pattern that 2.5 and 2.7 use, and adds the tokens and the shell.
- **2.2 sets up the core platform:** the DB, migrations, `withCommandTx`, the audit module with its immutability triggers, `requireStaff()`, `opdDate()`, health, the Vitest setup, and create-admin. Stories 2.3–2.8 all depend on it.
- **2.4 creates `permissions.ts` and the settings module.** 2.5 extends the map and adds tests of each Role against every action, 2.6 extends the settings module, and 2.5 uses the configured Facilities for staff assignment.
- **2.3 and 2.5:** unlock (2.5) clears the lockout state that 2.3 sets. Deactivation uses `banned`.
- **2.8** adds the scheduler and backup job, gives health its backup and job status, and adds the pre-migration backup to `db:migrate`. Epics 4 and 6 add their own jobs (facility close, appointments missed, pre-close warning) to this scheduler.
- **Later epics:** they add actions to the permission map and `AuditAction` values, read policy only through the settings getters, and use the same command and audit pattern. Story 4.1 adds the rule that blocks deactivating a Facility while patients are waiting. `display_devices` (settings-owned) arrives in Epic 5.
