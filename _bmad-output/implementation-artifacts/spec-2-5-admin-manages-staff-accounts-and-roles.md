---
title: 'Story 2.5: Admin manages staff accounts and roles'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-5-admin-manages-staff-accounts-and-roles'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-admin-configures-opd-facilities.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The only way to create an account is the `create-admin` CLI, and a locked account can only be unlocked from a shell. Admins can't give nurses and Facility staff their own accounts, set their Role and Facilities, or deactivate someone who leaves. Every nav item shows to everyone.

**Approach:** Add an Admin-only `/admin/staff` page built on the story 1.4 list pattern (search, Role and status filters, pagination) with these actions: create account, edit name/Role/Facilities, unlock, deactivate and reactivate. Every action is audited. Store Facility assignments, feed them into `requireStaff()` and the permission scope, extend the permission map (with tests of each Role against every action), and hide nav items a Role can't use. This follows epics.md Story 2.5, FR2, FR3, NFR14, AD-4 and AD-9.

## Boundaries & Constraints

**Always:**
- **Commands:** Server Actions run Zod, then `requireStaff()`, then `can()`, then one command with one audit row. Better Auth's admin API writes the user fields it owns. When a Better Auth call and the app's own writes can't share one transaction, write the audit row immediately after and compensate if it fails, as `create-admin` does.
- **Account rules:** Usernames, names and passwords follow `staff-rules.ts` (no shared names such as `admin`). The temporary password is at least 10 characters and is never logged or audited.
- **Facility Staff** must have at least one active Facility. Triage Nurses and Admins have none.
- **Deactivate** means Better Auth `banned` plus revoking every session for that user. It is not the lockout. Deactivated users keep their name on past audit rows.
- **Guard rails:** An Admin can't deactivate or demote themself, and the last active Admin can't be deactivated or demoted.
- **Hiding nav items** is cosmetic only. Pages and actions still check `can()`.

**Never:**
- No hard delete.
- No self-service sign-up.
- No email.
- No password-reset flow for users. An Admin sets a new temporary password instead.
- No impersonation.
- No left rail, which comes in Story 4.1.
- No new settings types.

</frozen-after-approval>

## Code Map

