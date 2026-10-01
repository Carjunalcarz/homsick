# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-dashboard-foundation.md`
  summary: Dashboard shell ((dashboard) route group, sidebar/header, loading/error/not-found) with shadcn/ui, light/dark theme toggle via next-themes, generic sample KPI cards and table.
  evidence: User chose to build the narrower story 1-1-initialize-nextjs-application first; its constraints forbid extra pages and dependencies.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-dashboard-foundation.md`
  summary: Zod-validated `GET /api/stats` route handler with Vitest tests.
  evidence: Out of scope for story 1-1 (no business logic, no extra dependencies).
- source_spec: `_bmad-output/implementation-artifacts/1-2-example-dashboard.md`
  summary: Add automated checks in the repo for the dashboard's behavior (theme toggle and persistence, system default, nav `aria-current` per route, 5/20 table rows, mobile sheet closing, `formatChange` sign/unit output), e.g. a Playwright `test:e2e` script plus unit tests once Vitest arrives in story 1-3.
  evidence: Review pass 1 (verification-gap layer): `package.json` has no test runner and the repo has no test files; the only behavioral check was a one-off Playwright script in the session scratchpad, so regressions like dropping `attribute="class"` or the `href === "/"` special case would pass lint and build.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-hospital-app-shell-replaces-the-store.md`
  summary: Add a component test for `DataTableToolbar`. It should cover typing plus the debounce, a rerender with the new `q` prop that keeps the typing, filter change and Clear pushing a trimmed `q` with page 1, and back/forward sync. This needs a jsdom + React Testing Library setup.
  evidence: Review pass 1 (verification-gap), which pre-verified it. Only the pure `toolbar-state` helpers are tested, so dropping the `syncedQ` update in `pushSearch` would pass `npm test` while bringing the mid-typing overwrite bug back. Do this when the first list page (Story 2.5 staff list) adopts the toolbar.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-first-admin-signs-in.md`
  summary: Add a request-time test harness for `requireStaff()` inside the `(staff)` layout (redirect built from `x-opd-path`), an end-to-end test of the `create-admin` CLI (process-level), and a `/api/health` 200/503 contract test.
  evidence: Review pass 1 (verification-gap). The rules and proxy are unit-tested, but these three paths are only covered by manual Playwright checks. Extend health tests when Story 2.8 adds backup and job status.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-first-admin-signs-in.md`
  summary: Handoff to Story 2.3. The lockout counter and rate limiting must also cover the server-action sign-in path (`signInAction` calls `auth.api.signInUsername`, which bypasses Better Auth's HTTP rate limiter). Also set the session `expiresIn: 900` / `updateAge: 60`.
  evidence: Review pass 1 (blind-hunter, edge-case-hunter). Server-side `auth.api` calls skip the router rate limiter; Story 2.3 owns lockout and rate limiting by frozen intent.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-idle-sign-out-and-account-lockout.md`
  summary: Add a job (Story 2.8 scheduler) that deletes `rate_limits` rows whose `last_request` is older than the longest rate-limit window.
  evidence: Review pass 1 (blind-hunter). Neither Better Auth nor the action-path limiter ever removes expired rows.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-idle-sign-out-and-account-lockout.md`
  summary: Add DOM component tests for `SessionGuard` and a process-level test for `scripts/unlock-user.ts`. The `SessionGuard` tests should cover: a different user re-authenticating reloads the page (`pageUserIdRef`); activity during the warning is ignored; the expired dialog opens only after a confirming poll. This needs jsdom and React Testing Library, shared with the Story 2.1 toolbar item.
  evidence: Review pass 1 (verification-gap). Only the pure timing rules in `src/lib/session-guard.ts` are unit-tested.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-admin-manages-staff-accounts-and-roles.md`
  summary: When the first Facility-scoped action lands (Epic 4 queues), add a test that `getStaff()` / `requireStaff()` return a Facility Staff user's active assigned Facilities, and that a Facility-scoped `can()` call from a page or action allows only those Facilities.
  evidence: Review pass 1 (verification-gap). Only `getStaffNoRefresh` is tested with non-empty `facilityIds`; nothing observes it today because no action is Facility-scoped yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-admin-manages-staff-accounts-and-roles.md`
  summary: Progress note. The `DataTableToolbar` component test deferred from Story 2.1 is done in 2.5 (jsdom + Testing Library now set up). The `SessionGuard` DOM tests deferred from Story 2.3 remain open and can now reuse this setup.
  evidence: Story 2.5 implementation.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-admin-reviews-the-audit-log.md`
  summary: If a `loading.js`, Partial Prefetching or Cache Components is ever added, make every link to `/admin/audit` (header, mobile menu, pagination, Clear) use `prefetch={false}`, or record the view outside the render, and add a jsdom test that the header and menu links render with `prefetch={false}`.
  evidence: Rendering `/admin/audit` writes an `audit.viewed` row. Today the dynamic route isn't prefetched (no `loading.js`; see `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`), so no extra rows are written, but those config changes would make prefetches log views.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-find-patients.md`
  summary: When Story 3.4 replaces the selected-patient card with the triage form, add a jsdom test that picking a patient in the finder fills the form. Add an `AppHeader` render test that it mounts `SearchShortcut` and that the real header search and finder inputs carry the ids Ctrl+K looks for.
  evidence: Today the finder test mocks `onSelect`, and `search-shortcut.test.tsx` renders its own inputs, so breaking the wiring wouldn't fail a test (verification-gap review of 3.1).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-register-a-new-patient.md`
  summary: Fix the header top nav overlapping other header items at 768 px (tablet width). Found in the 3.2 browser check; it isn't caused by 3.2.
  evidence: The implementation agent's 768 px screenshot showed the nav items overlapping. The Definition of Done requires 768 px support. Fix it in the next story that touches the header (Epic 4 left rail / nav) or as a small standalone fix.- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-record-triage-for-a-visit.md`
  summary: Progress note. The Story 3.1 item is done in 3.4: `triage-form.test.tsx` picks a patient in the real finder and checks the form fills for them, and `src/components/app-header.test.tsx` renders `AppHeader` and checks Ctrl+K reaches the real header search and the real finder input.
  evidence: Story 3.4 implementation.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-record-triage-for-a-visit.md`
  summary: Add a Possible-match test (registration or edit) where the matched patient has a recorded Visit, and assert `lastVisit` equals that Visit's `opdDate`.
  evidence: `selectPossibleMatches` now reads last visits through `withLastVisits`, but every Possible-match fixture has no Visits, so reverting it wouldn't fail a test (verification-gap review of 3.4).