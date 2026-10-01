# Addendum: Hospital OPD Management System PRD

Technical and reuse notes kept out of the PRD, for `bmad-architecture` and epic planning. These are not requirements.

## Reuse from the existing codebase (stories 1.1–1.5)

- **Stack:** Next.js 16.3.6 App Router, React 19.2, TypeScript, Tailwind 4, shadcn/ui (`radix-nova` style), next-themes, Recharts and lucide-react. Versions are pinned; see `package.json`.
- **Shell and design (story 1.5):** the top bar with icon-over-label nav, the left rail, the gray page, white cards, the cyan banner, the green and orange action buttons, Roboto, and the light and dark tokens in `globals.css`.
  - The top nav (`src/components/nav-items.ts`) becomes something like Overview, Triage, Queues, Patients, Appointments and Directory.
  - The left rail now holds order-status shortcuts. For the hospital, it suits per-Facility Queue shortcuts (Prenatal, Animal Bite Center, Treatment, Consultation).
- **Table pattern (story 1.4):** the server-side, URL-driven search, filters and pagination (`orders-query.ts`, `orders-href.ts`, `orders-toolbar.tsx`, `orders-pagination.tsx`) fit the Patients list and the Appointments list directly.
  - **Known bug to fix first:** toolbar state does not sync when the URL changes from outside (see story 1.5, Known issues).
- **Data seam:** `src/lib/data.ts` holds typed async functions over sample data. For the hospital, a real persistence layer replaces it.
- **Store content to remove:** the Acme Store sample data, the Orders pages, the KPI copy, and the `/api/stats` story 1.3. Story 1.3 was never built; drop it or replace it with a hospital equivalent.

## New technical needs the PRD implies

These are architecture decisions, not yet made:

- **Persistence:** a real database, because Patient Records, Visits and Queues must survive restarts and be shared between workstations. Issuing Queue Numbers and *Call next* need atomic operations, such as transactions or row locks (NFR-4, FR-8, FR-11).
- **Authentication and authorization:** Staff Accounts with Roles, session timeout and lockout (FR-1–FR-3). Candidates: Auth.js / NextAuth, or a hosted provider. Check that they work with Next.js 16.
- **Live updates** (FR-10, FR-16, NFR-2), under 5 seconds. Options:
  - short-interval polling (simplest);
  - Server-Sent Events;
  - WebSockets.

  TanStack Query (the `tanstack-query-expert` skill is installed) fits the polling option: `refetchInterval` on the Queue view and the Display Board, and `useMutation` with optimistic updates for *Call next*, Serving and Complete.
- **Audit log:** an append-only table, written in the same transaction as each change (PRIV-2).
- **Display Board:** a separate route with its own minimal layout (no app shell), shown full screen and restricted by a device token (FR-27). Browsers block autoplay, so the chime needs a user gesture on first load.
- **Printing Queue Numbers:** the simplest start is the browser print dialog with a small printable slip layout. Receipt printers can come later.
- **Hosting and data residency:** an on-premise or cloud decision (PRD §11, open question 4). It affects the Data Privacy Act review.
- **Configurable reference data:** the research below shows that Priority Categories, the Urgency Level scale, the prenatal contact target and the vaccine schedules vary by policy. Store them as Admin-editable settings (FR-24), not constants.
- **Testing:** deferred-work.md already notes that the repo has no automated tests. For a real hospital system, queue ordering (FR-9), Queue Number issuing (FR-8, FR-12) and role access (FR-2) need unit and integration tests from the first story.

## Sources (research digest, 2026-09-26)

Web research done during PRD discovery. Items marked *unverified* came from secondary summaries; check them against the primary text.

- **Priority lanes**
  - RA 9994, Expanded Senior Citizens Act: https://www.officialgazette.gov.ph/2010/02/15/republic-act-no-9994/
  - RA 10754 and NCDA Board Resolution No. 11 s.2024 (PWD express lanes): https://ncda.gov.ph/resolution-reinforcing-express-or-priority-lanes-for-persons-with-disabilities-pursuant-to-republic-act-nos-9442-and-10754-board-resolution-no-11-series-of-2024/
  - Pregnant women: no national RA was found; priority comes from local ordinances (e.g. Quezon City) or hospital policy.
- **Data privacy**
  - NPC Circular 16-03, personal data breach management (72-hour notice): https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf
  - NPC Circular 2023-06, security of personal data: https://privacy.gov.ph/wp-content/uploads/2024/03/NPC-Circular-Repeal-16-01-Signed.pdf
  - Health Privacy Code, JAO 2016-0002: https://www.dataguidance.com/sites/default/files/health_privacy_code_as_reviewed_by_npc_05.24.2017.pdf
  - DOH DC 2021-0226 Records Disposition Schedule (outpatient 7 years, inpatient 10), *unverified*: https://www.foi.gov.ph/agencies/doh/retention-and-disposal-of-records/
- **Animal Bite Treatment Center**
  - WHO exposure categories I/II/III: https://www.who.int/teams/control-of-neglected-tropical-diseases/rabies/vaccinations-and-immunization
  - DOH AO 2018-0013, 1-week intradermal regimen (Day 0/3/7): https://www.cabidigitallibrary.org/doi/full/10.1079/9781800622975.0006. The booster-only rule for previously immunized patients was *unverified* in the AO text.
  - ABTC registry and NaRIS reporting (RA 9482): https://pmc.ncbi.nlm.nih.gov/articles/PMC12769843/
- **Prenatal**
  - DOH AO 2016-0035, 8 contacts: https://caro.doh.gov.ph/a-minimum-of-eight-contacts-are-recommended-to-reduce-perinatal-mortality-and-improve-womens-experience-of-care/
  - Visit data fields beyond gestational age, EDD, vital signs and tetanus toxoid are *unverified* in the DOH text.
- **Triage**
  - No DOH-mandated OPD triage scale was found. ESI (5-level) is used in PH emergency departments: https://registry.healthresearch.ph/index.php/registry?view=research&layout=details&cid=3236
- **PhilHealth**
  - PIN and Konsulta registration: https://www.philhealth.gov.ph/circulars/2022/circ2022-0005.pdf
  - The exact registration fields for iClinicSys and PhilHealth claims were *unverified*.
