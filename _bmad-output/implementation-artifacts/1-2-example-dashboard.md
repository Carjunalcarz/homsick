---
title: 'Example Dashboard'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: 'NO_VCS'
story_key: '1-2-example-dashboard'
depends_on: '1-1-initialize-nextjs-application'
---

# Story 1.2: Example Dashboard

## User Story

As a user,
I want an example dashboard with a sidebar, KPI cards, a trend chart and a recent-orders table,
so that the app shows what a finished dashboard looks like and gives later stories a working layout to build on.

## Goal

Replace the welcome page with a working example dashboard for a fictional online store, "Acme Store". It uses placeholder data from one server-side module, so real data sources can be swapped in later without touching the UI.

## Decisions (already made by the user)

- **UI kit:** shadcn/ui.
- **Content:** generic example with sample data (not a specific business domain).
- **Theme:** light and dark with a toggle button, via `next-themes`. Defaults to the system setting and remembers the choice.
- **Design system:** keep the ui-ux-pro-max tokens and Fira fonts from story 1.1 (see Dev Notes).

## Scope

### Layout

```text
┌─────────────┬──────────────────────────────────────────┐
│ Acme Store  │ Overview                  [theme toggle]  │
│             ├──────────────────────────────────────────┤
│ ▸ Overview  │ [Revenue] [Orders] [Customers] [Conv. %]  │
│   Orders    │                                          │
│             │ Revenue, last 30 days (area chart)       │
│             │                                          │
│             │ Recent orders (table, 5 rows) · View all │
└─────────────┴──────────────────────────────────────────┘
```

- Sidebar collapses to a menu button on small screens (shadcn `sidebar` does this).

### Pages

| Route | Content |
|---|---|
| `/` (Overview) | 4 KPI cards, revenue area chart, 5 most recent orders, "View all orders" link |
| `/orders` | Full sample orders table (about 20 rows) |

Both pages have `loading.tsx` (skeletons shaped like the real content) and use the existing `error.tsx` / `not-found.tsx`.

### Sample data

| KPI | Example value | Change vs previous 30 days |
|---|---|---|
| Revenue | $48,250 | +12.4% |
| Orders | 1,284 | +8.1% |
| Customers | 932 | +3.6% |
| Conversion rate | 3.2% | −0.4 pts |

- Revenue series: 30 daily points.
- Orders: id (`#1042`), customer name, date, status (`Paid`, `Pending`, `Refunded`), amount.
- All values are clearly fictional.

## Technical Requirements

### Dependencies

Install only these, pinning the versions npm resolves at implementation time (verified 2026-09-26):

| Package | Version | Why |
|---|---|---|
| shadcn (CLI, run via `npx`, not installed) | 4.21.0 | Copies components into `src/components/ui/` |
| next-themes | 0.4.6 | Theme toggle without a flash on reload |
| recharts | 3.10.1 | Used by the shadcn `chart` component |
| lucide-react | 1.48.0 | Icons (installed by shadcn; no emoji icons) |

shadcn components to add: `sidebar`, `card`, `table`, `badge`, `button`, `chart`, `skeleton`, `separator`, `tooltip`.

### Architecture

- **Server Components by default.** Only these are client components: theme provider, theme toggle, the chart wrapper (Recharts needs the browser), active-link highlighting in the sidebar, and the components shadcn itself marks `'use client'`.
- **Data:** `src/lib/data.ts` exports typed async functions (`getKpis()`, `getRevenueSeries()`, `getRecentOrders(limit)`, `getOrders()`). Pages call them directly on the server. No `fetch` from client components.
- **Routing:** a `(dashboard)` route group with its own `layout.tsx` (sidebar + header). Move the overview to `src/app/(dashboard)/page.tsx` and delete `src/app/page.tsx` (both would map to `/`).
- **Metadata:** each page sets `title` (`Overview`, `Orders`) so the layout template renders "Overview | Dashboard".

### File structure

```text
src/
├── app/
│   ├── layout.tsx              UPDATE: wrap in ThemeProvider, suppressHydrationWarning on <html>
│   ├── globals.css             UPDATE: merge shadcn tokens with existing tokens (see Dev Notes)
│   ├── page.tsx                DELETE (moved)
│   └── (dashboard)/
│       ├── layout.tsx          NEW: SidebarProvider, AppSidebar, header with title + ThemeToggle
│       ├── page.tsx            NEW: overview
│       ├── loading.tsx         NEW
│       └── orders/
│           ├── page.tsx        NEW
│           └── loading.tsx     NEW
├── components/
│   ├── ui/                     NEW: shadcn components
│   ├── app-sidebar.tsx         NEW
│   ├── nav-link.tsx            NEW (client: active state via usePathname)
│   ├── theme-provider.tsx      NEW (client)
│   ├── theme-toggle.tsx        NEW (client)
│   ├── kpi-card.tsx            NEW
│   ├── revenue-chart.tsx       NEW (client)
│   └── orders-table.tsx        NEW
└── lib/
    ├── data.ts                 NEW
    └── utils.ts                NEW (shadcn `cn` helper)
```

