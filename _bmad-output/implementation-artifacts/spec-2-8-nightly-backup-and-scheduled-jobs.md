---
title: 'Story 2.8: Nightly backup and scheduled jobs'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-8-nightly-backup-and-scheduled-jobs'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing backs up the SQLite database, and there is no place for timed work. A disk failure would lose the OPD's records. Epics 4 and 6 need a scheduler for facility close, missed appointments and the pre-close warning. Old `rate_limits` rows are never cleaned up (deferred from Story 2.3).

**Approach:** Add a `jobs` module with a `job_runs` table and one in-process scheduler, started once from `instrumentation.ts`. Register two jobs:
- a nightly `VACUUM INTO` backup at 02:00 Manila, keeping 30 files;
- a daily `rate_limits` purge.

`db:migrate` takes a pre-migration backup, `/api/health` reports the backup and job state, and `docs/operations.md` is written. This follows epics.md Story 2.8, AD-12, AD-14 and Operations.

## Boundaries & Constraints

**Always:**
- **Scheduler:**
  - One per process: a `globalThis` guard, so dev hot reloads don't start a second.
  - Started from `register()` only on the Node.js runtime, never during the build, and never under Vitest.
  - Ticks every 60 s with an `unref()`'d timer and also runs once right after start (catch-up). A tick never overlaps a running one.
- **Jobs:** each job has a name, a key function (e.g. `backup:<opd_date>`) and a due time (Manila).
  - A run first claims `job_runs(job, key)` (UNIQUE), so a key that succeeded never runs again.
  - A failed run is retried on later ticks, up to 3 attempts per key.
  - On startup only the latest due key of each job is caught up, not every missed day.
- **Audit:** every run writes one audit row as the `system` actor ("backup job", "rate-limit cleanup"). Success and failure are both audited. Failures record the error message only, never data.
- **Backup:**
  - Runs at 02:00 Manila with key `<opd_date>`, written to `BACKUP_DIR/opd-<YYYY-MM-DD>.sqlite`.
  - `VACUUM INTO` a temp file, then rename it, so a partial file never looks complete.
  - Keeps the newest 30 `opd-*.sqlite` files and deletes older ones; nothing else in the folder is touched.
  - `VACUUM` can't run inside a transaction, so the copy runs first and the `job_runs` update plus audit row run in `withCommandTx` right after.
