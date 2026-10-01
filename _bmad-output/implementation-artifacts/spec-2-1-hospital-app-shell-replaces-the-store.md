---
title: 'Story 2.1: Hospital app shell replaces the store'
type: 'refactor'
created: '2026-09-26'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
story_key: '2-1-hospital-app-shell-replaces-the-store'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-Dashboard-2026-09-26/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app is still the "Acme Store" demo (store Overview and Orders pages, store sample data). It must become the Hospital OPD app shell before any hospital feature can be built. It also lacks the hospital design tokens, and it has a known toolbar-sync bug in the table pattern.

**Approach:** Remove all store pages, data and components. Keep the story 1.4 URL-driven table pattern as generic `data-table` pieces with the sync bug fixed. Rename the route group to `(staff)` with hospital nav placeholders, and add the DESIGN.md tokens and typography utilities. This follows epics.md Story 2.1.

## Boundaries & Constraints

**Always:**
- Keep the story 1.5 shell look: header, top nav icon over label, sheet menu on mobile, light and dark themes, and the skip link.
- Placeholder pages use `PageTitle` and set the metadata title to "{Surface} | OPD".
- The generic table pieces are behavior-compatible with story 1.4 (URL state, 300 ms debounce, page reset on filter change) and carry no store types.
- Lint, build and tests must pass.

**Never:**
- No database, auth or new domain features; those belong to Stories 2.2+.
- No hard-coded Facility list anywhere (AD-8). The left rail is removed until Facilities exist (Story 4.1 adds Facility tiles).
- No new UI kit components beyond what exists.
- Don't touch `_bmad*` folders.

</frozen-after-approval>

## Code Map

