---
title: 'Initialize Next.js Application'
type: 'feature'
created: '2026-09-26'
status: 'in-progress'
story_key: '1-1-initialize-nextjs-application'
---

# Story 1.1: Initialize Next.js Application

## User Story

As a developer,
I want to initialize a new Next.js application using the latest stable version of Next.js,
so that I have a clean, modern, and maintainable foundation for building the application.

## Decisions

- **Tailwind CSS included** (user decision 2026-09-26): Next.js default, and needed later by shadcn/ui.
- **Package manager:** npm.
- **Version verified 2026-09-26:** `next@16.3.6` is the npm `latest` dist-tag (canary 16.4.0 and preview tags excluded).
- **Supersedes for now:** `spec-nextjs-dashboard-foundation.md`. Its dashboard shell, shadcn/ui, theme toggle, `/api/stats` and tests are deferred (see `deferred-work.md`).

## Scope

Minimal App Router + TypeScript + ESLint + Tailwind app in `src/` with `@/*` alias. One home page:

```text
Dashboard
Welcome
The application has been successfully initialized.
```

No auth, database, business logic, extra pages, or dependencies beyond the Next.js defaults. No environment variables are required, so no `.env.example` is created; the README states this.

## Acceptance Criteria

- **AC1** Given a clean environment, when initialized, then a valid Next.js app on the latest stable version exists.
- **AC2** Given the project, when opening source, then it uses TypeScript.
- **AC3** Given the app, when started, then routing uses the App Router.
- **AC4** Given dependencies installed, when `npm run dev` runs, then the app starts.
- **AC5** Given the source, when `npm run build` runs, then it completes without errors.
- **AC6** Given the project, when `npm run lint` runs, then no unresolved errors.
- **AC7** Given the dev server, when opening the app, then the home page renders.
- **AC8** Given the repo, when checking `git status`, then `node_modules/`, `.next/`, `.env`, `.env.local` are ignored.

## Tasks

- [x] Verify latest stable Next.js version
- [x] Scaffold with `create-next-app@16.3.6` (TS, ESLint, Tailwind, App Router, `src/`, `@/*`, npm) into a temp folder and move into root without touching `.claude/`, `_bmad/`, `_bmad-output/`
- [ ] `git init` — BLOCKED: git is not installed on this machine. `.gitignore` is done (covers AC8, keeps `.env.example` committable)
- [x] Root layout with metadata; home page with the content above; clean responsive layout
- [x] README with setup instructions, scripts, and env-var note
- [x] Verify: `npm run lint`, `npm run build`, `npm run start`, `npm run dev`, home page renders

## Dev Notes

- `create-next-app` cannot init in `.`: the folder name `Dashboard` is not a valid npm package name, and the root already has files. Scaffold into `.scaffold-tmp/dashboard` (same drive, so moves are cheap), then move.
- Root `package-lock.json` is empty (`"packages": {}`) and is replaced by the scaffold's.

## Implementation Notes

- Installed: next 16.3.6, react/react-dom 19.2.8 (the version create-next-app pairs with Next 16.3.6), TypeScript 5, ESLint 9 + eslint-config-next 16.3.6, Tailwind 4. No other dependencies.
- create-next-app also generated `AGENTS.md` (Next.js agent rules, re-added by `next dev`) and `CLAUDE.md` (imports `AGENTS.md`). Kept.
- Removed the template's unused SVGs from `public/`; added `public/.gitkeep` so the folder is tracked.
- `globals.css`: removed the template's `font-family: Arial` override so the Geist font from `layout.tsx` applies (`font-sans` on `<body>`).
- `.gitignore`: added `!.env.example` after `.env*`. No env vars are needed, so no `.env.example` exists yet.
- `npx tsc --noEmit` fails on a fresh clone (`LayoutProps` not found) until Next generates route types (`next build`, `next dev` or `next typegen`). `npm run build` type-checks correctly.
- Verification (2026-09-26): lint 0 errors; build OK (`/` static, `/_not-found`); `next start` GET `/` 200 with title "Dashboard" and the welcome text, GET `/nope` 404; `next dev` GET `/` 200.
- nextjs-best-practices pass (2026-09-26): added `src/app/not-found.tsx` (custom 404, title "Page not found | Dashboard"), `src/app/error.tsx` and `src/app/global-error.tsx` (client error boundaries), and a `%s | Dashboard` title template in `layout.tsx`. Next 16.3 passes `retry` (not the older `reset`) to error boundaries; confirmed in `node_modules/next/dist/docs`. No `loading.tsx`, since the home page is static and has nothing to wait for. No Open Graph image or canonical URL until the site has a domain. Re-verified: lint, `tsc`, build, `/` 200, `/nope` 404 with the custom page.
- ui-ux-pro-max pass (2026-09-26): adopted its "Data-Dense Dashboard" design system as tokens in `globals.css` (slate neutrals, blue primary, `surface`/`muted`/`border`/`ring`, light and dark via `prefers-color-scheme`) and Fira Sans (body) with Fira Code (headings) through `next/font`, replacing Geist. Rejected two suggested colors for failing 4.5:1: orange CTA #F97316 (2.8:1) and white on #3B82F6 (3.68:1). Used blue-600 (5.17:1) in light mode and blue-400 with dark text (7.02:1) in dark mode. Buttons and links now have `cursor-pointer`, visible `focus-visible` rings, 200ms color transitions and a 44px height. Added a global `prefers-reduced-motion` rule. Re-verified lint, build, `/` 200 and `/nope` 404.
- AC8 not verifiable: `git` is not installed. Install Git, then run `git init -b main` and `git status` to confirm ignores.
