---
title: 'Story 2.2: First Admin signs in'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-2-first-admin-signs-in'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-Dashboard-2026-09-26/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The OPD shell (Story 2.1) has no database, no sign-in and no audit trail. Anyone can open it, and nothing is recorded, which is unacceptable for a hospital system under RA 10173.

**Approach:** Add the platform core: the SQLite database through Drizzle (migrations only), and Better Auth username/password sign-in with a `create-admin` CLI and no default password. Protect all staff pages, write an append-only audit log for sign-in and sign-out, and add the command helpers, `opdDate()`, a health endpoint and Vitest DB tests that later stories build on. This follows epics.md Story 2.2 and architecture AD-1, AD-3, AD-7, AD-9 and Operations.

## Boundaries & Constraints

**Always:**
- One SQLite file at `DATABASE_PATH`, opened lazily with WAL, `foreign_keys=ON` and `busy_timeout=5000`. Schema changes only through committed drizzle-kit migrations.
- Every file under `src/server/**` starts with `import "server-only"`.
- Commands run through `withCommandTx(actor, action, fn)`: an IMMEDIATE transaction with a synchronous `fn` and one audit row per command. `audit_log` is append-only, enforced by SQLite triggers.
- Auth events are audited from Better Auth hooks.
- Wrong credentials show only "Wrong username or password".
- In production the app refuses to start if a required env value is missing.
- Pin all new dependencies to exact versions.

**Never:**
- No default or seeded password.
- No shared "admin" account.
- No idle-timeout dialog and no lockout; Story 2.3 adds those.
- No staff management UI or permission map; those are Stories 2.4 and 2.5.
- No scheduler or backups; Story 2.8 adds them.
- No DB access in `src/proxy.ts`.
- No serverless or edge runtime for DB code.

</frozen-after-approval>

## Code Map

- `src/app/(staff)/layout.tsx`, `src/components/app-header.tsx`: the shell from Story 2.1. The header's static "Demo Admin" block becomes the signed-in user's name and Role, with a **Sign out** button (44 px, audited).
- `src/app/layout.tsx`: root layout. Leave it unchanged; the staff layout does the auth check.
- `src/lib/url-query.ts`, `src/components/data-table/*`: from Story 2.1. Not touched.
- **Better Auth 1.7.6:**
  - Import from `better-auth`, `better-auth/adapters/drizzle`, `better-auth/plugins/username`, `better-auth/plugins/admin`, `better-auth/next-js` (`toNextJsHandler`, `nextCookies`) and `better-auth/api` (`createAuthMiddleware`).
  - **No schema CLI ships with 1.7.6** (`@better-auth/cli` is stuck at 1.4). Write its tables by hand in Drizzle: `users`, `sessions`, `accounts` and `verifications`, with the plural names set through the adapter's `usePlural: true`.
  - Include the username plugin fields (`username`, `display_username`) and the admin plugin fields (`role`, `banned`, `ban_reason`, `ban_expires` on users; `impersonated_by` on sessions).
  - Check the column shapes against `node_modules/better-auth/dist/plugins/*/schema` and the core schema.
