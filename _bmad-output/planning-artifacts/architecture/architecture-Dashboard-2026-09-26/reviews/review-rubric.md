# Rubric Review: ARCHITECTURE-SPINE.md (Hospital OPD)

- **Reviewed:** `ARCHITECTURE-SPINE.md` (draft, 2026-09-26)
- **Against:** the good-spine checklist; PRD `prd.md` and `addendum.md`; the brownfield codebase at `src/` (Next.js 16.3.6, shadcn radix-nova, story 1.4 table pattern, story 1.5 shell); `node_modules/next/dist/docs`; the npm registry (checked 2026-09-26).
- **Verdict:** **Needs revision before epics.** The core is strong. The layering, permission map, serialized queue numbering, stored order, single clock and isolated Display Board all fix real divergence points with enforceable rules. What is missing:
  - scheduled end-of-day work, which no AD owns;
  - a table-ownership map, without which AD-2 cannot be enforced;
  - how the 15-minute idle timeout coexists with 3-second polling;
  - the synchronous-transaction constraint of better-sqlite3;
  - most of the operational envelope (process supervision, migrations at deploy, environments and secrets, first-Admin bootstrap, seed and demo data, monitoring).

  None of these needs a new paradigm. Each is a Rule or a row to add.

---

## 1. Checklist scorecard

| Criterion | Result | Notes |
|---|---|---|
| Fixes the real divergence points for the epics | Partial | Good on queue, permissions, time, settings and audit. Missing: scheduled jobs, table ownership (visits and counters), audit row shape, frozen queue-number prefix, pilot "live Facility" flag, paper-visit numbering. |
| Every AD Rule is enforceable and prevents its divergence | Mostly | AD-2 has no ownership list. AD-3's "BEGIN IMMEDIATE" is the wrong lever; the real guarantee is a synchronous transaction body. AD-9 names the wrong plugin for username sign-in and conflicts with AD-10 on idle expiry. |
| Nothing under Deferred lets two units diverge | Pass (minor) | The deferrals are safe. Hosting deferral is fine for units, but it leaves the operational envelope blank (see §5). |
| Named tech is verified-current | Pass | All versions match npm `latest` today (see §4). |
| Ratifies the brownfield codebase | Mostly | One real contradiction: `proxy.ts` at the repo root is ignored when `src/` is used. Also an unstated `(dashboard)` → `(staff)` rename. |
| Covers PRD FR-1..27, NFR-1..7, PRIV-1..7 | Partial | Gaps: FR-12 and FR-18 (end-of-day), FR-23 (prefix takes effect next day), FR-26 (sign-in audit, immutability at the DB level, old/new values), §10 pilot, PRIV-4 (trivial). |
| Operational envelope decided, deferred or open | **Fail** | Backups and TLS are decided. Process management, migrations at deploy, dev/test/prod environments, secrets, monitoring and health, first Admin, and seed/demo data are absent. They are neither decided nor listed as deferred or open. |

---

## 2. Findings

### F1 — CRITICAL: No AD owns scheduled, time-triggered work
- **Where:** absent. It touches FR-12, FR-18, the Glossary "Visit status … No-show at end of day", AD-12's nightly backup, and the FR-12 30-minute warning.
- **Problem:** Several epics each need something to happen at a time with no user action:
  - the queue epic cancels Waiting or Called entries at each Facility's closing time;
  - the appointments epic marks unchecked Appointments Missed;
  - Visits must end as No-show or Cancelled;
  - the 30-minutes-before-closing warning;
  - the nightly `VACUUM INTO`.

  Without a decision, each epic picks its own mechanism: `setInterval` in the Next process, an OS scheduled task hitting a route, or lazy "close on first read of a new day". Some of these break AD-3, which forbids route-handler writes. Some break when the server restarts or is off at closing time. The audit actor is also undefined.
