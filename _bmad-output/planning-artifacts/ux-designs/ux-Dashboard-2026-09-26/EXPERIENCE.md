---
name: Hospital OPD Management System
status: final
updated: '2026-09-26'
sources:
  - ../../prds/prd-Dashboard-2026-09-26/prd.md
  - ../../architecture/architecture-Dashboard-2026-09-26/ARCHITECTURE-SPINE.md
  - ../../../implementation-artifacts/1-4-orders-search-filters-pagination.md
  - ../../../implementation-artifacts/1-5-reference-design-restyle.md
---

# Hospital OPD Management System: Experience Spine

## Foundation

This is a responsive web app on shadcn/ui (radix-nova), Next.js 16 and Tailwind 4, with Lucide icons. `DESIGN.md` is the visual reference; this spine covers behavior. PRD Glossary terms are used exactly (Visit, Queue Entry, Queue Number, Facility, Urgency Level, Priority Category).

**Surfaces:**
- **Staff app:** used at the triage desk, at the four Facility counters (desktop or tablet), and on admin PCs. Signed in; the Role decides what is visible.
- **Display Board:** an unattended TV browser in the waiting area. No sign-in; it is a registered device.
- **Printed Queue slip:** from the browser print dialog, about 58–80 mm wide.

`[ASSUMPTION]` Phones are not a target, but no surface may break at 375px.

Stakes are regulated: health data is sensitive personal information (RA 10173). Screens show patient data only to the Roles that need it (PRD FR-2), and the Display Board never shows any.

## Information Architecture

| Surface | Route | Reached from | Roles | Purpose (PRD) |
|---|---|---|---|---|
| Sign in | `/sign-in` | Any signed-out request | all | FR-1 |
| OPD Overview | `/` | Top nav "Overview", logo | all | Today per Facility: waiting, serving, served, average and longest wait, longest Routine wait, Appointments (FR-21) |
| Triage | `/triage` | Top nav "Triage"; `g t` | Triage Nurse, Admin | Find or register, triage, issue a Queue Number (FR-4, FR-5, FR-7, FR-8); check in today's Appointments (FR-18) |
| Facility Queue | `/queues/[facility]` | Top nav "Queues", left rail tiles, Overview cards | Facility Staff (own Facilities), Admin | Live queue, call, serve, complete, refer, No-show (FR-9–FR-14, FR-22) |
| Patients | `/patients` | Top nav "Patients"; header search | all | Search list: story 1.4 table pattern (FR-4) |
| Patient Record | `/patients/[id]` | Patients row, Triage match, Queue row "Open record" | all (audited view) | Demographics, Visit history, upcoming Appointments (FR-6) |
| Appointments | `/appointments` | Top nav "Appointments" | all (booking scoped by Role) | Day list by Facility and status, book, reschedule, cancel, check in (FR-17, FR-18) |
| Directory | `/directory` | Top nav "Directory" | all (read); Admin (edit) | Doctors, Departments, today's duty (FR-19, FR-20) |
| Admin: Staff | `/admin/staff` | User menu → Admin | Admin | Accounts, Roles, Facilities, unlock (FR-3) |
| Admin: OPD Settings | `/admin/settings` | User menu → Admin | Admin | Facilities and hours, pilot live flag, Urgency Levels, Priority Categories, schedules, thresholds (FR-23, FR-24) |
| Admin: Display devices | `/admin/devices` | Admin → Settings tab | Admin | Register and revoke TVs (FR-27) |
| Admin: Paper entry | `/admin/paper-entry` | Admin, or Triage "Enter paper visit" | Triage Nurse, Admin | Back-enter outage Visits (FR-25) |
| Admin: Audit log | `/admin/audit` | Admin | Admin | Search audit (FR-26) |
| Display Board | `/board` | Opened on the TV once | registered device | Now serving and next numbers per live Facility (FR-16) |
| Queue slip | `/print/slip/[entryId]` | Triage "Print slip" | Triage Nurse, Admin | Printable slip |

**Navigation:**
- **Top nav**, icon over label: Overview, Triage, Queues, Patients, Appointments, Directory. Items a Role cannot use are hidden, not disabled.
- **Left rail:** one tile per **live** Facility, with its prefix, name and waiting count, linking to its Facility Queue. Facility Staff see only their own Facilities.
- **Header search** jumps to Patients filtered by the text.
- **Below 768px** the nav and rail move into the ☰ sheet.

Modals are one level deep at most. Every surface is a URL; filters and pages live in the URL (story 1.4).

