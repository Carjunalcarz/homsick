# Operations

How to deploy, back up, restore and run the OPD app on the hospital server. The app runs as a single `next start` process on one machine, with one SQLite database file. It is not built for serverless hosting or more than one process.

## The `.env` contract

The app reads these from `.env` in the project folder (copy `.env.example`). With `NODE_ENV=production` (which `next start` sets) every value is required, and the server refuses to start when one is missing. The message names the missing keys, never their values.

| Variable | Meaning |
|---|---|
| `DATABASE_PATH` | The SQLite database file. Keep it on an OS-encrypted volume. |
| `BACKUP_DIR` | Where backups go. Use a **separate** OS-encrypted disk from the database. |
| `BETTER_AUTH_SECRET` | Session signing secret, at least 32 random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | The HTTPS URL staff open the app at (the reverse proxy's address). |
| `NODE_ENV` | `production` on the server. `next start` sets it; the CLI scripts read it from the environment. |

`.env` holds the session secret: keep it readable only by the account that runs the app, and never commit it.

## Deploy order

Run these in the project folder for a first install and for every update:

1. `npm ci` installs the exact locked dependencies.
2. `npm run build` builds the app. It does not touch the database or start the scheduler.
3. `npm run db:migrate` first copies the existing database to `BACKUP_DIR/pre-migrate-<UTC timestamp>.sqlite`, then applies the new migrations. When the copy fails, nothing is migrated and the command exits with code 1: fix the problem (usually `BACKUP_DIR` is missing, full or not writable) and run it again. A new, empty database gets no pre-migrate copy.
4. Restart the app (`npm run start`, or the service that runs it).
5. Open `/api/health` and check `"db": "up"` (see "Checking backups").

On a first install, create the first Admin after step 3 (see below).

## Accounts from the command line

- `npm run create-admin` creates an Admin. It prompts for the full name, username and password (hidden, entered twice). There is no default account or password, and each person gets their own account. For scripts: set `OPD_ADMIN_PASSWORD` and run `npm run create-admin -- --name "Ana Cruz" --username ana.cruz`.
- `npm run unlock-user -- --username ana.cruz` unlocks an account locked after 5 failed sign-ins. Use it when the only Admin is locked out; otherwise an Admin unlocks accounts at `/admin/staff`. It writes one `auth.unlocked` audit row as the `system` actor and exits non-zero for an unknown username.

Both print the mode and database path before writing, and refuse to run when `NODE_ENV=production` and `DATABASE_PATH` is not set.

## Scheduled jobs

The app runs its own scheduler inside the `next start` process: no cron or external scheduler is needed. It checks every minute, and once right after the server starts. Each job run is recorded in the `job_runs` table and writes one audit row as the `system` actor.

| Job | When (Manila) | What it does | Audit actions |
|---|---|---|---|
| `backup` | 02:00 daily | Nightly backup (below) | `jobs.backup_completed`, `jobs.backup_failed` |
| `rate-limit-purge` | 03:00 daily | Deletes sign-in rate-limit rows untouched for 24 hours | `jobs.rate_limits_purged`, `jobs.rate_limits_purge_failed` |

- Each job runs at most once per OPD day. A run that succeeded is never repeated, even across restarts.
- A failed run is retried no sooner than **30 minutes** after it failed, up to 3 attempts for that day, so a brief problem (a disk hiccup) doesn't use up every attempt at once. Failures record the error message only, never data.
- A run cut off by a crash or restart is marked failed with the error "Interrupted" after an hour. It is tried again if it has attempts left.
- If the server was down when a job was due, it runs once when the server starts again, for the latest due day only (missed earlier days are not replayed). Starting at 01:00 runs the previous day's backup; starting at 09:00 runs today's.

## Backups

- **Nightly:** `BACKUP_DIR/opd-<YYYY-MM-DD>.sqlite`, a complete copy made with SQLite's `VACUUM INTO` while the app runs. It is written to a temp file and renamed when complete, so a file with the final name is always a whole backup. The newest **30** nightly files are kept and older ones deleted.
- **Before each migration:** `BACKUP_DIR/pre-migrate-<UTC timestamp>.sqlite` (e.g. `pre-migrate-20260927T010203Z.sqlite`). The newest **10** are kept.
- A copy that crashed part-way leaves a `….tmp` file. The next backup of the same kind deletes such temp files once they are over an hour old.
- Nothing else in `BACKUP_DIR` is touched, so other files there are safe (but keep the folder for backups only). A backup is never deleted by pruning in the same run that wrote it, even if the server clock is wrong.
- **Location:** put `BACKUP_DIR` on a different physical disk from `DATABASE_PATH`, OS-encrypted like the database. The app does not encrypt backups itself. Copying backups off the machine (for example to an encrypted external drive kept in a locked room) is recommended. The files hold patient data: treat every copy as you treat the database.

### Checking backups

`GET /api/health` is public and carries no patient data:

```json
{
  "ok": true,
  "db": "up",
  "time": "2026-09-28T01:00:00.000Z",
  "lastBackupAt": "2026-09-27T18:00:04.512Z",
  "backupStale": false,
  "jobs": [
    { "job": "backup", "key": "2026-09-28", "status": "ok", "finishedAt": "2026-09-27T18:00:04.512Z" },
    { "job": "rate-limit-purge", "key": "2026-09-28", "status": "ok", "finishedAt": "2026-09-27T19:00:00.201Z" }
  ]
}
```

- `db` is `up` (HTTP 200) or `down` (HTTP 503).
- `lastBackupAt` is when the last successful nightly backup finished (UTC), or `null` if there has been none.
- `backupStale` is `true` when there is no successful backup, or the last one finished more than 26 hours ago. It doesn't change the HTTP status: the status code only says whether the database answers.
- `jobs` lists the latest run of each job: `status` is `running`, `ok` or `failed`.

Check it daily (or point a monitor at it): `backupStale` should be `false`, and no job should show `failed`. After 3 failed attempts a day's backup stops retrying, even after a restart, and the next night's backup is tried as usual. Look at the audit log (`/admin/audit`, entity "Scheduled job run") for the error and fix it. To get a backup at once, run `npm run db:migrate`: it writes a `pre-migrate-*.sqlite` copy even when there is nothing to migrate. Also check the free space on the backup disk now and then.

## Restore drill

Run this before go-live and then every quarter, on a test machine or during a planned downtime, so everyone knows it works.

1. Stop the app.
2. Keep the current database aside, e.g. rename `opd.sqlite` to `opd.sqlite.before-restore` (and its `-wal` / `-shm` files with it).
3. Copy the chosen backup (the latest `opd-<date>.sqlite`, or a `pre-migrate-*.sqlite` to undo a migration) over `DATABASE_PATH`.
4. Delete any `<DATABASE_PATH>-wal` and `<DATABASE_PATH>-shm` files left next to it. They belong to the old database and must not be applied to the restored one.
5. If the backup is from an older app version, run `npm run db:migrate`.
6. Start the app.
7. Open `/api/health`: expect HTTP 200 and `"db": "up"`.
8. Sign in and check that recent records are there (the audit log shows the last actions before the backup).

Write down the date, the backup used, how long it took and who ran it. Anything recorded after the backup was taken is lost on restore: re-enter it from the paper slips (below).

## Security baseline

- **Encryption at rest:** turn on OS volume encryption (BitLocker on Windows) for the disk holding `DATABASE_PATH` and the disk holding `BACKUP_DIR`. Keep the recovery keys somewhere safe that is not the server.
- **TLS:** the app serves plain HTTP on its port. Put a reverse proxy (nginx, IIS, Caddy) in front that ends TLS, redirects HTTP to HTTPS, and is the only way to reach the app. Set `BETTER_AUTH_URL` to the HTTPS address. The proxy must set or overwrite `X-Forwarded-For` and `X-Real-IP` (see "Sessions and lockout" in the README), because the sign-in rate limit uses them.
- App logs never contain patient identifiers. Job logs name the job, the day and the error message only.

## Paper-slip fallback (NFR-3)

When the app is down (server failure, restore in progress, network outage):

1. Triage and Facility staff switch to the paper slips: write the patient's name, the time, the Facility, the urgency and any priority category on a numbered slip, and call patients in slip order.
2. Keep the slips together by Facility and OPD day.
3. When the app is back, check `/api/health`, then enter the day's slips in the app, oldest first.
4. Keep the slips for the hospital's records period, then dispose of them as confidential waste.
