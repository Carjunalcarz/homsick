---
title: 'Story 2.3: Idle sign-out and account lockout'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-3-idle-sign-out-and-account-lockout'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-first-admin-signs-in.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sessions last Better Auth's default 7 days, and a password can be guessed without limit, including through the server-action sign-in path, which skips Better Auth's HTTP rate limiter. On shared OPD counter PCs, that exposes patient data.

**Approach:** Enforce a 15-minute idle timeout: sessions expire after 900 s, and background polling never extends them. A dialog warns 60 s before expiry, and a sign-in dialog over the page brings the user back without losing work. Lock an account after 5 consecutive failed sign-ins, and add a per-IP sign-in rate limit that covers the server-action path. This follows epics.md Story 2.3, AD-9, UX-DR10 and the Story 2.2 handoff in `deferred-work.md`.

## Boundaries & Constraints

**Always:**
- **Session config:** `expiresIn: 900`, `updateAge: 60`, no `cookieCache`.
- **Polling:** reads with `disableRefresh: true` and never extends a session.
- **Lockout:** only through `failed_attempts`/`locked_at` columns on `users`. It is not `banned`, which means deactivated.
- **Audit:** every lock and every unlock writes exactly one audit row.
- **Message:** a locked account's sign-in shows "Account locked after 5 failed attempts. Ask an Admin to unlock it." Every other failure keeps the generic "Wrong username or password".
- **Accessibility:** dialogs follow WCAG 2.2.1 and 2.1.1: announced, focus trapped, and Esc does not dismiss the expiry dialog.

**Never:**
- No staff-management UI. The Admin unlock button is Story 2.5; this story provides only a recovery CLI.
- No global activity pinging when nobody is using the page.
- No storing passwords or partial passwords in the audit log or the counters.
- No change to the wording of the generic error.

</frozen-after-approval>

## Code Map

- `src/server/auth/auth.ts`:
  - The Better Auth config and the `hooks.after`. Today the hook audits `/sign-in/username` success and failure and `/sign-out`; `auditFailedSignIn(username, headers)` is exported and `requestContext()` gives ip and userAgent.
  - Add the session options, and `rateLimit` with database storage (model `rateLimit`, plural `rate_limits`) and a custom rule for `/sign-in/username`.
- `src/server/auth/actions.ts`:
  - `signInAction` calls `getAuth().api.signInUsername`. That skips the HTTP rate limiter, so the per-IP limit must also be enforced here, before calling Better Auth.
  - The validation-failure path already audits.
- `src/server/auth/session.ts`: `getStaff` / `requireStaff`. Add a polling-safe variant, `getStaffNoRefresh()`, that passes `query: { disableRefresh: true }`.
- `src/server/auth/schema.ts`:
  - `users` gains `failed_attempts integer not null default 0` and `locked_at text` (UTC ISO).
  - New `rate_limits` table matching Better Auth's `rateLimit` model: `id`, `key`, `count`, `last_request`.
  - Generate a new drizzle migration with `db:generate`.
- `src/server/audit/schema.ts`: add the `AuditAction` values `auth.locked` and `auth.unlocked`.
- `src/app/(staff)/layout.tsx`: mounts the new client `SessionGuard` (passing the user id and name) next to `AppHeader`.
- `src/components/ui/`: no dialog exists yet. Add `alert-dialog` and `dialog` via `npx shadcn@4.21.0 add alert-dialog dialog` (reusing the pinned radix-ui).
- `src/app/(auth)/sign-in/sign-in-form.tsx`: the existing form. Reuse it (or its field logic) inside the re-auth dialog.

## Tasks & Acceptance

**Execution:**
- [x] `schema.ts` + migration: add `failed_attempts` and `locked_at` to `users`, and the `rate_limits` table. The migration must apply cleanly on top of `0001`.
- [x] `src/server/auth/lockout.ts` (server-only, synchronous repo helpers on `tx`, run through `withCommandTx`):
  - `isLocked(username)`;
  - `recordFailure(username)`: increments; at 5, sets `locked_at` and writes `auth.locked`. An unknown username is a no-op, so no counter row exists for it;
  - `resetFailures(userId)` on success, with no audit row;
  - `unlock(userId, actor)`: clears both fields and writes `auth.unlocked`.
  - Unit tests: the 5th failure locks and audits once, and further failures neither re-lock nor re-audit. Success resets. Unknown users are not counted. A locked user with the correct password is still refused.