**Composition references:** [mockups/triage.html](mockups/triage.html), [mockups/queue.html](mockups/queue.html) and [mockups/board.html](mockups/board.html), each with a `.png`. The other surfaces are built from this spine and the story 1.4 and 1.5 patterns. **The spines win on conflict.** The mockups predate the review fixes: they show single-key hints (N, R, S, C) instead of `Alt+`, "Now serving" under "Now calling" on the board, and one counter per Facility.

## Voice and Tone

The voice is plain, short and clinical-neutral, like instructions a nurse would write on a whiteboard. The interface is in English (PRD NFR-7).

| Do | Don't |
|---|---|
| "Issue queue number" | "Submit" |
| "CN-014 · 3 ahead" | "Your number has been generated successfully!" |
| "Temperature 39.2 °C is above normal (37.5 °C)." | "Invalid value" (when the value is only abnormal) |
| "Temperature must be between 30 and 45 °C." | "Error!" |
| "Senior Citizen ID not presented" (checkbox) | "Missing ID!!" |
| "No one waiting." | "Hooray, the queue is empty 🎉" |
| "Call AB-006 again?" / "Mark AB-006 as No-show?" | "Are you sure you want to proceed?" |
| Queue Numbers on public or printed surfaces; names only on staff screens | A patient name anywhere the public can see |

## Component Patterns

