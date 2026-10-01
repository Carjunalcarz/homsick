# Verification Review: Architecture Spine (Hospital OPD Management System)

- **Lens:** Was each committed decision checked against reality (registry, installed project, framework docs, running code) or only asserted from memory?
- **Reviewed:** `ARCHITECTURE-SPINE.md` (draft, 2026-09-26)
- **Date:** 2026-09-26
- **Method:** `npm view` against the live registry; `npm pack` of better-sqlite3 13.0.3, drizzle-orm 0.45.3, better-auth 1.7.6, @better-auth/core 1.7.6 and @better-auth/drizzle-adapter 1.7.6 into the scratchpad (nothing installed into the project) and reading their shipped code; a runtime smoke test of better-sqlite3 13.0.3 on this machine (Node v24.21.0, win32-x64); reading `D:\Developer\Dashboard\package.json`, `next.config.ts`, `src/` layout and `node_modules/next/dist/docs` + `node_modules/next/dist/lib/server-external-packages.jsonc` for Next 16.3.6.

## Verdict

**Mostly well-grounded, but it needs fixes before it can bind implementation.** Every pinned version in the Stack table is the current `latest` on npm today, and the main technology bets work in practice: better-sqlite3 13 runs on Node 24/Windows, Next 16 treats it as an external package, `VACUUM INTO` works, and Better Auth 1.7 has the username and admin plugins and a Drizzle adapter.

Four rules, though, are written from assumed behaviour and don't match the real libraries:

1. The Drizzle transaction default.
2. Where `proxy.ts` must live in a `src/` project.
3. How "15-minute idle expiry" maps onto Better Auth, and how that interacts with 3-second polling.
4. Next 16 prerendering synchronous better-sqlite3 reads.

The spine also cites no sources, so a reader can't tell which facts were checked.

## Verified facts (what holds)

| Claim in spine | Status | Evidence |
|---|---|---|
| Next.js 16.3.6, React 19.2.8 [ADOPTED] | OK | Installed in `package.json`. npm `next@latest` = 16.3.6. React latest is 19.3.0; 19.2.8 is the adopted pin, which is fine. |
| better-sqlite3 13.0.3, Node ≥ 22 | OK | npm latest = 13.0.3 (published 2026-08-05); `engines.node: ">=22"`. |
| better-sqlite3 works on Node 24 / Windows without a toolchain | OK (verified by running it) | v13 changed packaging: no `install` script, `gypfile: false`, and it ships N-API prebuilds **inside the tarball** (`prebuilds/win32-x64.node`, `win32-arm64`, linux/glibc+musl, darwin). It no longer uses `prebuild-install` (v12 did). The smoke test on Node v24.21.0 win32-x64 loaded the prebuild with no build step. |
| Next 16 server bundling of better-sqlite3 | OK | `better-sqlite3` is in Next 16.3.6's default `server-external-packages.jsonc` and in the `serverExternalPackages` doc list, so no `next.config.ts` change is needed. |
| `VACUUM INTO` backup | OK (verified by running it) | The bundled SQLite is **3.53.4** (`VACUUM INTO` needs ≥ 3.27). A `VACUUM INTO` of a WAL-mode database produced the file. |
| Drizzle ORM 0.45.3 / drizzle-kit 0.31.11 | OK | Both are npm `latest`. drizzle-orm peer `better-sqlite3: ">=7"`. Drizzle 1.0 is at `rc.5` (see watch items). |
| Better Auth 1.7.6 + Drizzle adapter + SQLite | OK | npm latest = 1.7.6. Peers: `drizzle-orm ^0.45.2`, `drizzle-kit >=0.31.4`, `next ^14‖^15‖^16`, `react ^18‖^19`. Exports `better-auth/adapters/drizzle`, `better-auth/plugins/username`, `better-auth/plugins/admin`. |
| Better Auth `admin` plugin: roles, ban | OK | `role`, `banned`, `banReason`, `banExpires` in the admin schema; a banned user is refused a session, and an expired ban auto-clears. `banUser` takes `banExpiresIn`, and there is `defaultBanExpiresIn`. |
| Better Auth `username` plugin | Exists, but the spine doesn't name it | `/sign-in/username` endpoint, `minUsernameLength`/`maxUsernameLength`/`usernameValidator`, `displayUsername`. See F4. |
| TanStack Query 5.104.0 with React 19 / Next 16 | OK | npm latest = 5.104.0; peer `react: "^18 || ^19"`. No Next peer. `refetchInterval` + `invalidateQueries` are the v5 API. |
| Zod 4.6.5 | OK | npm latest; Better Auth depends on `zod ^4.5.4`, so the two are compatible. |
| Vitest 5.0.2 | OK, with a small caveat | npm latest; engines `^22.12 ‖ ^24 ‖ >=26`. See F6 (@types/node). |
| Next 16 `proxy.ts` convention | OK in name, but the location is wrong | `middleware` is deprecated and renamed to `proxy` in v16. The proxy defaults to the **Node.js runtime**, and setting `runtime` there throws. See F2 for the location problem. |
| shadcn CLI 4.21.0 | OK | npm latest = 4.21.0. |

