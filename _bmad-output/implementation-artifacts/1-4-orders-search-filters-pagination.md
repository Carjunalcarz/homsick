# Story 1.4: Orders Search, Filters and Pagination

Status: done

<!-- Recorded after the fact: built on 2026-09-26 outside the BMAD workflow (user request "must have table with search, pagination and filters", using the ui-ux-pro-max skill), then written up here so tracking stays complete. Not run through bmad-code-review. -->

## Story

As a store manager,
I want to search, filter and page through orders on the Orders page,
so that I can find a specific order or a group of orders without scrolling through everything.

## Acceptance Criteria

1. **Search.** Given `/orders`, when the user types in Search, then after a 300ms pause the table shows only orders whose number (with or without `#`) or customer name contains the text, case-insensitive. Focus stays in the box, and Esc clears it.
2. **Status filter.** Given the Status select, when the user picks Paid, Pending or Refunded, then only orders with that status are shown. "All statuses" removes the filter.
3. **Date filter.** Given the Date select, when the user picks "Last 7 days" or "Last 14 days", then only orders on or after that many days back from `SAMPLE_TODAY` (2026-09-25) are shown.
4. **Combined.** Search, status and date apply together, and any change returns to page 1.
5. **Pagination.** Given more than 10 matches, then 10 rows show per page. There are Previous/Next links, page numbers (first, last, current ±1, with gaps shown as …) and `aria-current="page"` on the current page. Below 640px, "Page x of y" replaces the numbers. Previous and Next are disabled at the ends.
6. **Results count.** A live status line reads "Showing 11–20 of 60 orders", "Showing 1 matching order", or "No matching orders".
7. **Empty state.** Given no matches, a message names the search term, suggests an order number or customer name to try, and offers "Clear filters". No empty table is shown.
8. **Clear filters.** Given any active filter, a "Clear filters" button resets search, status and date and returns to `/orders`.
9. **Shareable URLs.** State lives in the URL (`?q=&status=&period=&page=`), with defaults omitted. Reloading or sharing a URL shows the same view.
10. **Bad input.** Unknown `status` or `period` values fall back to "all". A non-integer or non-positive `page` becomes 1, and a page past the end is clamped to the last page. `q` is trimmed and limited to 100 characters. None of these cause an error.
11. **Server-side.** Filtering runs on the server. Sample order data is not included in the client JavaScript bundle.
12. **Accessibility and touch.** Inputs have labels. Every control is at least 44×44px with a visible focus ring. There is no horizontal page scroll at 375px, and the table scrolls inside its own focusable region.

## Tasks / Subtasks

- [x] Task 1: Sample data and query (AC: 1–5, 10, 11)
  - [x] 1.1 Expanded `ORDERS` in `src/lib/data.ts` from 20 to 60. The original 20 are kept first and unchanged as `RECENT_ORDERS`, so the overview's 5 most recent orders didn't change. #1041–#1002 are generated deterministically from fixed lists.
  - [x] 1.2 Added `SAMPLE_TODAY`, `ORDER_STATUSES`, `ORDER_PERIODS`, and the types `OrderPeriod`, `OrderQuery` and `OrderPage`.
  - [x] 1.3 Added `queryOrders(query)`: filter, then count, then clamp the page, then slice.
- [x] Task 2: URL handling (AC: 9, 10)
  - [x] 2.1 `src/lib/orders-query.ts`: `parseOrderSearchParams()` (whitelists values, falls back to defaults) and `ORDERS_PAGE_SIZE = 10`.
  - [x] 2.2 `src/lib/orders-href.ts`: `ordersHref()`, which omits default values. It is a separate file so client components can import it without pulling in the sample data (AC 11).
- [x] Task 3: Toolbar (AC: 1–4, 8, 12)
  - [x] 3.1 `src/components/orders-toolbar.tsx` (client): the search input with a 300ms debounce, the shadcn `Select`s for status and date, and "Clear filters". Filter changes call `router.replace` inside `startTransition`; a spinner shows while pending and `aria-busy` is set.
- [x] Task 4: Pagination (AC: 5)
  - [x] 4.1 `src/components/orders-pagination.tsx` (server): builds `next/link` hrefs through `ordersHref`.