These are behavioral rules. Visual specs are in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Patient finder | Triage (left column), Patients | A single input matches name, Hospital Number, birthdate (`YYYY-MM-DD` or `MM/DD/YYYY`) or phone. Results update after 300 ms. ↑/↓ moves the highlight and Enter selects. Each result shows name, age, sex, Hospital Number and last Visit. A "New patient" row is always last and is reachable with the keyboard. |
| Registration form | Triage (inline, not a modal) | Only the required fields are visible, with optional fields collapsed. A required checkbox reads "Privacy notice explained to the patient" (PRD PRIV-4), and its time is stored. A possible duplicate (same name and birthdate) shows an inline "Possible match" card with **Use this record** / **Create anyway** before saving. |
| Triage form | Triage (right column) | The field order follows the nurse's routine: Chief Complaint → Vital Signs → Urgency Level → Priority Category → Facility.<br>**Vital Signs:** numeric fields with units, and Tab moves through them. Impossible values block saving with an inline error. Abnormal values show an amber warning but still save.<br>**Urgency Level:** a segmented control built from the Urgency Levels in OPD Settings, ordered by rank, with the ER-flagged level last. When the control has focus, keys `1`…`n` pick levels in that order. Level badges use the configured name; colors come from rank: rank 1 uses `{colors.urgent}`, the lowest non-ER rank uses `{colors.routine}`, and any levels in between use `{colors.abnormal}`. The ER-flagged level turns the primary button into **Direct to ER** (see ER handoff).<br>**Priority Category:** segmented and optional; only enabled categories are shown, and Pregnant only for female patients. Senior Citizen asks for the ID, with a "not presented" option.<br>**Facility:** four large tiles showing each one's waiting count. Closed or not-live Facilities are disabled, with the reason as text. |
| ER handoff | Triage | **Direct to ER** opens a confirmation: "Direct Lola Carmen to the Emergency Room? No queue number will be issued and the Visit closes." On confirm, the right column shows a red-outlined panel, "Directed to ER · Visit closed 8:14 AM", with **Next patient** (Esc). The Visit ends as *Directed to ER*. |
| Issue confirmation | Triage | After **Issue queue number**, a cyan banner shows the Queue Number in `queue-number-issued`, the Facility and "N ahead". **Print slip** is focused, so Enter prints. **Next patient** (Esc) clears the screen and returns focus to the finder. |
| Queue list | Facility Queue | Rows are in the stored order (architecture AD-6). Each row shows the Queue Number chip, patient name, age and sex, group badge, status badge, time waited, and the chief complaint truncated.<br>A Facility can have **several counters**, i.e. several staff serving at once. Every Called or Serving row is pinned at the top with the staff member's name ("Serving · Mark"). The current user's own entry comes first, with its detail panel open.<br>Row actions: **Open record**, **Call this one** (asks for a reason, which is logged), **No-show**, **Restore**.<br>**Refresh and focus:** when the 3-second refresh reorders or adds rows, keyboard focus stays on the same Queue Entry (matched by id). Focus is never moved, and the list does not scroll under the user. |
| Call controls | Facility Queue header | **Call next** is the page's orange CTA. It is disabled only when nobody is waiting, or when **the current user** already has a Called or Serving entry; the reason is shown as text. Other staff at other counters can keep calling.<br>**Recall** re-announces the user's Called number and counts calls. Once the No-show threshold is reached, **Mark No-show** is offered.<br>**Start serving** moves Called to Serving. |
| Serving panel | Facility Queue | Shows triage data (Vital Signs with abnormal flags, complaint, Priority Category) and the last 3 Visits. For Animal Bite Center and Prenatal it shows the Facility fields (PRD FR-22), then a note.<br>Footer: **Complete** (green), **Refer to…** (select a Facility, then confirm with a reason), **Book follow-up** (opens the Appointment sheet with suggested dates).<br>During the pilot, Facilities that are not live stay selectable in **Refer to…**, labeled "(not live yet)". Confirming shows "Referred to Treatment (not live yet): give the patient a paper number." No Queue Entry is created (PRD §10). |
| Appointment sheet | Serving panel, Appointments, Patient Record | A side sheet. It shows the suggested date or dates first (Animal Bite Center Day 3/7; prenatal count "4 of 8"). Doctor choice is limited to Doctors on duty that day. Closed days are disabled in the date picker. **Print appointment card** prints the patient's name, Facility and date or dates only, with no clinical data. It is separate from the Queue slip. |
| Paper-entry form | `/admin/paper-entry` | Used after an outage (PRD FR-25). The layout matches Triage, plus a **date and time** for arrival, triage and service, the **handwritten number** as text, and the **outcome** (Completed, Referred, No-show, Directed to ER). Saving shows "Entered from paper" with the entering staff member. These entries never appear on today's queue or on the board. A list of entries for the day is shown under the form. |
| Display device pairing | `/board` (TV) + `/admin/devices` | An unregistered TV at `/board` shows a 6-character pairing code and "Ask an Admin to register this screen." The Admin types the code on `/admin/devices`, names the screen ("Main waiting hall") and chooses **Register**. Within 3 s the TV loads the board. **Revoke** returns that TV to the pairing screen. |
| Data tables | Patients, Appointments, Directory, Audit log | The story 1.4 pattern: URL state, debounced search, filter selects, 10 or 25 rows per page, a live result count, and an empty state with suggestions. |
| Display Board tile | Board | Updates by polling every 3 seconds. Whenever a number's `calledAt` changes (a new call or a Recall), the tile switches to the called style for 8 seconds and plays the chime once. There are no interactive controls. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Cold load | All staff surfaces | shadcn `Skeleton` in the shape of the content (story 1.2 and 1.5 loading pattern) |
| Background refresh | Facility Queue, Overview, Board | Silent; no spinner. A new row slides in (150 ms fade, none under reduced motion). The waiting count updates in the rail |
| Stale or offline | Facility Queue, Overview | After 2 failed polls, an amber strip: "Connection lost, the list may be out of date. Retrying…" Call next is disabled until the connection is back |
| Offline | Board | Full-width dark strip: "Reconnecting…". The numbers dim instead of showing stale numbers as live (PRD FR-16) |
| Nobody waiting | Facility Queue | "No one waiting." with today's served count; Call next disabled |
| Facility closed | Triage tiles, Queue | The tile shows "Closed, opens 7:00 AM". The Queue shows today's summary read-only |
| Pre-close warning | Facility Queue | Banner 30 min before closing: "Closes at 5:00 PM. 6 still waiting." |
| Abnormal Vital Sign | Triage | Amber field, warning icon and hint text; saving is allowed |
| Impossible Vital Sign | Triage | Red inline error; saving is blocked |
| Duplicate patient | Registration | Inline "Possible match" card (see Component Patterns) |
| Conflict (someone else acted first) | Queue actions | Toast: "AB-006 was already called by Mark." The list refreshes. Never show a raw error |
| Permission denied | Any | The nav item is hidden. On direct navigation: "You don't have access to this page." with a link to Overview. No data leaks |
| Session about to expire | Any | 60 s before the 15-minute idle limit, a dialog: "You'll be signed out in 60 seconds." with **Stay signed in** (focused), announced to screen readers (WCAG 2.2.1). Background polling does not count as activity |
| Session expired | Any | A sign-in dialog opens over the current page, leaving the page and any unsaved form input in place: "Signed out after 15 minutes of inactivity. Sign in to continue." After sign-in the dialog closes and the user continues. A different user signing in on that screen gets a fresh page (unsaved input discarded) |
| Account locked | Sign in | "Account locked after 5 failed attempts. Ask an Admin to unlock it." |
| Board device not registered | Board | The pairing screen (see Display device pairing), with no queue data |
| Pilot: Facility not live | Triage tiles | Tile disabled with "Not live yet: use paper number" |
| Pilot: Facility not live | Refer menu | Selectable, labeled "(not live yet)"; see Serving panel |