- **Fix:** Add **AD-13 — Day-close is one idempotent job**:
  - a single `server/jobs/day-close.ts` calls the `queue`, `appointments` and triage/visit services, each in its own transaction;
  - it is keyed by `(facility_id, opd_date)` in a `job_runs` table, so re-runs are no-ops;
  - it is triggered in two ways: by an in-process scheduler (e.g. `instrumentation.ts` registering a 1-minute tick) **and** at startup, to catch up on missed days;
  - it audits as a reserved `system` actor.

  State where the backup schedule lives (OS scheduler, calling a script, not the web process).

### F2 — HIGH: AD-2 "modules own their tables" has no ownership list; `visits` has no owner
- **Where:** AD-2, the module list, the ER diagram, the Capability map.
- **Problem:** The rule is only enforceable if each table has a named owner. `visits`, `triage_records`, the Hospital Number counter, Facility-assignment rows for users (a many-to-many, since Facility Staff can have several Facilities), `display_devices` (implied settings), and Better Auth's tables are not assigned to a module.
  - `visits` is written by triage (create, Directed to ER), queue (completion or No-show ends the Visit), appointments (check-in "starts a Visit") and paper entry.
  - Visit status is not said to be stored or derived.

  Epics 2, 3 and 4 will each write `visits.status` their own way.
- **Fix:** Add a Table → Owner table to the spine, e.g.:

  | Tables | Owning module |
  |---|---|
  | `patients`, `hospital_number_counter` | patients |
  | `visits`, `triage_records` | triage |
  | `queue_entries`, `queue_counters`, `facility_records` | queue |
  | `appointments` | appointments |
  | `doctors`, `departments`, `duty_days` | directory |
  | `facilities`, `urgency_levels`, `priority_categories`, `schedules`, `display_devices` | settings |
  | `audit_log` | audit |
  | Better Auth tables + `user_facilities` | auth |

  Also state: "Visit status is stored and changed only by `triage.service.closeVisit/…`, which the queue service calls when the last entry ends."