- **Next 16:** the proxy file is `src/proxy.ts` (it must sit at the same level as `app/`). `connection()` comes from `next/server`. Read `node_modules/next/dist/docs` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`: add `drizzle-orm@0.45.3`, `better-sqlite3@13.0.3`, `better-auth@1.7.6`, `zod@4.6.5` and `server-only@0.0.1`, plus the dev dependencies `drizzle-kit@0.31.11`, `@types/better-sqlite3@9.6.0` and `tsx@4.23.15`, all exact. Add the scripts `db:generate`, `db:migrate` (a runtime migrator script, not `drizzle-kit push`) and `create-admin`. `drizzle.config.ts` points to the `src/server/**/schema.ts` files and outputs to `drizzle/`.
- [x] `src/server/env.ts`: a Zod-parsed env contract (`DATABASE_PATH`, `BACKUP_DIR`, `BETTER_AUTH_SECRET` of at least 32 chars, `BETTER_AUTH_URL`, `NODE_ENV`) that throws on any missing value in production. Development defaults: `data/dev.sqlite` and `data/backups`. Add a `.env.example`, and ignore `data/`.
- [x] `src/server/db/`:
  - the lazy `getDb()` with the pragmas;
  - the schema index;
  - `withCommandTx(actor, action, fn)` with `{ behavior: "immediate" }`, which rejects an async `fn` (throws if it returns a promise);
  - `DomainError(code)`;
  - `migrate.ts`, used by `db:migrate` and by tests.
- [x] `src/server/audit/`:
  - `schema.ts`: `audit_log` (`id`, `at`, `actor_type` staff/system, `actor_id`, `actor_name`, `action`, `entity`, `entity_id`, `changes` JSON text);
  - an `AuditAction` enum (`auth.sign_in`, `auth.sign_out`, `auth.sign_in_failed`, `admin.created`);
  - `record(tx, …)`.
  - A hand-written migration adds triggers that `RAISE(ABORT)` on UPDATE and DELETE of `audit_log`.
- [x] `src/server/auth/`:
  - `auth.ts`: the Better Auth config with the Drizzle adapter (sqlite, `usePlural`), the `username()` plugin (3–30 chars, lowercase letters, digits, `.` `_` `-`), the `admin()` plugin with impersonation disabled, email/password enabled only as the credential store with the minimum password length at 10, and the `nextCookies()` plugin.
  - `hooks.after` writes the `auth.sign_in`, `auth.sign_in_failed` and `auth.sign_out` audit rows (the failed rows store the attempted username; never store the password).
  - `requireStaff()` returns `{ id, name, username, role }` or redirects to `/sign-in?next=…`.
  - `src/app/api/auth/[...all]/route.ts` is the handler.
- [x] `src/proxy.ts`: an optimistic redirect to `/sign-in?next=<path>` when there's no session cookie. Its matcher excludes `/sign-in`, `/api/auth`, `/api/health`, `_next`, static files and `/board`.
- [x] `src/app/(auth)/sign-in/page.tsx` + form (client):
  - a white card on the gray page with the OPD logo, **Username** and **Password** fields (labeled, 44 px, `autocomplete` set) and a primary **SIGN IN** button;
  - on error, "Wrong username or password" shown in an `aria-live` region, with focus on the username field;
  - after sign-in it goes to a safe `next` (a relative path only) or `/`.
  - Title: "Sign in | OPD".
- [x] `src/app/(staff)/layout.tsx`: calls `requireStaff()` and passes the user to the header. The header shows the name and Role and a **Sign out** button that signs out and returns to `/sign-in`.
- [x] `scripts/create-admin.ts` (runs with `tsx`, loads `.env`):
  - It prompts for full name, username and password (hidden, entered twice); non-interactive flags are allowed for tests.
  - It creates the user through Better Auth's server API with role `admin`, and writes one `admin.created` audit row (actor type `system`).
  - It refuses a username that already exists, and prints a success line without the password.
- [x] `src/lib/time.ts`: `opdDate(instant)` returns `YYYY-MM-DD` in Asia/Manila, plus a `formatManila(instant)` display helper.
- [x] `src/app/api/health/route.ts`: `{ ok, db: "up" | "down", time }`. Returns 200 when the DB answers `select 1`, otherwise 503, with no user or patient data.
- [x] Tests (Vitest, a temp-file SQLite migrated fresh per file), with a helper `createTestDb()`:
  - `opdDate` at 15:59:59Z vs 16:00:00Z (Manila midnight);
  - `audit_log` UPDATE and DELETE throw;
  - `withCommandTx` rolls back everything when `fn` throws, and rejects an async `fn`;
  - the env parser throws in production when values are missing.
- [x] `README.md`: setup (copy `.env.example`, then `npm run db:migrate`, then `npm run create-admin`, then `npm run dev`), plus the new scripts.

**Acceptance Criteria:**
- Given a fresh checkout with `.env` from `.env.example`, when `npm run db:migrate` and `npm run create-admin` run, then `data/dev.sqlite` exists (WAL) with an Admin, and exactly one `admin.created` audit row.
- Given a signed-out browser, when opening `/triage`, then it lands on `/sign-in?next=%2Ftriage`, and after a valid sign-in it lands on `/triage` with the header showing the Admin's name.
- Given a wrong password, when signing in, then "Wrong username or password" shows and a `auth.sign_in_failed` audit row exists. The same message shows for an unknown username.
- Given a signed-in Admin, when they choose **Sign out**, then they land on `/sign-in`, `/` redirects to sign-in again, and a `auth.sign_out` row exists.
- Given a `next=https://evil.example`, when signing in, then the user lands on `/` (no open redirect).
- Given `GET /api/health`, when the DB is reachable, then 200 with `db: "up"` and no user data. `/api/health` and `/sign-in` are reachable signed out.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- **server-only in scripts:** every `src/server/**` file imports `server-only`, which throws under plain Node. So the `db:*` and `create-admin` scripts run with `--conditions=react-server`, and Vitest aliases `server-only` to its empty module.
- **Startup env check:** `src/instrumentation.ts` + `src/server/startup.ts` enforce the env contract when `next start` runs in production.
- **`withCommandTx`:** takes an `audit()` callback and fails the command if audit is called zero times or more than once.
- **Better Auth tables:** hand-written, and checked against Better Auth's own schema: no differences. Emails are synthetic (`<username>@staff.opd.invalid`) because Better Auth requires one. Sign-up, email sign-in, password-reset and impersonation routes are disabled.
- **`create-admin`:** refuses shared-looking usernames (`admin`, `root`, `opd`, `staff` and similar). It isn't atomic: Better Auth creates the user asynchronously, and the `admin.created` audit row is written right after, in its own transaction.
- **Deferred to Story 2.3:** session `expiresIn: 900` / `updateAge: 60` and DB rate-limit storage. Until then, Better Auth's default 7-day session applies.
- **Known dev-only advisory:** `npm audit` shows 4 moderate advisories, all through `drizzle-kit` → `@esbuild-kit` → `esbuild` (dev server). It's a dev dependency and never runs in the app. The suggested "fix" is a downgrade to drizzle-kit 0.18, which is not applied.
- **Verified:** lint 0, tsc 0, 86 tests pass, build lists `/sign-in`, `/api/auth/[...all]` and `/api/health`. The implementer ran 17 Playwright checks, all passing: redirect with `next`, the generic error for a wrong password and an unknown user, sign-in, sign-out, the open-redirect guard, a fake cookie, sign-in without JS, and health. The audit rows were confirmed.
- **Leftover test data:** `data/dev.sqlite` holds the test Admin `admin1`. The user should stop their dev server and delete `data/` before real setup.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-26). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Open redirect: `next=/..//evil.example` (or `/.//`, `/%2e%2e//`) normalizes to `//evil.example`, which `safeNextPath` returns | **high** | Verified in Node: `new URL("/..//evil.example", base).pathname` is `//evil.example` | patch (re-check the normalized path; also treat `/sign-in/` and any case as sign-in) |
| 2 | `signOutAction` swallows sign-out errors in `finally`, so the cookie survives and `/sign-in` sends the user back in | medium | `actions.ts:51-56` | patch (on failure delete the session cookie, log, then redirect) |
| 3 | Sign-ins that fail validation (empty or too-long input) write no `auth.sign_in_failed` row | medium | `actions.ts:33-35` returns before Better Auth | patch |
| 4 | Sign-in via `auth.api` skips Better Auth's HTTP rate limiter | medium | Server-side `api` calls don't pass the router limiter | reject (out of scope: lockout and rate limit are Story 2.3 by frozen intent). **Note for 2.3:** the lockout must cover the server-action path |
| 5 | Session lifetime left at the 7-day default | medium | Deliberately deferred | reject (Story 2.3 by frozen intent) |
| 6 | `create-admin` creates the user, then audits in a separate transaction | low | Better Auth creates users asynchronously; an audit failure leaves an unaudited Admin | patch (delete the created user if the audit write fails, and report) |
| 7 | CLI scripts silently use development defaults (`data/dev.sqlite`) when run on a production server | medium | `tsx` doesn't set `NODE_ENV` | patch (always print the resolved mode and DB path, and refuse when `NODE_ENV=production` and `DATABASE_PATH` is unset) |
| 8 | `--password` flag exposes the password in shell history and the process list | low | README advertises it | patch (support `OPD_ADMIN_PASSWORD` env for non-interactive use; the README warns against the flag) |
| 9 | Hidden prompt: escape and arrow bytes go into the password; Ctrl+C doesn't detach; EOF is treated as Enter; non-TTY EOF hangs; pasted two-line input is lost | low | `create-admin.ts` `askHidden` / `ask` | patch (ignore control bytes except backspace, clean up on Ctrl+C and EOF, reject on input end) |
| 10 | The shared-name and username rules live only in the CLI, so a later Admin UI would bypass them | medium | Story 2.5 creates staff through the app | patch (move to `src/server/auth/staff-rules.ts` with unit tests; the CLI imports them) |
| 11 | Sign-in schema limits (64/256) differ from account limits (30/128) | low | `actions.ts:16-17` | patch (use the shared constants) |
| 12 | Sign-in audit rows lack IP and user agent | medium | PRIV-6 breach investigation | patch (store `ip` and `userAgent` in `changes` for sign-in and failed sign-in) |
| 13 | `requireStaff` accepts a user with an empty or unknown role | low | `session.ts:30` | patch (treat unknown roles as not signed in) |
| 14 | Health reports `up` for a missing or unmigrated DB (opening it creates an empty file) | low | `health/route.ts` | patch (also require the migrations table and `audit_log` to exist) |
| 15 | No test that the disabled Better Auth paths (`/sign-in/email`, `/sign-up/email`, impersonation, reset) are rejected (verification-gap) | medium | No test covers them | patch |
| 16 | No test for `signInAction` (generic error, validation failure, `next` guard) (verification-gap) | medium | — | patch |
| 17 | No test for `proxy()` and its matcher (verification-gap) | medium | — | patch; the `requireStaff`-in-layout harness is **defer** |
| 18 | No test for the `create-admin` CLI flow | low | Covered for the rules by #10; the CLI end-to-end needs a process harness | defer |
| 19 | No test for the `/api/health` 200/503 contract | low | — | defer (Story 2.8 extends health) |
| 20 | An audit failure in the after-hook shows "wrong credentials" while a session exists | low | Rare (SQLITE_BUSY after 5 s) | reject (low) |
| 21 | The Better Auth singleton keeps a closed DB handle after `closeDb()` | low | Only scripts and tests call `closeDb` | reject (low) |
| 22 | The proxy matcher skips dotted paths (e.g. `/directory/dr.cruz`) | low | Routes use UUIDs; `requireStaff` still protects | reject (low) |
| 23 | Startup doesn't check pending migrations | low | Deploy order runs `db:migrate`; health covers (#14) | reject (low) |
| 24 | `withCommandTx` async detection can be fooled by transpiled async | low | The runtime thenable check covers it | reject (low) |
| 25 | `auth.test.ts` starts with a BOM | low | Trivial | patch |