- **Pre-migration backup:** `db:migrate` writes `BACKUP_DIR/pre-migrate-<UTC timestamp>.sqlite` before migrating an existing database with tables. It skips a new or empty file and keeps the newest 10 such files. If the backup fails, the migration doesn't run and the command exits non-zero.
- **Rate-limit purge:** runs at 03:00 Manila. It deletes `rate_limits` rows whose `last_request` is older than 24 h, through an `auth` service function (auth owns the table), and audits the count.
- **Health:** stays public and patient-free. It adds `lastBackupAt` (the last successful backup's finish time, or null) and `jobs: [{ job, key, status, finishedAt }]` (the latest run of each). `db` up/down and 200/503 are unchanged.

**Never:**
- No cron dependency or external scheduler.
- No multi-process locking beyond `job_runs` (a single `next start` process, AD-1).
- No facility-close, appointments or pre-close jobs (Epics 4 and 6).
- No restore UI.
- No backup encryption in the app (the volume is encrypted, AD-12).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nightly run | 02:05 Manila, no `backup:2026-09-28` row | one file `opd-2026-09-28.sqlite`, `job_runs` ok, one audit row | N/A |
| Already done | tick at 02:06, same key ok | nothing runs | N/A |
| Server was down | start at 09:00 Manila, key for today missing | caught up once at startup | N/A |
| Before 02:00 | start at 01:00, yesterday's key missing | yesterday's key runs (latest due key) | N/A |
| Retention | 31 nightly files and 2 other files | the oldest nightly deleted; the others kept | N/A |
| Backup fails | `BACKUP_DIR` not writable | `job_runs` failed with attempt 1, audit `jobs.backup_failed`, retried next tick, stops after 3 | no temp file left |
| Migrate | existing DB | pre-migrate file written before migrating | backup error → exit 1, DB untouched |

</frozen-after-approval>

## Code Map

- `src/instrumentation.ts`: `register()` checks the env; start the scheduler after `assertEnvOrExit()`. Guard it with `process.env.VITEST`.
- `src/server/db/client.ts` (`openDatabase`, `getDb`), `tx.ts` (`withCommandTx`), `migrate.ts` (`runMigrations`). Add `src/server/db/backup.ts` with `backupTo(db, file)`: `VACUUM INTO` a temp file, then rename. `db:migrate` and the job share it.
- `scripts/migrate.ts` + `scripts/load-env.ts`: add the pre-migration backup (it uses `getEnv().BACKUP_DIR`).
- `src/server/auth/schema.ts` owns `rate_limits` (see `sign-in-limit.ts` and the Better Auth rateLimit config for the windows). Add `purgeRateLimits(tx, before)` in an auth service file.
- `src/server/audit/schema.ts`: add `AuditAction` entries `jobs.backup_completed`, `jobs.backup_failed`, `jobs.rate_limits_purged`, `jobs.rate_limits_purge_failed`, with labels. Add entity `job_run` to `AUDIT_ENTITIES` and its label.
- `src/lib/time.ts`: `opdDate`, `manilaMinutes`, `addOpdDays`.
- `src/app/api/health/route.ts`: extend it. Read through `jobs/queries.ts`, and keep it working when `job_runs` doesn't exist yet.
- `README.md` (Operations and Server code sections), `.env.example`.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/jobs/schema.ts` + migration `0007_job_runs`: `job_runs` with id, job, key, opd_date, status (CHECK `running|ok|failed`), attempts, started_at, finished_at, error, and UNIQUE(job, key). Register it in `schema-index.ts`.
- [x] `src/server/jobs/`:
  - `scheduler.ts`: `startScheduler`, `stopScheduler` (tests) and `runDueJobs(now)` (pure-ish and testable with an injected clock and db);
  - `registry.ts`: the job definitions;
  - `backup-job.ts`, `rate-limit-job.ts`;
  - `queries.ts`: `lastBackupAt`, `latestRuns`.
- [x] `src/server/db/backup.ts`: `backupTo`, and `pruneBackups(dir, prefix, keep)`.
- [x] `scripts/migrate.ts`: the pre-migration backup.
- [x] `src/instrumentation.ts`: start the scheduler.
- [x] `/api/health`: the new fields.
- [x] Tests (temp dirs and DBs, injected clock):
  - every I/O Matrix row;
  - idempotency under two runs at once;
  - the Manila 02:00 boundary;
  - pruning never touches non-matching files;
  - health 200 with the fields, and 503 when the DB is down;
  - the migrate backup is skipped for an empty DB;
  - the rate-limit purge deletes only old rows, with one audit row.
- [x] `docs/operations.md` (new), covering:
  - the deploy order and the `.env` contract;
  - `create-admin` and `unlock-user`;
  - backups: location on a separate encrypted disk, retention, the pre-migrate files, and checking `/api/health`;
  - the restore drill: stop the app, copy a backup over `DATABASE_PATH`, remove the `-wal`/`-shm` files, start, check health, sign in. Run it before go-live and quarterly;
  - OS volume encryption (BitLocker) for the DB and backups, and TLS at a reverse proxy;
  - the paper-slip fallback during outages (NFR-3).
- [x] `README.md`: link the operations doc, and add the jobs module.

**Acceptance Criteria:**
- Given `next start` with a DB, when it starts, then exactly one scheduler runs, and a missing due backup is written to `BACKUP_DIR` within a minute and shows in `/api/health`.
- Given `npm run db:migrate` on an existing DB, when it runs, then a `pre-migrate-*.sqlite` file exists before any migration applies.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass, and the build doesn't start the scheduler.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot (the diff script doesn't cover `docs/`).

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | `docs/operations.md` missing from the diff | false: the file exists with every required section; the snapshot diff doesn't include `docs/` | reject |
| 2 | `addOpdDays` may not exist | false: exported from `src/lib/time.ts` since Story 2.4 | reject |
| 3 | Synchronous `VACUUM INTO` blocks requests; a daytime restart catches up during clinic hours | low: the DB is a few MB, so a copy takes well under a second; the async backup API is a larger change | reject |
| 4 | Three retries are used up in about 3 minutes, so a brief disk hiccup loses that day's backup | medium | patch (wait 30 min after a failure before retrying) |
| 5 | `/api/health` stays `ok` while backups fail or go stale | low: status-code-only monitoring misses a backup outage | patch (add `backupStale`, true when there's no ok backup in the last 26 h; status codes unchanged) |
| 6 | A crash during `VACUUM INTO` leaves a full `.tmp` copy that nothing removes | low: a full copy of patient data left on disk indefinitely | patch (sweep leftover `*.tmp` files older than 1 h before each backup) |
| 7 | No fsync or integrity check on the finished copy | low: SQLite writes the file; checking it is beyond scope | reject |
| 8 | `db:migrate` backs up on every run; two runs in the same second overwrite the file | low: backing up on every run is what the spec says; same-second runs can't happen in practice (tsx startup takes seconds) | reject |
| 9 | A `claimRun` throw aborts the tick, so later jobs are skipped (blind, edge) | low | patch (catch it per job and report failed) |
| 10 | The concurrency test doesn't contend the IMMEDIATE lock | low: it covers "a running row isn't reclaimed"; the lock is SQLite's own guarantee | reject |
| 11 | `job_runs` has no CHECKs on `attempts` or date formats | low | reject |
| 12 | The production `JOBS` list and the default deps are never exercised (verification-gap) | medium | patch |
| 13 | The "backup failure stops `db:migrate`" ordering is untested (verification-gap) | medium | patch (move it into a tested `migrateWithBackup` in `src/server/db`) |
| 14 | `lastBackupAt` with a failed run or several ok runs is untested (verification-gap) | medium | patch |
| 15 | The health route's inner catch never runs in tests (verification-gap) | medium | patch |
| 16 | A crash during attempt 3 leaves the row `running` forever (attempts are checked before staleness); an older day's crashed row is never resolved either (edge, verification-gap) | medium: health reports `running`, and the failure is never visible | patch |
| 17 | A stale takeover while the original run is still going gives two finishes | low: needs a backup that runs over 60 minutes | reject |
| 18 | Recording a failure can itself fail, leaving the row running for an hour | low: the stale rule recovers it | reject |
| 19 | A prune error marks a good backup as failed | low | patch (catch it and record `pruneError` on the success row) |
| 20 | With the clock behind, the pre-migrate file just written can be pruned | low: the fix is a direct correction | patch (never prune the file just written) |
| 21 | A dev hot reload keeps the old job code in the running scheduler | low: dev only | reject |

Patches applied: #4, #5, #6, #9, #12, #13, #14, #15, #16, #19, #20. Rejected: #1, #2, #3, #7, #8, #10, #11, #17, #18, #21. Nothing deferred.
Re-verified 2026-09-27 after patches: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 516 tests pass (35 files), `npm run build` OK.

Smoke check with `next start` on port 3100 (throwaway DB and backup folder):
- `db:migrate` wrote `pre-migrate-*.sqlite` first.
- On start, the server wrote `opd-2026-09-27.sqlite`.
- `/api/health` returned `lastBackupAt`, `backupStale: false`, and both jobs `ok`.
- A restart made no new run, and the file was not rewritten.

## Verification

**Commands:**
- `npm run db:migrate` (dev DB, which must write a pre-migrate file), then `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build`: expected all pass.

**Manual checks:**
- On a throwaway DB with `next start` on port 3100 and `BACKUP_DIR` set to a scratch folder:
  - the backup file appears after start;
  - `/api/health` shows `lastBackupAt` and the jobs;
  - a restart doesn't write a second file for the same day;
  - the backup opens with sqlite and holds the same row counts.