- [x] Task 5: Page (AC: 6, 7, 9)
  - [x] 5.1 `src/app/(dashboard)/orders/page.tsx` awaits `searchParams` (a Promise in Next 16), then parses and queries. It renders the count line, the toolbar, the table or empty state, and the pagination.
  - [x] 5.2 Updated `orders/loading.tsx` to include the toolbar and pagination skeletons.
- [x] Task 6: `npx shadcn@4.21.0 add select`, which creates `src/components/ui/select.tsx`. No new npm packages.
- [x] Task 7: Updated the README pages table and added a note on the URL parameters.

## Dev Notes

### Decisions

- **Server-side URL state instead of shadcn DataTable (TanStack Table).** The ui-ux-pro-max shadcn guidance suggests DataTable, which filters on the client. `nextjs-best-practices` says to fetch and filter on the server. URL state also gives shareable views and maps directly onto a database query later, and it needs no extra dependency. As a result, `/orders` is now dynamic (`ƒ`) in the build output; it was static before.
- **The toolbar does not use `useSearchParams`.** The page passes the current values in as props. That avoids the Next 16 requirement to wrap `useSearchParams` in a Suspense boundary on this route. The toolbar keeps its own state, initialized from those props.
- **Date filter is relative to `SAMPLE_TODAY`, not the real date,** so the fixed sample data keeps producing results.
- **Page copy:** the card title went from "Latest orders" back to "All orders", because the page now shows all 60 sample orders. The Orders KPI (1,284) stays fictional monthly volume.

### Known limitations

- **Toolbar state vs. outside URL changes:** the toolbar's state is set only when it first mounts. If the URL changes from somewhere else while `/orders` is open (browser back/forward, or a left-rail shortcut added in story 1.5), the selects and search box can show stale values until the next remount. Fix: sync state from props when they change, or key the toolbar on status and period.
- **No sorting controls.** Orders are always newest first.
- **No automated tests.** Covered by the testing entry in `deferred-work.md`.

### Project Structure Notes

- The query and URL helpers live in `src/lib/`. `data.ts` stays the single data seam; replace the body of `queryOrders()` to connect a database.
- `orders-href.ts` must not import runtime values from `data.ts`, or the sample data ends up in the client bundle.

### References

- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md#searchParams] `searchParams` is a Promise
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md] Suspense requirement avoided
- [Source: .claude/skills/ui-ux-pro-max ux-guidelines "No Results", "Table Handling"; stacks/shadcn "Select", "Table"]
- [Source: .claude/skills/nextjs-best-practices/SKILL.md#9. Anti-Patterns] fetch on the server
- [Source: _bmad-output/implementation-artifacts/1-2-example-dashboard.md] base Orders page and `OrdersTable`

## Dev Agent Record

### Agent Model Used

claude-opus-5-5 (main session, outside the BMAD workflow)

### Debug Log References

- The first build showed all expected routes. After it, the plural wording "1 of 1 matching orders" was fixed to "Showing 1 matching order".

### Completion Notes List

- Verified with `npm run lint` and `npm run build` (0 errors), plus Playwright with Edge against the production build:
  - initial 1–10 of 60;
  - Next goes to `?page=2`, which is marked current;
  - search "ava" updates the URL to `?q=ava` and focus stays in the box;
  - adding status Paid combines with the search;
  - "zzzz" shows the empty state;
  - Clear filters resets to `/orders`;
  - "Last 7 days" shows 14 matches;
  - `?page=99&status=bogus` clamps to 51–60;
  - at 375px in light and dark there is no horizontal scroll and every target is at least 44px;
  - no console errors.
- Checked that `.next/static` contains no sample customer names.

### File List

- `src/lib/data.ts` (modified)
- `src/lib/orders-query.ts` (new)
- `src/lib/orders-href.ts` (new)
- `src/components/orders-toolbar.tsx` (new)
- `src/components/orders-pagination.tsx` (new)
- `src/components/ui/select.tsx` (new, shadcn)
- `src/app/(dashboard)/orders/page.tsx` (modified)
- `src/app/(dashboard)/orders/loading.tsx` (modified)
- `README.md` (modified)