- `src/server/auth/permissions.ts`: `PERMISSIONS` has `settings.view` and `settings.facilities.manage` (Admin only). `ruleAllows()` already supports `scope: "facility"` against `user.facilityIds`. `requirePermission(action)` returns `{ allowed, user }`.
- `src/server/auth/session.ts`: `getStaff` / `requireStaff` returns `{ id, name, username, role }`. Extend it with `facilityIds: string[]` (active Facilities only) from the new join table, still cached per request.
- `src/server/auth/auth.ts`: Better Auth `admin()` plugin with custom `ac`/`roles`. The server API has `createUser`, `setRole`, `banUser`, `unbanUser`, `revokeUserSessions` and `setUserPassword`. The emails are synthetic (`<username>@staff.opd.invalid`).
- `src/server/auth/lockout.ts`: `unlock(userId, actor)` returns `"unlocked" | "reset" | "not_locked"`.
- `src/server/auth/staff-rules.ts`: `validateFullName`, `validateUsername`, `validatePassword`, `SHARED_USERNAMES`, `STAFF_ROLES` and `isStaffRole`.
- `scripts/create-admin.ts`: the create-then-audit-then-compensate pattern to reuse.
- `src/server/settings/queries.ts`: `listFacilities()` (the active flag included) for the Facility checkboxes. Read it only through `settings` queries.
- `src/components/data-table/*` and `src/lib/url-query.ts`: the list pattern (toolbar, pagination, empty state, `parseListParams`, `buildListHref`). This is its first real user.
- `src/app/(staff)/admin/settings/`: the Sheet form, confirm dialog and forbidden patterns to copy.
- `src/components/nav-items.ts`, `top-nav.tsx`, `mobile-menu.tsx`, `app-header.tsx`, `admin-link.tsx`: nav items have no permission yet. The Admin link is Admin-only.
- `deferred-work.md` asks for a DataTableToolbar component test (jsdom + React Testing Library) when the first list page uses it. That is this story.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/auth/schema.ts` + migration `0005`: add a `user_facilities (user_id → users, facility_id → facilities, PRIMARY KEY both)` table, owned by `auth`.
- [x] `src/server/auth/permissions.ts`: add these actions, with a scope for each, mirroring the PRD FR2 matrix:

  | Action | Roles |
  |---|---|
  | `staff.view`, `staff.manage` | Admin |
  | `nav.triage` | Triage Nurse, Admin |
  | `nav.queues` | Facility Staff, Admin |
  | `nav.patients`, `nav.appointments`, `nav.directory`, `nav.overview` | all |

  Unit-test each Role against every action, plus the deny default and the Facility scope using real `facilityIds`.
- [x] `src/server/auth/session.ts`: `StaffUser.facilityIds`, then tests.
- [x] `src/server/auth/staff-*.ts`:
  - **queries:** `listStaff({ q, role, status, page, pageSize })`, where status is active, locked or deactivated. `q` matches name or username, case-insensitive. Results are sorted by name, with a total count.
  - **service commands**, each audited:
    - `createStaff`: `staff.created`, which records the name, username, Role and Facilities, never the password.
    - `updateStaff`: name, Role and Facilities, audited as `staff.updated` with old and new values.
    - `setTemporaryPassword`: `staff.password_set`, with no password in the audit row.
    - `deactivateStaff`: `staff.deactivated`. It bans the user and revokes all their sessions.
    - `reactivateStaff`: `staff.reactivated`.
    - Unlock reuses `lockout.unlock`, audited as `auth.unlocked`.
  - **Errors** use the `DomainError` codes `username_taken`, `last_admin`, `self_action`, `facilities_required` and `facilities_not_allowed`.
- [x] `src/app/(staff)/admin/staff/page.tsx` + client parts, titled "Staff | OPD" (Forbidden for non-Admins):
  - **Page:** a page title with a **NEW STAFF ACCOUNT** CTA. The `DataTableToolbar` has search "Name or username", a Role filter (All / Admin / Triage Nurse / Facility Staff) and a status filter (All / Active / Locked / Deactivated), plus a live result count, a table, pagination and an empty state.
  - **Table columns:** name, username (mono), a Role badge with text, Facilities (prefix chips with `sr-only` names), a status badge with text, and a "⋯" row menu with 44 px items.
  - **Row menu:** Edit, Set temporary password, Unlock (only when locked or with failures), and Deactivate / Reactivate (a confirm dialog that names the person).
  - **Sheets:** Create and Edit use a Sheet form. The Role is a radio group, and Facilities are checkboxes shown only for Facility Staff. The password field in Create and Set password has a show/hide toggle.
  - **Form behavior:** field errors with focus on the first error, form-level errors in a live region, pending state that blocks dismissal, and focus returned to the triggering control.
- [x] Navigation:
  - Each nav item gets an `action`. `top-nav.tsx` and `mobile-menu.tsx` show only the items `can()` allows.
  - The header Admin area links to both `/admin/settings` and `/admin/staff`, as a small menu or two links with accessible names containing the visible text.
- [x] Tests:
  - service tests on a fresh DB per test: create (every Role rule), duplicate and shared username, the Facility rules, update with old and new audit values, self and last-Admin guards, deactivate (the user can't sign in and existing sessions are revoked), reactivate, unlock, and set password (the new password works, the old one doesn't, no password in the audit row);
  - `listStaff` filters and paging;
  - a denied non-Admin action changes nothing and writes no audit row;
  - `page.test.ts` for the Forbidden branch;
  - **deferred item:** add `jsdom@30.1.1`, `@testing-library/react@16.3.3` and `@testing-library/user-event@14.6.7` (exact, dev) with per-file `// @vitest-environment jsdom`. `DataTableToolbar` tests cover: typing with fake timers pushes once after the debounce; a rerender with the new `q` prop keeps the typing; a filter change or Clear pushes the trimmed `q` with page 1; an outside URL change syncs.
- [x] `README.md`: staff management, Roles and Facility rules, deactivation vs lockout.

**Acceptance Criteria:**
- Given the Admin on `/admin/staff`, when they create "Joy Santos" / `joy.santos` / Facility Staff / Prenatal and Animal Bite Center with a temporary password, then Joy appears in the list with both Facility chips, one `staff.created` row exists (without the password), and Joy can sign in.
- Given Joy is signed in, when she opens `/admin/settings` or `/admin/staff`, then she sees the no-access page, and her top nav shows Overview, Queues, Patients, Appointments and Directory but not Triage.
- Given Joy is locked after 5 failures, when the Admin chooses **Unlock**, then Joy can sign in, and one `auth.unlocked` row exists.
- Given the Admin deactivates Joy while she is signed in, when Joy's next request arrives, then she is signed out, she can't sign in again, and her past audit rows still show "Joy Santos".
- Given the only active Admin, when they try to demote or deactivate themself, then the action is refused with a clear message and nothing changes.
- Given Facility Staff with no Facility, or a Triage Nurse with Facilities, when saved, then a field error explains the rule.
- Given the list, when filtered by Role and status and searched by partial name, then results and the count match, and the URL holds the state (back/forward works).
- Given `npm run lint`, `npm test` and `npm run build`, when run, then all pass.

## Implementation Notes