- [x] `auth.ts`:
  - Session `expiresIn: 900` and `updateAge: 60`. Outside production only, the env `OPD_SESSION_SECONDS` can shorten the session for manual testing, and `OPD_WARN_SECONDS` sets the warning lead time (default 60), passed to `SessionGuard`. Both are ignored in production.
  - `rateLimit: { enabled: true, storage: "database", customRules: { "/sign-in/username": { window: 60, max: 10 } } }`.
  - A `hooks.before` on `/sign-in/username` rejects a locked account with a `LOCKED` error code before the password is checked.
  - `hooks.after`: a failure calls `recordFailure`, a success calls `resetFailures`.
- [x] `actions.ts` (`signInAction`):
  - Before Better Auth, apply a per-IP limit of 10 attempts per 60 s. Keep it in `rate_limits` under a key prefixed `action:sign-in:` + ip, in its own tiny transaction.
  - Over the limit, return "Too many sign-in attempts. Wait a minute and try again." Audit it as `auth.sign_in_failed` with `reason: "rate_limited"`.
  - A `LOCKED` error returns the locked message (UX-DR18). Every other failure keeps the generic message.
- [x] `session.ts`: add `getStaffNoRefresh()`, and add `src/app/api/auth-status/route.ts`, which returns `{ signedIn, userId, expiresAt }` using `disableRefresh` (the only poll endpoint for `SessionGuard`).
- [x] `src/server/auth/actions.ts` `keepAliveAction()`: refreshes the session (a normal `getSession`) and returns the new `expiresAt`. Rate-limited to at most once per 60 s client-side.
- [x] `src/components/session-guard.tsx` (client):
  - **Activity:** tracks real activity (keydown, pointerdown, wheel, visible focus); background polls and timers don't count. While active, it calls `keepAliveAction` at most once per 60 s.
  - **Warning:** it polls `/api/auth-status` every 30 s. At 60 s before `expiresAt`, it opens an AlertDialog: "You'll be signed out in 60 seconds." with **Stay signed in** focused and a live countdown in an `aria-live` region. **Stay signed in** calls `keepAliveAction`.
  - **Expired:** the page content stays mounted and a sign-in Dialog opens over it: "Signed out after 15 minutes of inactivity. Sign in to continue." It uses the sign-in fields.
    - If the same user (matching `userId`) signs in, the dialog closes and the page state stays.
    - If a different user signs in, `window.location.reload()` loads a fresh page.
  - Esc does not close the expiry dialogs. Honors reduced motion.
- [x] `scripts/unlock-user.ts` + the `npm run unlock-user -- --username x` script: the recovery path for a locked sole Admin. It prints the mode and DB path (reuse `load-env`), calls `unlock` with actor `system`, and exits non-zero for an unknown username.
- [x] Tests:
  - lockout unit tests;
  - `actions.test.ts`: a locked account returns the locked message; the 11th attempt from one IP within 60 s returns the rate-limit message and is audited;
  - `SessionGuard` timing logic, extracted as a pure function (`nextGuardState(now, expiresAt, lastActivity, lastKeepAlive)`), with unit tests at the boundaries: 61 s, 60 s and 0 s left, and activity throttling.
- [x] `README.md`: document the 15-minute idle rule, the lockout, `unlock-user`, and that the Admin unlock UI comes in Story 2.5.