- `src/app/(dashboard)/**`: store Overview, Orders and loadings. Remove, then recreate as `src/app/(staff)/` with `layout.tsx` (shell), `page.tsx` (Overview placeholder) and placeholders for `triage`, `queues`, `patients`, `appointments`, `directory`.
- `src/lib/data.ts`, `src/lib/orders-query.ts`, `src/lib/orders-href.ts`: store data and the orders URL helpers. Delete them once the generic helpers exist.
- `src/components/orders-toolbar.tsx`, `orders-pagination.tsx`, `orders-table.tsx`: the story 1.4 pattern. Generalize the toolbar and pagination into `src/components/data-table/`. Delete `orders-table`, because its row shape is store-specific.
- `src/components/kpi-card.tsx`, `revenue-chart.tsx`, `ui/chart.tsx`: store-only. Delete them and remove the now-unused `recharts` dependency.
- `src/components/nav-items.ts`: `MAIN_NAV` (Overview, Orders) and `RAIL_NAV` (order statuses, imports `OrderStatus`). Rewrite with the six hospital pages and drop `RAIL_NAV`.
- `src/components/side-rail.tsx`: order-status rail. Delete it, and remove the `<aside>` from the layout.
- `src/components/mobile-menu.tsx`: uses `SideRailLinks`. Drop the "Order shortcuts" section.
- `src/components/app-header.tsx`, `header-search.tsx`: the header search submits to `/orders`. Point it to `/patients?q=` (placeholder page for now) and relabel it "Search patients".
- `src/components/top-nav.tsx`, `page-title.tsx`, `theme-*`: reuse unchanged except the nav items.
- `src/app/globals.css`: add the DESIGN.md tokens. Light: `urgent`, `priority`, `routine`, `abnormal`. Dark: the `-dark` counterparts. Also the `board-*` set and `board-called-foreground`, all mapped in `@theme inline`. Existing tokens already match DESIGN.md.
- The known 1.5 bug (story 1.5 notes): the toolbar keeps `useState` initialized from props, so outside URL changes leave it stale.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/url-query.ts`: generic helpers `parseListParams(searchParams, schema)` (whitelisted enums, trimmed `q` up to 100 chars, positive-int `page`, defaults) and `buildListHref(basePath, values, defaults)` (omits defaults). Unit tests cover default omission, bad values and page clamping input.
- [x] `src/components/data-table/{toolbar.tsx,pagination.tsx,empty-state.tsx}`:
  - The toolbar is configurable (search label, placeholder and select filters from props) and builds URLs through `buildListHref`.
  - **Sync fix:** state re-syncs when props change from an outside navigation, using the "adjust state during render" pattern with the previous props. The debounced search must not clobber in-progress typing.
  - Pagination and empty state are generalized from story 1.4.
- [x] Remove the store files listed in the Code Map and the `recharts` dependency. `npm ls` must show no missing imports.
- [x] `src/app/(staff)/layout.tsx` plus six placeholder pages (Overview at `/`, `/triage`, `/queues`, `/patients`, `/appointments`, `/directory`), each with `PageTitle`, one line saying what arrives in a later story, and metadata `title` `"{Surface}"` (the root template becomes `"%s | OPD"`; default `"OPD"`).
- [x] `nav-items.ts`, `top-nav.tsx`, `mobile-menu.tsx`, `app-header.tsx`, `header-search.tsx`: the hospital nav (icons: LayoutDashboard, Stethoscope, ListOrdered, Users, CalendarDays, BookUser), no rail, and search pointed at `/patients`.
- [x] `src/app/layout.tsx`: the title template `"%s | OPD"` and the description "Hospital OPD Management System".
- [x] `src/app/globals.css`: the DESIGN.md semantic and board tokens (light and dark) in `@theme`, plus utilities `.text-queue-number`, `.text-queue-number-issued`, `.text-board-now-serving`, `.text-board-next`, `.text-board-facility` (Roboto Mono or Roboto sizes per DESIGN.md).
- [x] Tests: add `vitest@5.0.2` and `vite-tsconfig-paths` as dev dependencies, bump `@types/node` to `^24`, and add `vitest.config.mts` (node env, `@/*` paths) and an `npm test` script. Tests for `url-query.ts` and for the toolbar sync logic (a pure function extracted for it).
- [x] `README.md`: rewrite for the Hospital OPD Management System (setup, scripts, structure), removing all store content.

**Acceptance Criteria:**
- Given the built app, when visiting `/`, `/triage`, `/queues`, `/patients`, `/appointments` and `/directory`, then each returns 200 with its title "{Surface} | OPD", and `/orders` returns 404.
- Given the codebase, when searching `src/` for `Acme`, `orders-`, `queryOrders` or `RevenuePoint`, then there are no matches.
- Given a data-table toolbar on a page, when the URL's query changes by browser back/forward, then the search box and selects show the URL's values.
- Given dark mode, when viewing a filled primary, success or CTA button, then its text uses the dark foreground token.
- Given `npm run lint`, `npm run build` and `npm test`, when run, then all pass.

## Implementation Notes

- **Store files moved, not deleted:** deletion was blocked with no version control, so the removed store files were moved to `D:\Developer\Dashboard-story-2-1-removed\`, outside the project. That folder can be deleted once this story is accepted.
- **Header layout:** to fit the six nav items, the header search shows from `lg` (it's in the menu sheet below `md`), and the demo account block shows from `xl`. Browser-verified at 375, 768, 1024 and 1440 px in light mode, and at 1440 px in dark mode: no header overflow, no horizontal scroll, all targets at least 44 px, correct `aria-current`.
- **Toolbar sync fix:** implemented as pure `toolbar-state.ts` logic (adjusting state during render, with protection for the toolbar's own debounced push). Covered by unit tests; no page uses it yet, so it gets its browser check in Story 2.5.
- **Tests:** `vitest` 5.0.2 and `vite-tsconfig-paths`, with `@types/node` bumped to ^24. 37 tests pass. Lint and build pass, and `/orders` returns 404.
- **Leftovers:** the unused `--chart-*` tokens remain in `globals.css`, and "Demo Admin" remains in the header until Story 2.2.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-26). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diffed against a file snapshot.

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | No search at 768–1023 px: the header search is `lg:block`, and the menu sheet (which has search) is `md:hidden` | medium | `app-header.tsx` and `mobile-menu.tsx:30`. Counter tablets sit in that range | patch (menu trigger visible below `lg`) |
| 2 | Header search sends `?q=` to a Patients placeholder that ignores it | low | The placeholder is intended by the spec; Story 3.1 implements search | reject (low, by design) |
| 3 | `header-search.tsx` hard-codes `maxLength={100}` instead of `MAX_QUERY_LENGTH` | low | `header-search.tsx:41`; a direct correction | patch |
| 4 | Pagination doesn't clamp `page` (shows "Page 99 of 5"); `clampPage` is unused | low | `pagination.tsx` renders the raw `page`; a direct correction | patch |
| 5 | NaN or fractional `pageCount` | low | No caller yet; the guard adds a branch | reject (low) |
| 6 | The list pattern lost the live result-count region | low | Later list stories carry UX-DR19/UX-DR21 "live result count" ACs | reject (covered by later stories) |
| 7 | Reserved filter names `q`/`page` are not enforced | low | No consumer; the guard adds complexity | reject (low) |
| 8 | `pageItems` is untested (verification-gap, pre-verified) | medium | No test imports it | patch (add `pagination.test.ts`) |
| 9 | The Vitest include glob skips `*.test.tsx` | low | `vitest.config.mts:8`; a direct correction | patch |
| 10 | The README list-page example uses a route that doesn't exist | low | `/admin/staff` isn't built yet | patch (wording) |
| 11 | Leftover `--chart-*` tokens after removing Recharts | low | `globals.css:178-308`; a direct deletion (`positive`/`negative`/`warning` stay: DESIGN.md uses them) | patch |
| 12 | `vite-tsconfig-paths` uses a caret range, not an exact pin | low | `package.json:32`; the project pins exactly (story 1.2 review) | patch |
| 13 | A second debounced push can land after an older own-push URL arrives, so the stale URL overwrites typing | medium | `syncToolbarState` tracks only the last `syncedQ`; with a server render over 300 ms, the older `q` arrives with `ownPush=false` | patch (remember recent own pushes) |
| 14 | `normalizeQuery` can leave a trailing space after slicing to 100 characters | low | Real for 100+ char input; a direct correction (`.trim()` after slicing) | patch |
| 15 | `global-error.tsx` title still ends "\| Dashboard" | low | `global-error.tsx:23`; a direct correction | patch |
| 16 | `DataTableToolbar`'s wiring of `syncedQ` has no component test (verification-gap) | medium | Needs jsdom/RTL; no page uses the toolbar yet | defer |
| 17 | Escape in `type=search` double-clears | low | Harmless; both clear to "" | reject (low) |
| 18 | Back-navigating to the same `q` keeps unsent typing | low | Edge of an edge; the typing is the user's newest intent | reject (low) |
| 19 | `buildListHref` key order depends on the caller | low | No second caller yet; sorting adds logic | reject (low) |
| 20 | Board type sizes are fixed px; board colors are repeated in both themes; Node engines; class order; no `test:watch` | low / false | TV sizes are by design (DESIGN.md); the rest is cosmetic | reject |
| 21 | Removed `loading.tsx` skeletons | low | Placeholders fetch nothing; later stories add loading states | reject (low) |

Patches #1, #3, #4, #8–#15 were applied. Re-verified: lint 0 errors, tsc 0 errors, 46 tests pass, build OK, `/orders` returns 404. In the browser, the menu (with search) is reachable at 768 and 900 px, the header search shows at 1024 px, and the header doesn't overflow. #16 is deferred to `deferred-work.md`.

## Verification

**Commands:**
- `npm run lint`: expected 0 errors.
- `npm test`: expected all tests pass.
- `npm run build`: expected success. The route list shows `/`, `/triage`, `/queues`, `/patients`, `/appointments`, `/directory`, and no `/orders`.

**Manual checks:**
- `next start` on port 3100, then curl each route for 200 and its `<title>`. `/orders` must return 404.
