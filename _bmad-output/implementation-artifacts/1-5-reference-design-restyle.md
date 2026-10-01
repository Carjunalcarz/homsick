# Story 1.5: Restyle to Match the Reference Design

Status: done

<!-- Recorded after the fact: built on 2026-09-26 outside the BMAD workflow (user request "I want the design same looks in uploaded photo", using the ui-ux-pro-max skill), then written up here so tracking stays complete. Not run through bmad-code-review. -->

## Story

As a store manager,
I want the dashboard to look like the reference screenshot I provided (a flat admin layout with a top icon bar, a left rail, a gray page and white cards),
so that the app has the visual style I have in mind.

## Reference

The user supplied a screenshot of a SaaS billing page. Its visual traits, not its content, were adopted:

- **Top bar:** white, with the logo, a search box with a green underline, centered nav items (icon above label, active item in cyan), and the account name with "Administrator" on the right.
- **Left rail:** a narrow white column of icons with labels.
- **Page:** gray `#ECF0F3`, with a large light-weight title and an orange uppercase action button on the top right.
- **Cards:** white, subtle shadow, about 4px radius. The layout is a wide card next to a narrow card, two rows, then a full-width table card with a gray `#F7F7F7` band.
- **Accents:** a cyan highlight banner with a white "tab" on its lower edge leading into the content below, a green uppercase button, and a promo card with a green curved corner.
- **Font:** Roboto.

Scope decision (user, 2026-09-26): **restyle the existing pages only.** No billing page was added, and the content stays Acme Store.

## Acceptance Criteria

1. **Header.** Given md+ widths, the header shows the logo, a header search, Overview and Orders as icon-over-label links (the active one in the brand color with an underline bar), the theme toggle, and a "Demo Admin / Administrator" block (lg+). The sample account block is static.
2. **Left rail.** Given md+ widths, a 96px rail shows order shortcuts: All orders, Paid, Pending and Refunded, each an icon over a label linking to `/orders?status=…`. The matching shortcut is highlighted on an unfiltered `/orders` view.
3. **Header search.** Given text in the header search, pressing Enter goes to `/orders?q=<text>`. It is a `next/form`, so it also works before JavaScript loads.
4. **Mobile.** Below 768px, the top nav, rail and header search move into a ☰ sheet ("Navigation"), which closes after a link is chosen or a search is submitted.
5. **Overview layout.**
   - The page title "Overview" appears with an orange "Order history" button.
   - Row 1: a key-metrics strip (label above value, shown as a `dl`) next to a pending-orders card with a link to `/orders?status=Pending` and a decorative green corner.
   - Row 2: a revenue card (big total, a cyan banner with orders/customers and the best day, a "Daily revenue" tab, the chart) next to an "Orders by status" card with counts linking to filtered views and a green "Search orders" button.
   - Row 3: a recent-orders card with a gray band and a "View all orders" link.
   - A sample-data info note at the bottom.
6. **Orders layout.** The page title matches the Overview style. The toolbar sits on the gray band with white inputs.
7. **Contrast.** Every text color pair is at least 4.5:1 in both themes. The reference's cyan, green and orange are replaced with deeper shades of the same hues (see Dev Notes).
8. **Dark mode.** The toggle still works and uses a dark version of the same design.
9. **Responsive and touch.** At 375, 768, 1024 and 1440px there is no horizontal scroll, and every interactive target is at least 44×44px.
10. **Accessibility.** A "Skip to content" link targets `<main id="content">`. Icon-only controls have labels. Active items are marked by shape (underline bar or tint) and `aria-current`, not by color alone.

## Tasks / Subtasks

- [x] Task 1: Tokens and font (AC: 7, 8)
  - [x] 1.1 `globals.css`: replaced the light and `.dark` token values. Added `--band`, `--banner(-foreground)`, `--success(-hover/-foreground)`, `--cta(-hover/-foreground)` and `--search-accent`, and set `--radius: 0.25rem`.
  - [x] 1.2 `layout.tsx`: switched from Fira Sans / Fira Code to Roboto / Roboto Mono (variable fonts) via `next/font`.
  - [x] 1.3 `ui/card.tsx`: replaced `ring-1 ring-foreground/10` with a faint shadow and a very light ring, for the flat card look.
- [x] Task 2: Shell (AC: 1–4, 10)
  - [x] 2.1 New: `app-header.tsx`, `header-search.tsx`, `top-nav.tsx` (client), `side-rail.tsx` (client, `useSearchParams` wrapped in Suspense with a fallback that has no highlight), `mobile-menu.tsx` (client, shadcn `Sheet`), and `nav-items.ts`.
  - [x] 2.2 Rewrote `(dashboard)/layout.tsx`: skip link, sticky header, sticky rail, and `<main id="content">`.
  - [x] 2.3 Deleted the shadcn sidebar, which is replaced: `components/app-sidebar.tsx`, `components/nav-link.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`.
- [x] Task 3: Overview (AC: 5)
  - [x] 3.1 New `page-title.tsx` (`PageTitle` plus the shared `ACTION_BUTTON` classes).
  - [x] 3.2 `kpi-card.tsx`: `KpiCard` became `KpiItem` (no card, `dt`/`dd`).
  - [x] 3.3 Rebuilt `(dashboard)/page.tsx` in the reference layout. It now also calls `getOrders()` for the status counts.
  - [x] 3.4 Rebuilt `(dashboard)/loading.tsx` to match.