**Acceptance Criteria:**
- Given a signed-in user idle for 14 minutes, when the warning opens, then **Stay signed in** has focus, the countdown is announced, and pressing it keeps the session (a new `expiresAt` 15 minutes ahead).
- Given no activity for 15 minutes, when the session expires, then the sign-in dialog shows over the unchanged page; signing in as the same user closes it with the form input intact; a different user gets a reloaded page.
- Given the page polls `/api/auth-status` repeatedly with no user activity, when 15 minutes pass, then the session still expires (polling never refreshes it).
- Given 5 wrong passwords for `liza.test`, when the 5th is submitted, then the account locks (one `auth.locked` row) and every later attempt, including the correct password, shows the locked message.
- Given `npm run unlock-user -- --username liza.test`, when it runs, then the correct password signs in again and one `auth.unlocked` row exists.
- Given 11 sign-in attempts from one IP within 60 s through the sign-in page, when the 11th is submitted, then it returns the rate-limit message without checking the password.
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- **Lock audit:** the 5th failure writes `auth.sign_in_failed` (the command's row) and `auth.locked` (via `record(tx)`) in one transaction; actor `system`/`lockout`. A refused locked sign-in is audited as `auth.sign_in_failed` with `reason: "locked"` from `hooks.before` (the after-hook doesn't run when before throws) and is not counted again. `unlock()` on an account with nothing to clear returns `not_locked` and writes nothing.
- **Re-auth:** `reauthAction` shares the sign-in core with `signInAction` (rate limit → validation → Better Auth) but returns the user id instead of redirecting. `SignInFields` is shared by the page and the dialog.
- **Fixes found in the browser:**
  - `src/proxy.ts` now lets Server Action POSTs (`next-action` header) through without a cookie; otherwise the re-auth action on an expired page was 307-redirected to `/sign-in`.
  - `getStaff()` / `getStaffNoRefresh()` build the cookie header from `cookies()`, so the page re-render after the re-auth action sees the new session instead of redirecting (which lost the page state).
  - The guard compares against the user id captured at mount: the refreshed layout passes the new user's id before the reload decision.
  - `/api/auth-status` is excluded from the proxy so it answers `{ signedIn: false }` as JSON.
