---
title: 'Next.js dashboard foundation (App Router best practices)'
type: 'feature'
created: '2026-09-26'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/.claude/skills/nextjs-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dashboard project has no application code, so there is nothing to build features on and no enforced Next.js conventions.

**Approach:** Scaffold a Next.js 16 App Router + TypeScript + Tailwind app at the project root, structured per `nextjs-best-practices`: a `(dashboard)` route group with a shared shell layout, Server Components by default with small client leaves, route-level `loading`/`error`/`not-found`, a Zod-validated route handler, and base metadata.

## Boundaries & Constraints

**Always:** Server Components by default; `'use client'` only on components needing state/events. Every dashboard route segment has `loading.tsx` and `error.tsx`. Route handlers validate input with Zod and return correct status codes. Existing `.claude/`, `_bmad/`, `_bmad-output/` stay untouched. Pin exact versions resolved at install time.

**Never:** No auth, database, or real external data sources. No `'use client'` on layouts or pages. No data fetching in client components. No Pages Router. No deprecated `middleware.ts` (Next 16 uses `proxy.ts`; none needed here).

**Decisions:** UI components use **shadcn/ui** (initialized via the `shadcn` CLI; components copied into `src/components/ui/`). Content is a **generic starter**: overview page with sample KPI cards and a sample table, all from placeholder data meant to be replaced later. Theme supports **light and dark with a toggle** via `next-themes` (defaults to system preference; toggle is a small client leaf in the header).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `GET /` | Dashboard shell renders with nav + overview page | N/A |
| UNKNOWN_ROUTE | `GET /does-not-exist` | Custom `not-found.tsx` with link home, HTTP 404 | N/A |
| API_VALID | `GET /api/stats?range=7d` | 200 JSON `{ range, items[] }` | N/A |
| API_INVALID | `GET /api/stats?range=abc` | 400 JSON `{ error }` with Zod issue message | Zod `safeParse`, no throw |
| RENDER_ERROR | Overview data loader throws | Segment `error.tsx` shows message + "Try again" (`reset()`) | Error boundary, shell stays visible |

</frozen-after-approval>

## Code Map

- Project root is empty except `.claude/` (skills), `_bmad/` (BMAD install), `_bmad-output/` (specs), and an empty `package-lock.json` (`"packages": {}`, leftover; safe to replace).
- `create-next-app@16.3.6` cannot init in `.`: folder name `Dashboard` is not a valid npm name and root has existing files. Scaffold into a temp dir named `dashboard`, then move contents to root.
- Resolved latest: next 16.3.6, react 19.3.0, tailwindcss 4.3.3, zod 4.6.5, typescript 7.0.2.
- `.claude/skills/nextjs-best-practices/SKILL.md` -- conventions source. Its "fetch is cached by default" row is outdated for Next 15+; use explicit `cache`/`revalidate` options instead.
- `.claude/skills/ui-ux-pro-max/` -- optional styling reference for dashboard layout/palette; not required.

## Tasks & Acceptance

**Execution:**
- [ ] (temp dir) -- run `npx create-next-app@16.3.6 dashboard --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --agents-md --disable-git --yes`, move all output to root replacing empty `package-lock.json` -- scaffold without clobbering BMAD files
- [ ] root -- `git init` + `.gitignore` covers `node_modules`, `.next`, `.env*`, `_bmad/render/` -- enables BMAD review diffs
- [ ] `src/app/layout.tsx` -- root html/body, fonts, base `metadata` (title template `%s | Dashboard`, description) -- global metadata
- [ ] `src/app/not-found.tsx` -- 404 page with link home -- UNKNOWN_ROUTE
- [ ] `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx` -- `next-themes` provider (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`) wrapped in root layout with `suppressHydrationWarning` on `<html>`; toggle button (client) in dashboard header -- light/dark decision without hydration flash
- [ ] `src/app/(dashboard)/layout.tsx` -- server shell: sidebar nav + header; client nav leaf only for active-link highlight -- shared layout without client bloat
- [ ] `src/app/(dashboard)/page.tsx`, `loading.tsx`, `error.tsx` -- overview page (server, reads from `src/lib/data.ts`), skeleton, client error boundary with `reset()` -- HAPPY_PATH, RENDER_ERROR
- [ ] `src/lib/data.ts` -- typed sample-data loader (server-only) -- single data seam to swap for real sources later
- [ ] `src/app/api/stats/route.ts` -- `GET` with Zod-validated `range` (`7d|30d|90d`, default `7d`) -- API_VALID, API_INVALID
- [ ] `src/components/ui/` -- `npx shadcn@latest init`, then add `card`, `button`, `table`, `sidebar`, `skeleton` -- reusable UI from the chosen kit
- [ ] `src/app/api/stats/route.test.ts` + vitest config -- test API_VALID / API_INVALID / default range -- I/O matrix coverage

**Acceptance Criteria:**
- Given a fresh clone, when `npm install && npm run build` runs, then the build succeeds with no type or lint errors.
- Given the built app, when inspecting components, then only interactive leaves contain `'use client'`.
- Given the project root after scaffolding, when listing it, then `.claude/`, `_bmad/`, `_bmad-output/` are unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint` -- expected: 0 errors
- `npx tsc --noEmit` -- expected: 0 errors
- `npm test` -- expected: all API route tests pass
- `npm run build` -- expected: success; `/` and `/api/stats` listed in route output

**Manual checks (if no CLI):**
- `npm run dev`, open `/` (shell + overview), `/nope` (404), `/api/stats?range=abc` (400 JSON); click theme toggle, reload — chosen theme persists with no flash.