- [x] Task 4: Orders (AC: 6)
  - [x] 4.1 `orders/page.tsx` uses `PageTitle`, the card header, and the gray band around the toolbar. `orders/loading.tsx` matches.
  - [x] 4.2 `orders-toolbar.tsx`: added `bg-card` to the inputs and select triggers.
- [x] Task 5: Updated the README project structure and design note.

## Dev Notes

### Colors (measured)

Colors were sampled from the screenshot; the reference's own action colors fail contrast with white text.

| Role | Reference | Contrast with white | Used (light) | Contrast | Used (dark) |
|---|---|---|---|---|---|
| Brand / banner | `#00BCD2` | 2.3:1 | `#00798C` primary, `#00838F` banner | 5.1:1, 4.5:1 | `#4DD0E1` with dark text |
| Green button | `#5ABD62` | 2.4:1 | `#2E7D32` | 5.1:1 | `#81C784` with dark text |
| Orange button | `#E56208` | 3.5:1 | `#C2410C` | 5.2:1 | `#FB8C3C` with dark text |
| Page / band / card | `#ECF0F3` / `#F7F7F7` / `#FFF` | — | same | — | `#111820` / `#1F2933` / `#1A232D` |
| Text / muted | — | — | `#333A40` / `#5B6770` (5.1:1 on page) | — | `#E6EBEF` / `#9AA8B4` |

### Decisions

- **The two navigation areas hold different links.** The app has only two pages, so repeating them in both the top bar and the rail would give duplicate navigation. Pages go in the top bar; order-status shortcuts go in the rail.
- **Omitted:** the notification bell, the mail badge and the floating help button, because those features don't exist and dead controls are misleading. The sample account block has no dropdown chevron, since there's no menu.
- **ui-ux-pro-max `--design-system`** returned "Flat Design", which matches the reference. Its purple palette and Fira typography were overridden by the reference colors and Roboto, at the user's request.

### Supersedes (from story 1.2)

- The shadcn `Sidebar` layout, the header title approach, the Fira fonts and the slate/blue tokens.
- The story 1.2 review-log items #1 (sidebar trigger) and #18 (sheet title) no longer apply; their files were deleted. The mobile sheet is now titled "Navigation" / "Main site navigation." in `mobile-menu.tsx`.

### Known issues

- **Toolbar state (bug):** clicking a left-rail shortcut while on `/orders` updates the URL and the table, but the Status select in the toolbar keeps showing its old value. This is because the toolbar state from story 1.4 is only set on mount. It needs a fix: sync the toolbar state from props when they change.
- **Rail height in full-page screenshots:** the rail is sticky with a height of `100dvh - 72px`. In full-page screenshots it looks shorter than the page, but in the browser it stays in view while scrolling.
- **No automated tests.** See `deferred-work.md`.

### References

- User-provided reference screenshot (2026-09-26 session).
- [Source: .claude/skills/ui-ux-pro-max/SKILL.md] pre-delivery checklist, contrast and touch rules; design system "Flat Design"
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/02-components/form.md] `next/form`
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md] Suspense around `useSearchParams`
- [Source: _bmad-output/implementation-artifacts/1-2-example-dashboard.md] layout this story replaces
- [Source: _bmad-output/implementation-artifacts/1-4-orders-search-filters-pagination.md] orders page restyled here

## Dev Agent Record

### Agent Model Used

claude-opus-5-5 (main session, outside the BMAD workflow)

### Debug Log References

- The first build failed with "Parsing CSS source code failed" at `globals.css:2:1`. The cause was a UTF-8 BOM written by PowerShell `Set-Content -Encoding utf8`; stripping it fixed the build.
- The chart looked cut off in screenshots taken right at network idle. That was Recharts' mount animation; a screenshot 2.5s later shows the full series.

### Completion Notes List

- `npm run lint` and `npm run build` pass (`/` static, `/orders` dynamic).
- Playwright with Edge against the production build:
  - light at 1440, 1024, 768 and 375px, and dark at 1440 and 375px;
  - on `/`, `/orders` and `/orders?status=Pending`: no horizontal scroll and no targets under 44px (after widening the logo link to 44px at md);
  - correct `aria-current` in the top nav, rail and pagination;
  - the header search takes you to `?q=liam` with 5 rows;
  - the mobile sheet closes after choosing Pending;
  - no console errors.
- Screenshots were compared visually against the reference.

### File List

- **Modified:**
  - `src/app/globals.css`
  - `src/app/layout.tsx`
  - `src/app/(dashboard)/layout.tsx`
  - `src/app/(dashboard)/page.tsx`
  - `src/app/(dashboard)/loading.tsx`
  - `src/app/(dashboard)/orders/page.tsx`
  - `src/app/(dashboard)/orders/loading.tsx`
  - `src/components/kpi-card.tsx`
  - `src/components/orders-toolbar.tsx`
  - `src/components/ui/card.tsx`
  - `README.md`
- **New:**
  - `src/components/app-header.tsx`
  - `src/components/header-search.tsx`
  - `src/components/top-nav.tsx`
  - `src/components/side-rail.tsx`
  - `src/components/mobile-menu.tsx`
  - `src/components/nav-items.ts`
  - `src/components/page-title.tsx`
- **Deleted:**
  - `src/components/app-sidebar.tsx`
  - `src/components/nav-link.tsx`
  - `src/components/ui/sidebar.tsx`
  - `src/hooks/use-mobile.ts`