- **Timings:** `updateAge` = min(60, (expiresIn − warn)/2), i.e. 60 in production, 30 with the 90/30 test overrides (so activity can refresh before the warning). The client keeps alive at most once per `updateAge`. The status response also carries the server `now` for clock-skew correction.
- **Rate-limit IP:** the action path keys on the same IP as the audit (`requestContext`: rightmost `x-forwarded-for`, then `x-real-ip`); without an IP it keys on the attempted username (`action:sign-in:user:<name>`). The limit is checked before the attempt and only failures are counted. Better Auth's HTTP limiter uses its own `getIP`.
- **Review fixes (pass 1):** `keepAliveAction` pre-checks the session row directly (Better Auth's getSession deletes the cookie of a missing session even with `disableRefresh`); `unlock()` returns `"reset"` without an audit row for an unlocked account with failures; the expired dialog has an opaque overlay and the shell is `inert`/`aria-hidden`; a keep-alive that didn't move `expiresAt` leaves the activity pending; **Stay signed in** reports network errors; dialog texts follow the configured timings; `scroll` counts as activity; invalid overrides warn once.
- **Verified:** lint 0, tsc 0, 184 tests, build lists `/api/auth-status`. Edge/Playwright on a throwaway DB (`next start`, `OPD_SESSION_SECONDS=90`, `OPD_WARN_SECONDS=30`): lock after 5, locked message with the right password, `unlock-user` then sign-in, unknown username exits 1, 11th attempt rate-limited; warning at 30 s with focus on **Stay signed in**, live region, Esc ignored, Stay extends to a full lifetime; idle expiry with polls running; re-auth dialog over the page, same user keeps the header search text, different user reloads; continuous key activity keeps the session alive past its lifetime. Audit rows confirmed (`auth.locked` ×1, `auth.unlocked` ×1, `reason: locked`, `reason: rate_limited`).

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Per-IP limit keys on the client-supplied leftmost `X-Forwarded-For`, so rotating it bypasses the limit; with no header, everyone shares an `unknown` bucket | medium | `requestContext()` takes the first XFF entry; `sign-in-limit.ts` uses `unknown` | patch (use the rightmost XFF entry appended by the trusted proxy, then `x-real-ip`; with no IP, key on the attempted username instead of a global bucket; README states the reverse proxy must set XFF) |
| 2 | The limit counts successful sign-ins, so staff behind one address can block each other at shift change | medium | `consumeSignInAttempt` runs before the credentials check | patch (check before, count only failed attempts) |
| 3 | Patient data stays readable behind the expired-session dialog (`bg-black/10` overlay) | medium | Shared `DialogOverlay`; the idle timeout exists to hide the page | patch (opaque `bg-background` overlay for the expired dialog and hide the page content from screen readers while expired; keep it mounted so state survives) |
| 4 | Lockout lets anyone lock any account, and the locked message reveals that the username exists | medium | By design: PRD FR1 ("until an Admin unlocks"), and the frozen intent sets the locked message | reject (accepted design; flagged to the user) |
| 5 | `applySession` can reach `expired` without opening the re-auth dialog | medium | `recompute` sets the phase but not `markExpired` | patch |
| 6 | After same-user re-auth, a stale `expiresAtRef` can re-trigger expiry | medium | `onSignedInAgain` keeps the old value | patch (clear it before polling) |
| 7 | `keepAliveAction` with a missing DB session deletes the cookie, the re-render redirects, and the page is lost instead of the dialog | medium | Better Auth clears the cookie for an invalid session inside a Server Action | patch (read with `disableRefresh` first; if null, return `signedIn:false` without touching cookies; only then refresh) |
| 8 | Activity consumed by a keep-alive that didn't extend the session ends it up to 60 s early | medium | Only sessions older than `updateAge` are refreshed | patch (advance `lastKeepAlive` only when `expiresAt` moved; otherwise retry) |
| 9 | **Stay signed in** fails silently on a network error or while a keep-alive is in flight | low | No catch or feedback | patch (await the in-flight call; on error show "Couldn't reach the server. Try again." with retry) |
| 10 | `unlock` audits an account that was never locked (1–4 failures) | low | `lockout.ts` "not_locked" only when both are clear | patch (a failures-only case resets quietly, returns `"reset"`, and the CLI says so) |
| 11 | Dialog text is fixed ("60 seconds", "15 minutes") when timings are overridden | low | Test overrides | patch (use real values) |
| 12 | The new env overrides aren't documented; invalid values are ignored silently | low | README env table | patch (document them; warn on invalid values) |
| 13 | `keepAliveAction` has no staff-role check | low | Differs from `getStaffNoRefresh` | patch |
| 14 | `scroll` isn't counted as activity; the migration has no trailing newline | low | README says scrolling counts | patch |
| 15 | The proxy lets any cookieless Server Action POST through | low | Every action and page checks the session itself (AD-3/AD-4); the proxy is optimistic only | reject (comment already documents it) |
| 16 | Concurrent unlock can double-audit; a correct password racing the 5th failure | low | Rare races within IMMEDIATE transactions | reject (low) |
| 17 | `rate_limits` rows are never cleaned up | low | Growth is bounded by attempts | defer (Story 2.8 jobs) |
| 18 | No test that the app poll route and `getStaffNoRefresh` never extend a session (verification-gap) | medium | The only test calls Better Auth directly | patch |
| 19 | No test for `getStaff()` building the cookie header from `cookies()` (verification-gap) | medium | — | patch |
| 20 | `keepAliveAction` is tested only signed out (verification-gap) | medium | — | patch |
| 21 | No component tests for `SessionGuard` (verification-gap) | medium | No DOM test setup; the pure rules are covered | defer |
| 22 | `unlock-user` CLI untested (verification-gap) | low | Same convention as `create-admin`; `unlock()` is covered | defer |

**Patches applied:** #1–3, #5–14, #18–20. For #7, the pre-check reads the session row directly: Better Auth deletes the cookie of a missing session even with `disableRefresh`.

**Re-verified:**
- Lint 0, tsc 0, 196 tests pass, build OK.
- Browser run on a production server with the real 900 s / 60 s timings, with the warning and expiry triggered by editing the session row. 14/14 checks passed:
  - the session lasts 900 s;
  - the warning shows a seconds countdown with focus on **Stay signed in**, and Esc is ignored;
  - **Stay signed in** restores 900 s;
  - expiry shows the re-auth dialog with "15 minutes" over an opaque overlay (`rgb(236,240,243)`), and the shell is `inert` + `aria-hidden` but still mounted;
  - the same user keeps typed text without a redirect;
  - a different user reloads, sees their own header, and the typed text is gone.

**Deferred** to `deferred-work.md`: #17, #21, #22.

## Verification

**Commands:**
- `npm run lint`: expected 0 errors.
- `npm test`: expected all tests pass, including the lockout, rate-limit and guard-timing tests.
- `npm run build`: expected success, with `/api/auth-status` listed.

**Manual checks:**
- On a throwaway DB with Edge via Playwright:
  - lock after 5 failures, and see the locked message with the right password;
  - run `unlock-user`, then sign in;
  - hit the rate limit on the 11th attempt.
- For the idle flow, temporarily shorten the timings through the test-only env overrides `OPD_SESSION_SECONDS=90` and `OPD_WARN_SECONDS=30`. They are honored only when `NODE_ENV` is not production.
  - The warning appears, **Stay signed in** extends the session, and expiry opens the re-auth dialog.
  - Same-user sign-in keeps typed text in the header search. A different user reloads the page.