## Findings

### F1 — HIGH: Drizzle `db.transaction` is DEFERRED by default and synchronous-only; the AD-3/AD-5 wording depends on behaviour that isn't there by default
- **Evidence:** In `drizzle-orm@0.45.3/better-sqlite3/session.js`, `transaction(transaction, config = {})` calls `this.client.transaction(transaction)[config.behavior ?? "deferred"](tx)`. `SQLiteTransactionConfig.behavior` is `'deferred' | 'immediate' | 'exclusive'`. In better-sqlite3 13, `lib/methods/transaction.js` throws `TypeError('Transaction function cannot return a promise')` if the callback returns a thenable. A nested `tx.transaction` becomes a SAVEPOINT.
- **Problem:** AD-3 says "`db.transaction`, which uses `BEGIN IMMEDIATE` for commands in AD-5". That's false unless every call site passes `{ behavior: "immediate" }`. A plain `db.transaction(fn)` issues `BEGIN` (deferred), which is exactly the read-then-upgrade pattern that can fail with `SQLITE_BUSY` without waiting on `busy_timeout`, or race on the queue counter. Also, "one service method runs in one transaction and calls `audit.record(...)` inside it" only works if the service body and `audit.record` are **fully synchronous**. An `async` service method or any `await` inside the callback throws at runtime.
- **Fix:** In AD-3/AD-5, write it out: "All command transactions are `db.transaction((tx) => {...}, { behavior: "immediate" })` through one `withCommandTx()` helper in `src/server/db`. The callback is synchronous: no `async`/`await`, no promise return. Repos and `audit.record` take `tx` and use `.run()/.get()/.all()`." Consider applying `immediate` to all commands, not just AD-5 ones, because with a single writer it costs nothing and avoids upgrade deadlocks.

### F2 — HIGH: `proxy.ts` is placed at the project root, but this project uses `src/app`
- **Evidence:** The Next 16.3.6 docs (`03-file-conventions/proxy.md`) say: "Create a `proxy.ts` file in the project root, or inside `src` if applicable, so that it is located at the same level as `pages` or `app`." The project has `src/app` and no root `app/`. The spine's Structural Seed puts `proxy.ts` next to `drizzle/`, outside `src/`.
- **Problem:** A root `proxy.ts` is ignored when the app lives in `src/app`, so the signed-out redirect in AD-4 would silently never run.
- **Fix:** Move it to `src/proxy.ts` in the tree and in AD-4. Export `proxy` (or a default export) plus `config.matcher`, and exclude `_next/static`, `_next/image`, `api/auth`, `(display)/board` and static assets. The Node runtime is the default in Next 16, so don't set `runtime`.

### F3 — HIGH: "15-minute idle expiry" isn't a Better Auth setting; 3-second polling will keep sessions alive forever and write to the DB on every poll
- **Evidence:** In `@better-auth/core@1.7.6` `init-options.d.mts`, `session.expiresIn` (default 7 days) and `session.updateAge` (default 1 day; "if set 0 the session will be refreshed every time it is used"). There is also `freshAge` and `cookieCache`. There is no separate idle-timeout option.
- **Problem:** The only way to get idle expiry is `expiresIn: 900` with a small `updateAge`, which is a sliding expiry refreshed by **any** authenticated request. AD-10's live screens poll every 3 s, so an unattended Facility Queue tab never goes idle and PRIV-7's intent fails. With `updateAge: 0`, every poll from every tab also issues a session `UPDATE`, which competes for SQLite's single writer lock with queue commands.
- **Fix:** In AD-9, state the mechanism: `session: { expiresIn: 900, updateAge: 60 }`, with `cookieCache` **disabled** (or `maxAge` ≤ 60) so bans and lockouts apply right away. Polling route handlers must validate the session **without refreshing it**: call `auth.api.getSession({ headers, query: { disableRefresh: true } })`, or check the session row directly in `requireStaff({ refresh: false })`. Refresh only on user-initiated navigation and Server Actions. Alternatively, add a client-side idle timer that signs out after 15 minutes without input. Record the choice.