## UX and Accessibility Requirements

From the ui-ux-pro-max checklist:

- Text contrast is at least 4.5:1 in both themes (reuse the existing tokens; do not introduce `#F97316` or white on `#3B82F6`, which fail).
- KPI change indicators use an icon (arrow up or down) and a sign, not color alone.
- The chart has an accessible name, and the orders table is its text alternative.
- The theme toggle and the mobile sidebar button are icon-only, so each has an `aria-label`.
- Every clickable element has `cursor-pointer`, a visible `focus-visible` ring and a hit area of at least 44×44px.
- Hover effects change only color or background, with no scaling that shifts the layout.
- There is no horizontal page scroll at 375px. The orders table scrolls inside its own container.
- The global `prefers-reduced-motion` rule from story 1.1 stays in place.

## Acceptance Criteria

### AC1 — Overview renders

**Given** the app is running,
**When** the user opens `/`,
**Then** the sidebar, header, 4 KPI cards, revenue chart and 5 recent orders render with sample data, and the page title is "Overview | Dashboard".

### AC2 — Orders page

**Given** the overview page,
**When** the user clicks "Orders" in the sidebar or "View all orders",
**Then** `/orders` shows the full table, and "Orders" is highlighted as the active link.

### AC3 — Theme toggle

**Given** the dashboard in either theme,
**When** the user clicks the theme toggle and reloads the page,
**Then** the chosen theme persists with no flash of the other theme.

### AC4 — System default

**Given** no stored theme choice,
**When** the page loads,
**Then** the theme follows the operating system setting.

### AC5 — Responsive

**Given** a 375px-wide viewport,
**When** the user opens either page,
**Then** the sidebar is hidden behind a menu button, KPI cards stack, and the page has no horizontal scroll.

### AC6 — Loading states

**Given** a slow data response (simulate with a temporary delay in `data.ts`, then remove it),
**When** a dashboard page loads,
**Then** skeletons shaped like the content appear first.

### AC7 — Server by default

**Given** the finished code,
**When** searching for `'use client'`,
**Then** it appears only in the components listed under Architecture and in shadcn's own components.

### AC8 — Quality checks

**Given** the finished code,
**When** running `npm run lint` and `npm run build`,
**Then** both succeed with no errors, and the build lists `/` and `/orders`.

## Developer Tasks

- [x] Run `npx shadcn@4.21.0 init` (Next.js, Tailwind 4, `src/`, alias `@/*`). Then merge `globals.css` as described in Dev Notes.
- [x] Add the shadcn components listed above.
- [x] Install `next-themes`. Add the theme provider and toggle, and update the root layout.
- [x] Create `src/lib/data.ts` with typed sample data.
- [x] Create the `(dashboard)` layout, sidebar and nav link.
- [x] Build the overview page, KPI card, revenue chart and orders table.
- [x] Build the orders page.
- [x] Add a `loading.tsx` for each page.
- [x] Delete `src/app/page.tsx`.
- [x] Verify all ACs, including both themes and the 375px, 768px, 1024px and 1440px widths.
- [x] Update the README with the new structure and dependencies.

## Dev Notes

- **Read before coding:** `AGENTS.md` says this Next.js version differs from older ones, so check `node_modules/next/dist/docs/` for any API you use. Known differences:
  - Error boundaries receive `retry`, not `reset`.
  - `fetch` is not cached by default.
  - `LayoutProps` / `PageProps` are global generated types.
- **`globals.css` merge (important):**
  - Story 1.1 switches themes with `@media (prefers-color-scheme: dark)`. `next-themes` needs a class instead, so move the dark values under `.dark` and let `next-themes` apply the class.
  - `shadcn init` writes its own token names (`--background`, `--foreground`, `--primary`, `--muted-foreground`, `--card`, `--border`, `--ring`, `--chart-1..5`, and sidebar tokens) in `oklch`.
  - Map the story 1.1 colors onto shadcn's token names, so the design stays the same and shadcn components pick it up. `--muted` in 1.1 is a text color, which is shadcn's `--muted-foreground`. Then update the classes in `page`, `not-found` and `error` to match (for example, `text-muted` becomes `text-muted-foreground`).
  - Keep the `prefers-reduced-motion` rule, the `--font-sans` / `--font-mono` mapping to the Fira fonts, and chart colors that meet 3:1 against the card background.