### F3 — HIGH: The 15-minute idle expiry (AD-9) is defeated by 3-second polling (AD-10), and Better Auth details are wrong
- **Where:** AD-9, AD-10, AD-3.
- **Problems:**
  1. **Polling keeps sessions alive.** The Facility Queue and Overview poll every 3 s with the staff session. If session reads refresh expiry (Better Auth's `updateAge` behaviour), an unattended counter PC never idles out. That breaks FR-1 and weakens PRIV-1.
  2. **Wrong plugin.** Username sign-in needs Better Auth's **`username` plugin**. The `admin` plugin provides roles and ban, not usernames.
  3. **No lockout plugin.** Better Auth has no built-in failed-attempt lockout. The spine hedges ("if the plugin does not provide it"), which leaves the design to whoever builds it.
  4. **Locked vs deactivated.** "Locked" (FR-1) and "deactivated" (FR-3) are different states. Both could collapse into the admin plugin's `banned` flag.
  5. **Impersonation is on by default.** The admin plugin enables impersonation, which conflicts with PRIV-7 (every action traces to one person).
  6. **Unacknowledged write path.** The Better Auth handler (`api/auth/[...all]`) writes sessions and accounts, which contradicts AD-3's "no route-handler writes". FR-26 requires sign-ins (and, for PRIV-6, failed sign-ins) in the audit log, and AD-3's "one command, one audit row" never covers them.
- **Fix:** Amend AD-9:
  - use the `username` + `admin` plugins, with impersonation disabled;
  - keep `failed_attempts` and `locked_at` in a `user` extension owned by auth, set in a `hooks.after` on sign-in failure. `banned` means deactivated only;
  - make the Better Auth handler the single sanctioned exception to AD-3, and have its `databaseHooks.session.create` and the failure hook write audit rows;
  - polling handlers read the session with refresh disabled (`disableRefresh`/cookie-cache read), so only user-initiated requests extend it. Say the same for the client, e.g. idle measured from user input.

### F4 — HIGH: The AD-3/AD-5 transaction rule names the wrong guarantee for better-sqlite3
- **Where:** AD-3, AD-5.
- **Problem:** better-sqlite3 is synchronous. Drizzle's better-sqlite3 `db.transaction` callback **must not be async**; returning a promise throws or silently breaks atomicity. In a single Node process, the real serialization guarantee is that the whole command body runs synchronously inside the callback. `BEGIN IMMEDIATE` only matters against *other processes* (the migration CLI, the backup script).

  A developer who writes `async` service methods with `await` inside the transaction, which is the natural Server Action style, breaks AD-5's "no duplicate numbers / no double call" and the Hospital Number counter. The current Rule would not stop them.
- **Fix:** Add to AD-3: "Service command bodies are synchronous: all reads, writes and `audit.record` run inside `db.transaction(fn, { behavior: 'immediate' })` with no `await`. Any async work (none expected) happens before or after. Every write transaction is IMMEDIATE, not only AD-5's." Back it with a Vitest concurrency test for FR-8 and FR-11, as the addendum asks.

### F5 — HIGH: The operational envelope is mostly undecided and not listed as deferred or open
- **Where:** AD-1, AD-12, Structural Seed, Deferred.
- **Problem:** Only TLS-at-a-proxy, the volume encryption and the backup cadence are decided. The following are absent. Each one is something an epic's first story or the go-live needs, and different builders would each improvise it.
  - **Process supervision and restart.** NFR-3 needs start-on-boot and restart-on-crash (Windows service via NSSM, PM2, or systemd). The reverse proxy product (Caddy, IIS, nginx) is also unnamed.
  - **Migrations at deploy.** AD-1 says migrations are committed, but not *when they run*: on startup from `src/server/db/migrate`, or as an explicit pre-start `drizzle-kit migrate` step. It also does not say that a pre-migration backup is taken first.
  - **Environments.** Dev, test and prod DB paths, `.env` variables (`DATABASE_PATH`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TZ` independence), and where the secret lives on the server.
  - **Test environment.** Vitest is named, but there is no rule for the test DB (a fresh file or `:memory:` per suite with migrations applied), and `package.json` has no `test` script.
  - **First Admin bootstrap.** PRIV-7 forbids shared accounts, so a named first Admin must come from somewhere, e.g. a one-off `create-admin` CLI.
  - **Seed vs demo data.** AD-8's "seed migrations insert PRD defaults" is fine for prod settings. There is no decision on demo patients or queues for dev, the pilot training (§10) and the UAT, nor any guarantee that they never reach prod.
  - **Monitoring.** NPC Circular 2023-06 requires "logging and monitoring" and PRIV-6 needs breach readiness. There is no health endpoint, no log destination or rotation, and no alert on backup failure or disk space. The restore steps are "documented" but no restore test is required.
- **Fix:** Add an **Operations** section (or AD-14) that decides:
  - migrate-on-deploy via a `db:migrate` script run before `next start`, after an automatic `VACUUM INTO` pre-migration backup;
  - a supervisor per OS (with the named choice deferred to OQ4);
  - the `.env` contract;
  - the test-DB rule;
  - a `create-admin` CLI;
  - `db:seed:demo`, refused when `NODE_ENV=production`;
  - `/api/health` (DB reachable, last backup age);
  - rotating app logs with no PHI;
  - a monthly restore drill.

  Anything left to the hospital goes explicitly under Deferred with its owner.

### F6 — MEDIUM: Queue Number prefix and "live Facility" state are not frozen per entry or per day
- **Where:** Conventions ("formatted only by `formatQueueNumber()`"), AD-6, AD-8.
- **Problem:**
  - **Prefix changes.** FR-23 says a prefix change takes effect the next day, never mid-day. If `formatQueueNumber()` reads the Facility's current prefix, the Display Board and queue list relabel today's numbers the moment an Admin edits it.
  - **Pilot rollout.** PRD §10 needs a per-Facility "live in the system" state. It governs triage (issue a system number or not), referral (record the outcome without an entry) and the Display Board (only live Facilities). Three epics must agree, and no AD or setting names it.
- **Fix:**
  - Store `prefix` (or the formatted `queue_number`) on `queue_entries` at issue time, alongside AD-6's stored fields.
  - Add `pending_prefix` with an effective `opd_date`.
  - Add `facilities.is_live` to AD-8, with the three behaviours listed in the Capability map.

### F7 — MEDIUM: Audit row shape and immutability are unspecified
- **Where:** AD-3, FR-6, FR-26, PRIV-2, PRIV-6.
- **Problem:**
  - **Shape.** Every module calls `audit.record(...)`, but the signature and columns are not fixed. FR-6 needs old and new values. FR-26 needs search by staff, Patient Record, action and date. PRIV-6 needs "who touched which patient". Modules will pass differently shaped payloads, and the patient id will be missing on queue or appointment actions.
  - **Immutability.** "No one can edit or delete" is enforced only by convention.
  - **Reads.** AD-3 says Patient Record reads call `recordView`, but not whether the live queue (which shows names) counts as a view.
- **Fix:**
  - Fix the signature: `record({ actorId, action, entityType, entityId, patientId?, before?, after?, reason? })`. Keep `action` as a closed union in `server/audit/actions.ts`, and add an index on `(patient_id, at)` and `(actor_id, at)`.
  - Add SQLite `BEFORE UPDATE`/`BEFORE DELETE` triggers on `audit_log` that `RAISE(ABORT)`.
  - Define which reads are "views": the Patient Record page and the Serving-panel detail, not queue lists.

### F8 — MEDIUM: Paper back-entry (FR-25) collides with the queue numbering invariants
- **Where:** AD-5, Capability map row "Paper back-entry".
- **Problem:** Paper visits go "through triage + queue services with `entered_from_paper`". It is undefined whether they create `queue_entries` for the past `opd_date`, and with what `seq`. If they draw from `queue_counters`, the numbers differ from the paper slips. If they reuse the paper numbers, they can violate `UNIQUE(facility_id, opd_date, seq)` on a day that had system entries before the outage. They might also get swept by the F1 day-close.
- **Fix:** Rule: paper visits create `queue_entries` with `seq NULL`, a free-text `paper_number`, a terminal status only (never Waiting), and `entered_from_paper = 1`. They are excluded from counters, the Display Board and live reads, but included in Overview/SM metrics for their real `opd_date`.

### F9 — MEDIUM: `proxy.ts` location contradicts Next.js 16 with a `src/` layout
- **Where:** Structural Seed (`proxy.ts` at the repo root), AD-4.
- **Evidence:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/src-folder.md`: "If you're using Proxy, ensure it is placed inside the `src` folder." `proxy.md`: "…inside `src` if applicable, so that it is located at the same level as `app`."
- **Problem:** A root `proxy.ts` is silently ignored, so FR-1's redirect of signed-out users does nothing. `requireStaff()` still protects the data, so this is correctness, not a breach.
- **Fix:** Change the seed to `src/proxy.ts`.

### F10 — LOW: Brownfield and minor items
- **Route group rename.** The current route group is `src/app/(dashboard)/` (story 1.5 shell). The spine's `(staff)` is a rename it should state, so the first story moves the layout rather than creating a second shell.
- **Placement of the story 1.4 pattern.** The pattern lives in `src/lib/orders-query.ts` / `orders-href.ts` (pure parsers, client-safe href builder). State that its generalization goes into `src/lib/` (client-safe) plus `server/<module>/queries.ts`. Carry forward the addendum's known toolbar-URL-sync bug as the first story's fix.
- **RSC vs TanStack refresh.** AD-10 has no rule for how RSC-rendered pages refresh after a Server Action (`revalidatePath`/`router.refresh`) versus TanStack invalidation. Pick one per screen type: live screens use TanStack with RSC initial data via `HydrationBoundary`; non-live pages use `revalidatePath`.
- **Caching patient data.** No rule forbids `'use cache'` or Cache Components on patient or queue data. Add a one-liner.
- **Minor stack gaps:**
  - `@types/node ^20` vs Node 24 runtime;
  - Recharts (in `package.json`) is unmentioned; ratify it for the Overview or remove it;
  - PRIV-4 (a notice-given flag on `patients`) is not in the Capability map;
  - the Structural Seed assumes a "Hospital network" while hosting is deferred to OQ4. Either tag it as the working assumption or generalize it.

---

## 3. What is good (keep)

- **AD-4:** a single permission map mirroring FR-2, with `can()` at actions and read handlers and cosmetic-only UI hiding. It is exactly the right boundary.
- **AD-5 + AD-6:** `UNIQUE(facility_id, opd_date, seq)`, a counter row, and stored `sort_group/urgency_rank/entered_at` read through one repo function. This cleanly satisfies FR-9, FR-14, FR-24 ("existing entries keep their group") and SM-4.
- **AD-7:** one `opdDate()` in `Asia/Manila` removes the classic midnight and TZ bugs.
- **AD-11:** a typed response that structurally cannot carry PHI, and a device token checked every poll. The token check satisfies FR-27's "within one refresh cycle".
- **Conventions:**
  - the `{ ok, data } | { ok, error }` action result;
  - `DomainError`;
  - `server-only`;
  - PHI-free logs;
  - verbatim Glossary naming.
- **Deferred list:** each item has a reason and a revisit trigger, and none lets units diverge.

## 4. Stack verification (npm registry, 2026-09-26)

| Package | Spine | npm `latest` | OK |
|---|---|---|---|
| next | 16.3.6 | 16.3.6 | yes (matches `package.json`) |
| react / react-dom | 19.2.8 | — | matches `package.json` |
| shadcn CLI | 4.21.0 | 4.21.0 | yes (`components.json` style `radix-nova`) |
| better-sqlite3 | 13.0.3 | 13.0.3 | yes; engines `node >=22`; local Node 24.21.0 |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | 0.45.3 / 0.31.11 | yes (1.0 is still rc; correct to stay on 0.45) |
| better-auth | 1.7.6 | 1.7.6 | yes; peer deps accept next ^16, drizzle-orm ^0.45.2, drizzle-kit >=0.31.4 |
| @tanstack/react-query | 5.104.0 | 5.104.0 | yes |
| zod | 4.6.5 | 4.6.5 | yes |
| vitest | 5.0.2 | 5.0.2 | yes |

## 5. Operational envelope checklist

| Dimension | Status in spine | Needed |
|---|---|---|
| Deployment topology | Decided (single `next start` behind TLS proxy) | Name the proxy, or defer it to OQ4 explicitly |
| Hosting / infra | Deferred to OQ4 (OK) | — |
| Process supervision / restart / start-on-boot | **Missing** | Decide, or defer with owner (NFR-3) |
| Migrations at deploy | **Missing** (only "committed to `drizzle/`") | When they run, with a pre-migration backup |
| Backups | Decided (nightly `VACUUM INTO`, 30 days, separate disk) | Scheduler owner, restore drill, off-site copy decision |
| Scheduled app jobs (day-close) | **Missing** | F1 |
| Monitoring / health / log retention | **Missing** | F5 |
| dev / test / prod environments, secrets | **Missing** | F5 |
| Seed (prod defaults) | Decided (AD-8) | — |
| Demo / training data | **Missing** | F5 |
| First Admin bootstrap | **Missing** | F5 |

## 6. PRD coverage gaps (others covered)

| Requirement | Gap |
|---|---|
| FR-1 | Idle timeout vs polling (F3); proxy location (F9) |
| FR-12, FR-18, Visit end states | No scheduler (F1) |
| FR-23 | Prefix takes effect next day (F6); "Facility closed now" check should state it uses `opdDate`/Manila time (AD-7, implied) |
| FR-25 | Numbering collision (F8) |
| FR-26 / PRIV-2 / PRIV-6 | Sign-in audit, row shape, DB immutability (F3, F7) |
| §10 Rollout | Live-Facility flag (F6) |
| PRIV-4 | Notice-given field not mapped (F10) |
| SM-2 / SM-C2 | Ensure `queue_entries` stores `called_at`, `serving_at`, `completed_at` and `recall_count` (fold into AD-5/AD-6) |