### F4 — MEDIUM: Username sign-in and lockout are under-specified against what Better Auth 1.7.6 provides
- **Evidence:** The better-auth 1.7.6 plugin list includes `username` and `admin`. A search of the dist code for `lockout|failedAttempt|maxAttempts` finds account lockout **only** in the `two-factor` plugin (`accountLockout`, second-factor failures only). Nothing locks accounts after failed **password** sign-ins. The built-in `rateLimit` is per-IP/path throttling, not account lockout.
- **Problem:** AD-9 names only the `admin` plugin and leaves the lockout choice open ("if the plugin does not provide it"). It doesn't provide it, so the hook is mandatory, and the spine doesn't say where the failure counter lives.
- **Fix:** In AD-9, say that Better Auth uses the Drizzle adapter (`provider: "sqlite"`) plus the `username()` and `admin()` plugins, with email/password enabled only as the underlying credential store. Lockout works like this: a `hooks.after` on `/sign-in/username` increments a `user.failed_sign_ins` additionalField on failure and resets it on success; at 5 it sets `banned=true, banReason="locked", banExpires=null` (the admin plugin already blocks sessions for banned users), and an Admin unlocks through `unbanUser`. Also configure `rateLimit` with database or secondary storage, because the default in-memory store resets on restart. Store Facility as a `user` additionalField, and map `role` to the four PRD roles through the admin plugin's `ac`/`roles` options.

### F5 — MEDIUM: Next 16 prerenders synchronous better-sqlite3 reads, and Better Auth's writes fall outside AD-3's transaction
- **Evidence:** Next 16.3.6 docs, `connection.md` and `08-caching.md`: "Queries from synchronous database drivers like `better-sqlite3` complete during prerendering… call `connection()` before your query." In `@better-auth/drizzle-adapter@1.7.6`, `transaction: config.transaction ?? false`. For SQLite the adapter issues each write on its own, and its transaction path passes an async callback that better-sqlite3 rejects (see F1).
- **Problem (a):** Any Server Component or read handler that queries without first touching a request-time API (settings getters, directory, board metadata) can be frozen at `next build`, and the build process would open the production DB file. **Problem (b):** Staff-account creation, role changes and bans happen inside Better Auth's own async calls. They can't share the `db.transaction` + `audit.record` of AD-3, so FR-26 audit rows for auth events need a different path.
- **Fix:** (a) Add a convention: every `queries.ts` entry point either calls `requireStaff()` (which reads cookies) or `await connection()` before touching `db`, and `src/server/db` opens the DB lazily on first use, not at module load during build. (b) Keep `drizzleAdapter(db, { provider: "sqlite", transaction: false })`, and add an AD-3 exception: auth writes go through Better Auth, and their audit rows are written from Better Auth `databaseHooks` (`user.create/update.after`, `session.create.after`) or `hooks.after` in a separate immediate transaction. Also note that Better Auth's generated SQLite schema stores dates as integer timestamps, which is an exception to the ISO-text rule in AD-7.

### F6 — LOW: No sources are cited, and there are small toolchain gaps
- The spine records no evidence (links, dates, `npm view` results) for any version or capability. Every version happens to match npm `latest` on 2026-09-26, so they look checked, but a reader can't tell. **Fix:** add a "Verified 2026-09-26" footnote or source list for the Stack table (this review can serve as that source).
- `vitest@5.0.2` has an optional peer `@types/node: "^22.0.0 || >=24.0.0"`, and the project has `@types/node ^20` (installed 20.19.43). npm enforces optional peer ranges when the package is present, so installing Vitest will hit ERESOLVE. **Fix:** bump `@types/node` to `^24` to match the Node 24 runtime. Vitest 5 also needs `vite ^6.4‖^7‖^8` (a required peer).
- better-sqlite3 13 ships no TypeScript types. **Fix:** add `@types/better-sqlite3` (latest 9.6.0) to devDependencies. Its API surface matches what Drizzle uses.
- TypeScript npm latest is 7.0.2. The spine says 5.x [ADOPTED], which matches the project (`^5`). That's fine, but label it a deliberate pin.

## Watch items (not defects)
- **Drizzle 1.0** is at `1.0.0-rc.5` (0.45.3 is `latest`). Better Auth already accepts `>=1.0.0-rc.1`. 1.0 changes the migrations folder layout and relational queries (RQB v2). Pin `drizzle-orm`/`drizzle-kit` exactly and treat the 1.0 upgrade as its own story.
- **WAL + `VACUUM INTO`:** The backup is consistent without stopping the app, but it takes a read transaction for its whole run. Schedule it off-hours, or use `db.backup()` (better-sqlite3's online backup API, which works in pages), and restore-test it.
- **better-sqlite3 13 packaging change:** On an unsupported platform (e.g. Windows ia32, FreeBSD) it falls back to `build/Release`, and there's no auto-build script. The hospital host must be x64/arm64 Windows, Linux or macOS. Add that to the Deferred hosting note.