**Patches applied:** #1–3, #6–17 (proxy part) and #25.

**Re-verified:**
- Lint 0, tsc 0, 145 tests pass, build OK.
- End-to-end on a throwaway DB (`db:migrate`, `create-admin` via `OPD_ADMIN_PASSWORD`, `next start`), with Edge:
  - `/triage` redirects to `/sign-in?next=%2Ftriage`, titled "Sign in | OPD";
  - a wrong password shows "Wrong username or password";
  - sign-in lands on `/triage` with the header "Liza Test / Admin";
  - sign-out goes to `/sign-in`, and `/` stays on sign-in;
  - `next=/..//evil.example` lands on `/`;
  - health returns 200 `db: "up"`.
- Audit rows: `admin.created` (system), `auth.sign_in_failed` (username + ip + userAgent), `auth.sign_in` (ip + userAgent) and `auth.sign_out`.

**Deferred** to `deferred-work.md`: #17 (layout harness), #18, #19, and the Story 2.3 handoff for #4 and #5.

## Verification

**Commands:**
- `npm run lint`: expected 0 errors.
- `npm test`: expected all tests pass, including the new DB, audit, time and env tests.
- `npm run build`: expected success. `/sign-in`, `/api/auth/[...all]` and `/api/health` are listed.

**Manual checks:**
- With a temp `.env`: run `db:migrate` and `create-admin --username admin1 --name "Test Admin" --password …`. Then `next start`, and use Playwright/curl to check the redirect, a wrong password, a correct sign-in to `next`, sign-out, the open-redirect guard and health. Query `audit_log` for the expected rows.
