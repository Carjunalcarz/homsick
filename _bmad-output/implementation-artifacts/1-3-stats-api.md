# Story 1.3: Stats API

Status: superseded

> **Superseded on 2026-09-26. Do not implement.** The project became the Hospital OPD Management System. See `_bmad-output/planning-artifacts/epics.md` (Epics 2–7) and `sprint-status.yaml`. The Acme Store data this story depended on is removed in Story 2.1.

## Story

As a developer integrating with the dashboard,
I want a `GET /api/stats` endpoint that returns the dashboard's KPIs and revenue series for a chosen time range, with validated input,
so that other clients (and future dashboard features) can read the same numbers the overview shows, and bad requests fail clearly instead of crashing.

## Acceptance Criteria

1. **Valid range.** Given the app is running, when a client requests `GET /api/stats?range=30d`, then the response is `200` with JSON `{ range: "30d", kpis: Kpi[], series: RevenuePoint[] }`, and `series` has exactly 30 points.
2. **Default range.** Given no `range` parameter, when a client requests `GET /api/stats`, then the response is `200` and `range` is `"7d"` with 7 series points.
3. **All ranges.** Given `range` is `7d`, `30d` or `90d`, then `series` has 7, 30 or 90 points respectively, ordered oldest to newest.
4. **Invalid range.** Given `range=abc` (or `range=`, or `range=7D`), when requested, then the response is `400` with JSON `{ error: string }`. The message names the allowed values. The server does not throw or log an unhandled error.
5. **Same source as the UI.** Given the overview page from story 1.2, then the API's `kpis` values and its 30-day `series` equal what the overview renders, because both read from `src/lib/data.ts`.
6. **Other methods.** Given `POST /api/stats`, then Next.js returns `405` (no handler defined; nothing to implement).
7. **Tests.** Given the finished code, when running `npm test`, then Vitest runs the route-handler tests for AC1–AC4 and they pass.
8. **Quality checks.** Given the finished code, when running `npm run lint` and `npm run build`, then both succeed, and the build output lists `ƒ /api/stats` as a dynamic route.

## Tasks / Subtasks

- [ ] **Task 1: Extend the data module** (AC: 1, 3, 5)
  - [ ] 1.1 In `src/lib/data.ts` (created by story 1.2), make the revenue series generator take a day count: `getRevenueSeries(days: number)`. Keep the 30-day output identical to what 1.2's overview shows, since the overview calls it with `30`.
  - [ ] 1.2 Export the `Kpi` and `RevenuePoint` types if 1.2 did not.
  - [ ] 1.3 Make the series deterministic. Generate it from a fixed seed or formula, not `Math.random()`, so tests and the UI agree.
- [ ] **Task 2: Validation schema** (AC: 2, 4)
  - [ ] 2.0 `npm install zod@4.6.5` (runtime dependency)
  - [ ] 2.1 Create `src/lib/validation/stats.ts` exporting `statsQuerySchema` and the `StatsRange` type (see Dev Notes for the Zod 4 code).
- [ ] **Task 3: Route handler** (AC: 1–4, 6)
  - [ ] 3.1 Create `src/app/api/stats/route.ts` with only `export async function GET(request: NextRequest)`.
  - [ ] 3.2 Parse `request.nextUrl.searchParams.get("range")`, converting `null` to `undefined` before `safeParse` so the default applies.
  - [ ] 3.3 On failure, return `Response.json({ error }, { status: 400 })`. On success, return `Response.json({ range, kpis, series })`.
- [ ] **Task 4: Test setup** (AC: 7)
  - [ ] 4.1 `npm install -D vitest@5.0.2 vite-tsconfig-paths@6.1.1` (exact versions).
  - [ ] 4.2 Create `vitest.config.mts` with `tsconfigPaths()` and `environment: "node"`.
  - [ ] 4.3 Add `"test": "vitest run"` to `package.json` scripts.
- [ ] **Task 5: Tests** (AC: 1–4, 7)
  - [ ] 5.1 Create `src/app/api/stats/route.test.ts`. Call `GET` directly with `new NextRequest("http://localhost/api/stats?range=…")`.
  - [ ] 5.2 Cover: each valid range (status, `range`, series length, ascending dates), the missing param (defaults to `7d`), and `abc`, the empty string and `7D` (status `400`, `error` is a non-empty string).
- [ ] **Task 6: Docs and verification** (AC: 8)
  - [ ] 6.1 Add an "API" section to `README.md` (endpoint, params, example responses) and add `npm test` to the scripts table.
  - [ ] 6.2 Run `npm run lint`, `npm test` and `npm run build`. Then run `next start` and check `/api/stats`, `/api/stats?range=90d` and `/api/stats?range=abc` with curl.

## Dev Notes

### Context and dependencies

- **Depends on story 1.2** (`1-2-example-dashboard.md`, now `done`), which created `src/lib/data.ts` with `getKpis()`, `getRevenueSeries()`, `getRecentOrders(limit)` and `getOrders()`. Do not create a second data module.
- **Changed since this story was written** (checked 2026-09-26):
  - Story 1.4 added `queryOrders()`, `SAMPLE_TODAY`, `ORDER_STATUSES`, `ORDER_PERIODS` and the order query types to `data.ts`, and grew the sample orders to 60. Keep all of these.
  - Story 1.5 restyled the UI, so the Overview page (`src/app/(dashboard)/page.tsx`) now also calls `getOrders()`. It still calls `getRevenueSeries()` with no argument, so the new `days` parameter must default to 30.
  - `src/lib/orders-href.ts` must never import runtime values from `data.ts`.
  - Kpi `value` is a pre-formatted string (e.g. `"$48,250"`) plus a `changeUnit` field. The API returns them as they are.