## Interaction Primitives

**Keyboard-first at Triage and at the counters.** Nurses must be able to triage without touching the mouse.

- `Ctrl+K` focuses the patient finder, or the header search elsewhere.
- In the finder, `↑` `↓` `Enter` select, and `Esc` clears.
- In the triage form, `Tab` follows the visual order. Number keys set the Urgency Level only while that control has focus. `Ctrl+Enter` issues the Queue Number.
- On the issue confirmation, `Enter` prints the slip and `Esc` starts the next patient.
- On a Facility Queue:
  - `Alt+N` = Call next, `Alt+R` = Recall, `Alt+S` = Start serving, `Alt+C` = Complete.
  - Modifier shortcuts never fire inside a text field. Call next can never be triggered by a single stray key, because it puts a number on the public board.
  - Destructive or skipping actions (No-show, Call this one, Refer) always confirm.
- Single-character sequences (`g o`, `g t`, `g q`, `g p`, `g a` to go to Overview, Triage, Queues, Patients, Appointments) are **off by default**. Users can turn them on under user menu → **Keyboard shortcuts** (WCAG 2.1.4).
- `?` opens the shortcut help dialog.

**Mouse and touch:** all targets are at least 44 px. No hover-only actions; row actions are also in a "⋯" menu for tablets.

**Sound:** only the Display Board chimes, and staff screens are silent.
- The TV browser runs in kiosk mode with autoplay allowed for the board origin. This is set once during device setup and documented in the deploy story.
- If the browser still blocks audio, the board shows a small "Sound off: click to enable" corner note and keeps working visually. The visual highlight is always the primary signal.

**Banned:** infinite scroll; drag and drop; nested modals; auto-advancing the queue without a staff action; any patient data on the board or the printed slip, other than the Queue Number, Facility, date and time.

## Accessibility Floor

Behavioral rules; visual contrast is in `DESIGN.md`.

- WCAG 2.1 AA (PRD NFR-6).
- A skip link, and page titles in the form "{Surface} | OPD".
- Tab order matches reading order; `Esc` closes the topmost sheet or dialog.
- Queue changes are announced politely through `aria-live`: "CN-015 added, routine." A new Called number on the staff queue is announced the same way. The Board is visual and audio by design.
- Group, status and abnormal flags always include text, never color alone.
- Form errors are tied to their fields with `aria-describedby`. The first error gets focus on submit.
- Respects `prefers-reduced-motion` (no slide or flash; the board shows a static highlight instead of flashing).
- A text-size increase to 200% keeps Triage usable; the columns stack.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `≥ lg` (1024px+) | Full shell. Triage in two columns. Facility Queue with the list and the Serving panel side by side |
| `md` (768–1023px), counter tablets | Rail visible; Triage stacks (patient, then form); the Serving panel becomes a bottom sheet |
| `< md` | ☰ sheet for nav and rail; single column; tables scroll inside their own focusable region |
| TV 1920×1080 | Board only: a 2×2 Facility grid (or 1×N for fewer live Facilities); no cursor; the page never scrolls |
| Print | The slip route prints the hospital name, Facility, Queue Number (large), date and time, and "Please wait for your number on the screen." |

## Inspiration & Anti-patterns

- **Lifted from the reference screenshot (story 1.5):** the top icon nav, the rail, the gray page, white cards, the cyan banner with a tab, and uppercase green and orange buttons.
- **Lifted from bank and government queue boards:** now-serving plus next numbers per window, with a flash and a chime on call.
- **Rejected: patient self-service kiosk.** It is out of scope for v1 (PRD §7). Triage stays nurse-driven.
- **Rejected: drag-to-reorder the queue.** The order is policy (PRD FR-9); the only exception is **Call this one** with a logged reason.
- **Rejected: showing names on the board**, even partial ones or initials. Privacy wins over convenience.

## Key Flows

### Flow 1: Triage of a senior with a fever (Nurse Liza, Monday 8:10 AM, PRD UJ-1)