- All Execution tasks are implemented (checkboxes left for the review step to tick).
- Better Auth admin calls (`createUser`, `adminUpdateUser` for name + Role in one call, `setUserPassword`, `banUser` + `revokeUserSessions`, `unbanUser`) run with the acting Admin's request headers (`sessionHeaders()`, now exported from `session.ts`), so Better Auth's own access control also applies. The audit row (and the `user_facilities` writes) follow in one `withCommandTx`; on failure the Better Auth change is compensated (delete the created account, restore name/Role, restore the old password hash, unban/re-ban). Guard rails and the Facility rule are re-checked inside that transaction.
- Extra `DomainError` codes: `staff_not_found` and `facility_unavailable` (a deactivated or unknown Facility newly assigned). A deactivated Facility already assigned may stay; Facility Staff still need at least one active one. Reactivating Facility Staff with no active Facility is refused with `facilities_required`.
- Audit `staff.created` / `staff.updated` store Facilities as `[{ id, name }]`. Unlock of an account with failures but no lock resets the count without an audit row (existing `lockout.unlock` behaviour from Story 2.3).
- Status: deactivated = `banned`; locked = not banned and `locked_at` set; active otherwise. List page size is fixed at 25.
- Nav: `AppHeader` (server) computes the allowed hrefs with `can()` and passes them to `TopNav`, `MobileMenu` and `AdminLinks` (two links, "Admin: Staff" and "Admin: OPD Settings").
- The toolbar uses `router.push` for select changes and Clear (history entries), `router.replace` for debounced typing.
- Review fixes: a new temporary password also clears the lockout and revokes sessions (`lockCleared`, `sessionsRevoked` in the audit row); reactivation clears a leftover lock (`lockCleared`); the session revoke on deactivation is inside the compensated section; `unicode_lower()` SQL function for search; username edge rules (`.`/`_`/`-` at the ends, `..`) plus Better Auth `INVALID_EMAIL` → `username_invalid`; unexpected action errors return `code: "failed"`; `facilityIds` is only computed for Facility Staff; nav filtering lives in `components/nav-permissions.ts` with tests.
- `toolbar.test.tsx` shims `globalThis.jest.advanceTimersByTime` so Testing Library's async wrapper advances Vitest's fake timers.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-27). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | `deactivateStaff`: `revokeUserSessions` runs outside the compensated section, so a failure leaves the account banned with no audit row | medium | patch |
| 2 | Deactivate rollback restores the ban flag but not revoked sessions | low | reject (the safe direction; README states it) |
| 3 | Set temporary password leaves the lockout and other sessions in place | medium | patch (clear the lock and failure count, and revoke the user's sessions, all noted in the one audit row) |
| 4 | Reactivating an account that is still locked says "can sign in again", but the lock still blocks it; Unlock is hidden for deactivated rows | medium | patch (reactivate also clears a leftover lock, recorded in the same audit row) |
| 5 | Search is ASCII-only case-insensitive (SQLite `lower`), so "peña" misses "PEÑA" | medium | patch (a Unicode-aware comparison, e.g. a registered `unicode_lower` function) |
| 6 | Facility Staff can end up with no active Facility (pre-migration accounts, or a deactivated Facility) with no sign in the UI | low | patch (show a "No active Facility" warning badge on the row) |
| 7 | UI offers self-deactivate and self-demote, which the server always refuses | low | patch (hide or disable with an explanation) |
| 8 | Usernames with leading, trailing or consecutive dots pass the rules but make an invalid email, giving a generic error | medium | patch (tighten `validateUsername`; map any `INVALID_EMAIL` to the username field) |
| 9 | Unexpected server errors show as "Couldn't reach the server"; domain errors skip `revalidatePath` | low | patch |
| 10 | `ConfirmActiveDialog` reopens with an old error or notice; `changed:false` leaves it open with an active button | low | patch |
| 11 | Error focus hits the first radio instead of the checked one, and a disabled checkbox | low | patch |
| 12 | The focusable table region has no overflow; constants and types are duplicated; mobile label "Settings" vs "OPD Settings"; README "every command writes one audit row" overstated | low | patch |
| 13 | Every request runs a Facility lookup even for Roles without Facilities | low | patch (only for `facility_staff`) |
| 14 | Filter selects use `router.replace`, so back/forward can't step through filter changes | low | patch (`push` for select and Clear, `replace` for debounced typing) |
| 15 | Concurrent edits by two Admins; a race on reactivating with the last Facility; the last-Admin count includes locked Admins | low | reject (rare; CLI unlock exists) |
| 16 | Nav filtering per Role untested (verification-gap) | medium | patch (a pure `allowedNav(user)` helper plus tests for each Role) |
| 17 | `reactivateStaff` compensation untested (verification-gap) | medium | patch |
| 18 | `getStaff()` non-empty `facilityIds` untested (verification-gap) | low | defer (no Facility-scoped action until Epic 4) |

Patches applied: #1, #3–14, #16, #17. Rejected: #2, #15. Deferred: #18 (logged in `deferred-work.md`).
Re-verified 2026-09-27 after patches: `npm run lint` 0 problems, `npx tsc --noEmit` 0 errors, `npm test` 354 tests pass (26 files), `npm run build` OK (lists `/admin/staff`). The browser e2e ran before the patches; the patched behavior is covered by the unit and component tests.

## Verification

**Commands:**
- `npm run lint`, `npm test` and `npm run build`: expected all pass, with `/admin/staff` listed.

**Manual checks:**
- On a throwaway DB with `next start` and Edge via Playwright, walk the acceptance criteria end to end, including a second browser context for Joy (sign-out on deactivation, and nav items per Role).
- Check the list at 375 px: no page-level horizontal scroll, and the table scrolls in its own region.
- Check the audit rows in the DB.