- **Covers the second entry in `deferred-work.md`** (the Zod-validated `/api/stats` route with tests). It was originally specified in `spec-nextjs-dashboard-foundation.md` (I/O matrix rows API_VALID and API_INVALID).
- **Story 1.1 is still `in-progress`** because Git is not installed. If a repo exists by now, check `git log` for the patterns 1.2 established.

### Files

| File | Action | Notes |
|---|---|---|
| `src/lib/data.ts` | UPDATE | Only change the series generator signature. Keep every existing export and the 30-day output unchanged, because the overview page and chart depend on them. |
| `src/lib/validation/stats.ts` | NEW | Zod schema |
| `src/app/api/stats/route.ts` | NEW | GET handler |
| `src/app/api/stats/route.test.ts` | NEW | Vitest tests |
| `vitest.config.mts` | NEW | Test config |
| `package.json` | UPDATE | `test` script, 2 dev dependencies, and `zod` (dependency) |
| `README.md` | UPDATE | API section |

- **Do not touch:** `src/app/layout.tsx`, `globals.css`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, or any UI component.
- **Check `eslint.config.mjs`:** it lints all files. The test file must pass lint too, so there must be no unused imports.

### Next.js 16.3.6 route handlers

Verified in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. `AGENTS.md` requires reading these docs before coding.

- `GET` handlers are **dynamic by default** since v15 (the version history table in `route.md`). Reading `searchParams` also keeps the route dynamic. Do not add `export const dynamic`, `revalidate` or `"use cache"`.
- Use `request.nextUrl.searchParams` (a `NextRequest` convenience) and return `Response.json(body, { status })`. Do not use the older `NextResponse.json` unless it's needed. Both work, but the docs use `Response.json`.
- Do not define `POST` or other methods. Next.js answers `405` automatically.
- `searchParams.get("range")` returns the **first** value when the parameter repeats (`?range=7d&range=abc` becomes `7d`). That is acceptable, so don't add handling for it.

### Zod 4.6.5

The latest version, checked 2026-09-26. Zod 4 changed the error APIs, so do not copy Zod 3 examples.

```ts
// src/lib/validation/stats.ts
import { z } from "zod";

export const statsQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("7d"),
});

export type StatsRange = z.infer<typeof statsQuerySchema>["range"];
```

```ts
// in route.ts
const parsed = statsQuerySchema.safeParse({
  range: request.nextUrl.searchParams.get("range") ?? undefined, // null would fail; undefined applies the default
});
if (!parsed.success) {
  return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
}
```

- **Common bug:** passing `null` straight in makes `?`-less requests return `400` instead of defaulting. Include the `?? undefined`.
- An empty `range=` gives `""`, which must be a `400`. Do not use `||` in place of `??`.
- Do not use `.parse()` with try/catch. `safeParse` is the pattern `nextjs-best-practices` asks for ("validate input with Zod, return proper status codes").
- `zod` is a runtime **dependency**, not a dev dependency. Install with `npm install zod@4.6.5`.

### Testing (Vitest 5.0.2)

- The Next.js docs (`02-guides/testing/vitest.md`) show a setup with jsdom and React Testing Library for component tests. This story tests only a route handler, so use `environment: "node"` and skip `jsdom`, `@testing-library/*` and `@vitejs/plugin-react`. They are unnecessary dependencies, which story 1.1's constraints forbid.
- `vite-tsconfig-paths` makes `@/*` imports resolve in tests.
- Do not start a server in tests. Import `GET` and call it with a `NextRequest`. `NextRequest` comes from `next/server`, which works under Node.

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node" },
});
```

### Response contract

```jsonc
// 200 GET /api/stats?range=7d
{
  "range": "7d",
  "kpis": [{ "label": "Revenue", "value": 48250, "change": 12.4 /* … as in data.ts */ }],
  "series": [{ "date": "2026-09-20", "revenue": 1480 } /* 7 items, oldest first */]
}
// 400 GET /api/stats?range=abc
{ "error": "✖ Invalid option: expected one of \"7d\"|\"30d\"|\"90d\"\n  → at range" }
```

- Use the exact field names from story 1.2's `data.ts`. The ones above are illustrative. Do not rename fields to match this example.
- Tests should assert the `400` message is a non-empty string, not its exact text, since Zod's wording can change between patch versions.

### Project Structure Notes

- The `src/app/api/<resource>/route.ts` layout matches `nextjs-best-practices` §10.
- `src/lib/validation/` is a new folder. Future request schemas go here, one file per resource.
- `vitest.config.mts` goes at the project root, next to `eslint.config.mjs` and `next.config.ts`.
- No conflicts with existing structure were found.

### References

- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md#Version History] GET dynamic by default since v15
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md#URL Query Parameters] `request.nextUrl.searchParams`
- [Source: node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md] Vitest setup
- [Source: .claude/skills/nextjs-best-practices/SKILL.md#4. API Routes] Zod validation, status codes
- [Source: _bmad-output/implementation-artifacts/1-2-example-dashboard.md#Architecture] `data.ts` functions
- [Source: _bmad-output/implementation-artifacts/1-1-initialize-nextjs-application.md#Implementation Notes] Next 16.3.6, `tsc` needs generated types first (run `npm run build` before `npx tsc --noEmit`)
- [Source: _bmad-output/implementation-artifacts/spec-nextjs-dashboard-foundation.md#I/O & Edge-Case Matrix] original API_VALID / API_INVALID cases
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] deferred item this story covers

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