1. Liza is on `/triage`, and focus is in the finder. Lola Carmen, 68, steps up.
2. Liza types "carmen 1958". Two matches appear; she arrows to the one with the right barangay and presses Enter. The left column shows her record and last Visit.
3. Focus jumps to Chief Complaint: "fever 3 days". She tabs through the Vital Signs, and temperature 39.2 turns amber: "above normal".
4. She leaves the Urgency Level at Routine, picks **Senior Citizen** (the ID is already on file), and chooses the **Consultation** tile ("9 waiting").
5. `Ctrl+Enter`. **Climax:** the cyan banner shows **CN-014** in large mono type, "Consultation · 2 ahead (priority)". Enter prints the slip. Lola Carmen takes it and sits down facing the TV.
6. `Esc`: the screen is clean and focus is back in the finder, all in under 3 minutes (PRD SM-1).

**Failure:** Liza typed 93.2 for the temperature. The error "must be between 30 and 45 °C" blocks issuing the number, and focus returns to the field.

**Failure (emergency):** the next patient has chest pain and an SpO₂ of 86%. Liza picks the Emergency level, and the button becomes **Direct to ER**. She confirms "No queue number will be issued", the panel shows "Directed to ER · Visit closed", and she walks the patient to the ER. `Esc` returns her to the finder.

### Flow 2: Serving the Animal Bite Center queue (Staff Mark, PRD UJ-2)

1. Mark's `/queues/animal-bite-center` shows 4 waiting; the top row is `AB-006` with a Routine badge.
2. He presses `Alt+N`. AB-006 becomes Called, and the TV tile turns gold with AB-006 and a chime.
3. The patient arrives and he presses `Alt+S`. The Serving panel opens with the Vital Signs and the Animal Bite Center fields.
4. He records: dog, stray, left calf, Category III, PVRV intradermal Day 0, ERIG given.
5. **Book follow-up:** the sheet pre-selects **Day 3 (Thu)** and **Day 7 (Mon)**. He confirms both.
6. **Complete** (green). **Climax:** AB-006 leaves the list and the board moves on. The patient leaves with a printed appointment card showing the Facility and their Day 3 and Day 7 dates, and Mark's list shows AB-007 at the top.

**Failure:** AB-006 doesn't come forward. `Alt+R` recalls it, and because the call time changed, the board highlights it and chimes again. After the third call, **Mark No-show** appears; he confirms, and the row drops to a collapsed "No-show (restore)" section.

### Flow 3: The waiting area (Grace, pregnant, holding PN-004, PRD UJ-3)

1. The TV shows four tiles. Prenatal: now serving **PN-003**, next PN-004, PN-005.
2. **Climax:** the Prenatal tile flashes gold with **PN-004** and a chime. Grace walks to the Prenatal counter. No name was shown or called out.

**Failure:** the network drops. The board shows "Reconnecting…" and dims the numbers, so nobody walks up on a stale call.

### Flow 4: Referral from Treatment to Consultation (PRD UJ-4)

1. Treatment staff finish wound care and choose **Refer to… → Consultation**, with the reason "needs doctor review".
2. **Climax:** the confirmation shows the new number **CN-021**, which keeps the patient's Senior priority. The staff member tells the patient to watch for CN-021. The Treatment row shows "Referred → CN-021".

### Flow 5: Appointment check-in (returning prenatal patient, PRD UJ-5)

1. On `/triage`, a **Today's appointments** tab lists booked patients for live Facilities.
2. The nurse selects the patient and chooses **Check in**. The triage form opens with the patient loaded and the Facility preset to Prenatal.
3. **Climax:** the Vital Signs are recorded as usual, and **PN-009** is issued. The Appointment shows *Checked in*, and later *Completed*.

### Flow 6: The morning check (Admin Ana, PRD UJ-6)

1. The Overview shows four Facility cards, each with waiting, serving, served, and average and longest wait. The cyan banner reads "31 waiting · longest Routine wait 52 min".
2. On `/directory`, the **On duty today** tab shows Consultation has no Doctor for the afternoon. She opens **Duty days** and adds Dr. Santos for Friday afternoons.
3. She opens `/admin/staff`, sees that nurse Joy is **Locked**, and chooses **Unlock**.
4. **Climax:** Joy signs in at the triage desk a minute later. The duty change and the unlock both appear in the audit log.

## Open items

- `[ASSUMPTION]` Facilities can have several counters. Confirm the number of counters per Facility with the OPD head, since it sets how many now-serving numbers each board tile must fit (the design fits up to 3).
- `[ASSUMPTION]` `Alt+` queue shortcuts. Validate with counter staff during the pilot.
- The slip and appointment-card layout depend on the printer (a PRD open question). The print routes target both 58 mm and A4.