- **`global-error.tsx`:** leave it as is. It renders outside the root layout, so the theme class never reaches it.
- **Dependency on story 1.1:** 1.1 still needs `git init` (Git is not installed). Do that first, so this story's changes can be reviewed as a diff.
- **Covers deferred work:** this story covers the first entry in `deferred-work.md` (dashboard shell, shadcn, theme, sample KPIs and table). The `/api/stats` route and its tests stay deferred for a later story.

## Definition of Done

- [x] All acceptance criteria pass.
- [x] Lint and build pass.
- [x] Checked in both themes and at 375px, 768px, 1024px and 1440px.
- [x] No emoji icons, and contrast is at least 4.5:1 for text.
- [x] README updated.

## Constraints

Do not:

- Add authentication, a database, or real data sources.
- Add pages beyond `/` and `/orders`.
- Add dependencies beyond those listed.
- Fetch data in client components.
- Change `global-error.tsx`.

## Implementation Notes

- **shadcn init:** run as `npx shadcn@4.21.0 init -t next -b radix -p nova --pointer` (style `radix-nova`). Init swapped in the Geist font and imported `shadcn/tailwind.css`, which required the `shadcn` package as a runtime dependency. Both were reverted: Fira fonts are kept, `shadcn` is uninstalled, and the custom variants the components use (`data-open`, `data-active`, and so on, plus `no-scrollbar`) are copied into `globals.css`.
- **Extra packages:** shadcn components need `radix-ui`, `class-variance-authority`, `cn` (shadcn's clsx + tailwind-merge replacement) and `tw-animate-css`. They are installed as part of "UI kit: shadcn/ui"; nothing else was added. `next-themes`, `recharts` and `lucide-react` are pinned exactly.
- **Tokens:** the story 1.1 hex colors are kept (not converted to oklch) and mapped onto shadcn names; dark values moved to `.dark`. `--surface` became `--card`. New tokens: `--positive`, `--negative`, `--warning` (KPI changes and order status), all 4.5:1 or better on the card.
- **`use-mobile.ts`:** rewritten with `useSyncExternalStore` because the shadcn version calls `setState` inside an effect, which fails the `react-hooks/set-state-in-effect` lint rule.
- **Header title:** a server layout cannot know the current route, and a client title component is not in the allowed `'use client'` list. The page title is therefore the page's own `<h1>` at the top of the content; the header holds the mobile menu button (with the store name on small screens) and the theme toggle.
- **Git:** still not installed, so `git init` from story 1.1 was not done and there is no baseline diff.
- **Verification:** `npm run lint` and `npm run build` pass (build lists `/`, `/orders`). A Playwright script (in the session scratchpad, not the project) checked both themes at 375/768/1024/1440px: no horizontal scroll, sidebar hidden behind the menu button below 768px, KPI cards stacked at 375px, 5/20 table rows, chart rendered, titles, active link, all links/buttons at least 44×44px, toggle persists across reload with the `dark` class present before hydration, system default followed, mobile sheet closes after navigating. AC6 was checked with a temporary 3s delay in `data.ts` (skeletons shown on hard load and client navigation), then the delay was removed.

## Review Triage Log

Review pass 1 (2026-09-26). Layers: blind-hunter, edge-case-hunter, verification-gap. No VCS: diff taken against a file snapshot made before implementation.

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Ctrl/Cmd+B collapses the desktop sidebar with no visible way to reopen it (`SidebarTrigger` is `md:hidden`, no rail) | medium | `sidebar.tsx:96-109` binds the shortcut globally; `(dashboard)/layout.tsx` hides the only trigger at md+. Pressing Ctrl+B (e.g. the bold habit, Firefox bookmarks) leaves desktop users with no sidebar until they reload or know the shortcut. | patch |
| 2 | `sidebar_state` cookie is written but never read, so the collapsed state is lost on reload | low | Real (`sidebar.tsx:85` writes, `defaultOpen` always true). Reading `cookies()` would make the static dashboard dynamic; rarely noticed. | reject (low, fix adds complexity) |
| 3 | A KPI change of 0 (or one that rounds to 0.0) shows an up arrow in green | low | `kpi-card.tsx:14`. No sample KPI is 0; a fix adds a neutral branch. | reject (low, unreachable with current data) |
| 4 | Nav active state uses a plain prefix match (`/orders-archive` would mark Orders active) | low | `nav-link.tsx:16`. No such route exists today; the fix is a direct correction of the condition. | patch |
| 5 | An empty revenue series renders "ranged from $∞ to $0"; empty tables show no message | low | `(dashboard)/page.tsx:40-43`, `orders-table.tsx`. Data is static and non-empty; guards add branches. | reject (low, unreachable) |
| 6 | Malformed dates throw a `RangeError` in the chart or table formatters | low | `revenue-chart.tsx:34-36`, `orders-table.tsx:58-60`. Dates come from typed constants in `data.ts`; unreachable today. | reject (low, unreachable) |
| 7 | Duplicate SVG gradient id if two `RevenueChart`s render on one page | low | `revenue-chart.tsx:63`. Only one chart exists; the guard covers state that was not demonstrated. | reject (low, unreachable) |
| 8 | Chart's daily values are unreachable by screen reader: `role="img"`, `accessibilityLayer={false}`, and the "text alternative" (the orders table) holds different data | medium | `revenue-chart.tsx:50-61`; `(dashboard)/page.tsx:71-74` gives only total/min/max. The spec's "orders table is its text alternative" was wrong; ui-ux-pro-max requires a table alternative for chart data. | patch (visually hidden table of daily values) |
| 9 | Header shows no page title, unlike the spec's layout sketch | low | Disclosed deviation; each page has its own `<h1>`. A fix needs a client title component outside the allowed list. | reject (low, cosmetic) |
| 10 | Dependencies beyond the listed ones, and caret (unpinned) versions for `radix-ui`, `class-variance-authority`, `cn`, `tw-animate-css` | low | Extra packages are shadcn requirements (user chose shadcn). The caret ranges contradict "pinning the versions npm resolves"; `cn@^0.4.0` is pre-1.0. Pinning is a direct correction. | patch (pin exact versions) |
| 11 | No `(dashboard)/error.tsx`: a data error drops the sidebar and header | low | Root `error.tsx` sits above the dashboard layout. Static data cannot throw today, and the spec said to reuse the existing `error.tsx`. | reject (low, unreachable today) |
| 12 | `TooltipProvider` is never mounted, so a future `tooltip=` would fail | false | No `SidebarMenuButton` passes `tooltip`, so the Tooltip path never renders. | reject (false) |
| 13 | Orders table's horizontal scroll container can't be reached by keyboard (WCAG 2.1.1) | medium | `ui/table.tsx:10` wrapper is `overflow-x-auto` with no `tabIndex`; rows hold no focusable content; cells are `whitespace-nowrap`. At 375px, keyboard users can't reach the Status/Amount columns. | patch |
| 14 | KPI "Orders 1,284" contradicts `/orders` "All orders · 20 orders" | low | `data.ts:42` vs `orders/page.tsx:33-35`. A visible copy contradiction; the fix is a direct wording correction. | patch |
| 15 | No tests in the repo for theme switching, active link, row counts, mobile sheet closing or `formatChange` (only an out-of-repo Playwright script) | medium | Verification-gap layer, pre-verified: no test runner in `package.json`, no test files. Needs a toolchain decision. | defer |
| 16 | Currency/date formatters are duplicated in three files | low | Real but no concrete failure named; consolidating is a refactor, not a direct fix. | reject (low) |
| 17 | Status `Badge` uses the default variant and relies on class merging to override `bg-primary` | false | `cn` (tailwind-merge replacement) resolves the conflicting `bg-*`/`text-*` classes to the ones passed in; the `[a]:hover` rule only applies to anchor badges, and none are anchors. | reject (false) |
| 18 | Mobile navigation sheet announced with shadcn placeholder text "Sidebar" / "Displays the mobile sidebar." | low | `sidebar.tsx:198-199`; screen readers hear it when opening the menu. Fixing two strings is a direct correction. | patch |
| 19 | "Last 30 days" labels will go stale because dates are fixed | low | Sample data is fictional by design and dated around creation. | reject (low) |

Patches #1, #4, #8, #10, #13, #14, #18 applied by the implementation agent. Re-verified: `npm run lint` and `npm run build` pass; the browser check (Edge, production build, light and dark at 375/768/1024/1440px) shows no horizontal scroll, no console errors, all targets at least 44px, the trigger visible at every width, the correct active link, the theme persisting with no flash, and the mobile sheet closing after navigation. #15 was appended to `deferred-work.md`.
