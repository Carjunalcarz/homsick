# Spine Pair Review — Hospital OPD Management System

Reviewed: `DESIGN.md`, `EXPERIENCE.md` (both `status: draft`, 2026-09-26), against `prd.md` (UJ-1..UJ-6, FR-1..FR-27, NFR, PRIV), `ARCHITECTURE-SPINE.md` and `.memlog.md`. Lenses: the rubric walker (`validate.md`, Pass 1 + Pass 2), DESIGN.md spec conformance (`design-md-spec.md`), and accessibility (WCAG 2.1 AA, regulated health context, keyboard-first triage, TV Display Board, printed slip).

## Overall verdict

The pair is well shaped, concise and mostly consistent with the PRD and architecture. The IA covers every FR, and the privacy stance on the board and slip is strong. It is **not ready for story-dev as the contract**, for four reasons:

- The dark theme token set is incomplete, and two dark button pairs fail contrast.
- Two Display Board behaviors cannot be built as written: the called-state colors, and a Recall re-flash that `DisplayBoardDTO` cannot signal.
- Several keyboard and session behaviors fail WCAG 2.1 A/AA criteria.
- A handful of PRD edge paths have no surface or flow: Direct to ER, a referral to a not-live Facility, the privacy consent, device pairing, and paper entry.

All of these can be fixed in one Update pass.

Severity counts: **critical 1 · high 7 · medium 10 · low 8**.

## 1. Flow coverage — thin

Checked each UJ-1..UJ-6 against the Key Flows for a named protagonist, numbered steps, a climax and a failure path, and each FR-1..FR-27 for a surface and a journey.

| UJ | Flow | Protagonist | Steps | Climax | Failure path |
|---|---|---|---|---|---|
| UJ-1 | Flow 1 | Liza | yes | yes | Partial: covers only an impossible vital. Missing the PRD edge cases "not found → register" and "far outside normal → Urgent / Direct to ER" |
| UJ-2 | Flow 2 | Mark | yes | yes | yes (Recall → No-show). Restoring a No-show is only implied |
| UJ-3 | Flow 3 | Grace | yes | yes | yes (offline) |
| UJ-4 | Flow 4 | unnamed "Treatment staff" | yes | yes | **none** (e.g. a target Facility that is closed or not live) |
| UJ-5 | Flow 5 | unnamed "the nurse" | yes | yes | **none** (e.g. an Appointment for a closed Facility, or a patient who arrives late) |
| UJ-6 | Flow 6 | Ana | yes | yes | None, and the PRD step "confirms the Doctors on duty" is **missing** |

FRs with a surface but no journey or behavioral spec: FR-3 (create or deactivate an account; only unlock is shown), FR-6 (editing demographics), FR-19/FR-20 (Directory), FR-23/FR-24 (Settings, including the RA 9994/10754 warning and the blocked Facility deactivation), FR-25 (paper entry), FR-26 (audit search), FR-27 (device registration). Of these, FR-25 and FR-27 carry real interaction design risk. The others can use the Data tables pattern.

### Findings
- **high** UJ-1 edge path "Direct to ER" has no outcome state. The Triage form says the primary button becomes **Direct to ER**, but nothing specifies what happens next: whether it confirms, whether a Queue Number is issued (it must not be, per FR-8), what the confirmation shows, or how focus returns. In a regulated triage context this is the highest-stakes branch. (EXPERIENCE.md § Component Patterns › Triage form; § State Patterns; § Key Flows › Flow 1). *Fix:* add an ER confirmation AlertDialog ("Direct Lola Carmen to the Emergency Room? No queue number will be issued."), then a red-labeled confirmation panel that says "Directed to ER · Visit closed", then Esc → next patient. Add it as a second failure path in Flow 1.
- **medium** UJ-1 "patient not found → register" is not walked. The Registration form is specified but no flow exercises the "New patient" row → register → triage path against SM-1's 3-minute target. (Flow 1). *Fix:* add a failure or branch path to Flow 1: "No match → ↓ to New patient → Enter → required fields → Tab into Chief Complaint."
- **medium** UJ-6 omits "confirms the Doctors on duty for each Facility" (FR-20). (Flow 6). *Fix:* add a step: Overview Facility card or `/directory` "On duty today" filter → Ana checks each Facility.
- **medium** Flows 4 and 5 lack named protagonists and failure paths. (Flows 4, 5). *Fix:* name them (e.g. "Nurse Rico at Treatment", "Nurse Liza"). Add a failure path for a referral to a closed Facility, and for an Appointment check-in when the Facility is closed.
- **medium** FR-27 device registration has no journey. "Opened on the TV once" doesn't say how the httpOnly device token (AD-11) gets onto a TV that has no staff session. (IA › Display Board, Admin: Display devices). *Fix:* specify a pairing flow. The TV shows a 6-digit code on the "not registered" screen, the Admin enters it at `/admin/devices` and names the device, and the TV picks up the token on its next poll. Revoke shows "This screen is no longer authorized" within one poll.
- **medium** FR-25 paper entry has no behavioral spec: the real date and times, a handwritten `paper_number` text field (AD-16), the "Entered from paper" marker, and no Queue Number. (IA › Admin: Paper entry). *Fix:* add a Component Patterns row for the "Paper visit form" and a state for the "Entered from paper" badge on the Patient Record.

## 2. Token completeness — broken

Extracted 42 color tokens, 10 typography roles, 4 radii, 6 spacing tokens and 13 components. Every `{path}` reference in the component objects resolves. The prose uses literal hexes, not `{colors.*}` references.

### Findings
- **critical** Light/dark pairs are incomplete. These tokens have **no dark counterpart**: `muted`, `muted-foreground`, `border`, `input`, `band`, `banner`, `banner-foreground`, `success-foreground`, `cta-foreground`, `destructive`, `positive`, `negative`, `warning`, `routine`. `.memlog.md` claims "(+ dark counterparts)" for all four clinical tokens, but `routine-dark` is missing. The existing dark pairs also fail as buttons: `button-success` and `button-cta` take `success-foreground` / `cta-foreground` (#FFFFFF). On `success-dark` #81C784 that is about **2.0:1**, and on `cta-dark` #FB8C3C about **2.4:1**, both under the 4.5:1 floor (WCAG 1.4.3). The Colors section claims "all text pairs are at least 4.5:1". (DESIGN.md frontmatter `colors`; § Colors). *Fix:* add a `-dark` value for every color token, including `success-foreground-dark` / `cta-foreground-dark` (e.g. #111820), and add a contrast table listing each load-bearing pair in both themes with its ratio.
- **high** `board-called` is ambiguous and fails if it is applied to the background. "The tile flashes to `board-called`" reads as a background change. White numerals (`board-foreground`) on #FFD54F are about **1.4:1**. As a text color on `board-background`, #FFD54F is about 12:1, which is fine. (DESIGN.md § Components › Board tile; `components.board-tile`). *Fix:* add `board-called-foreground: '#0B1F26'` and a `board-tile-called` component entry (background `{colors.board-called}`, foreground `{colors.board-called-foreground}`), or state explicitly that only the numeral color changes.
- **low** `typography.button.textTransform` is not a spec typography property (the allowed set is fontFamily, fontSize, fontWeight, lineHeight, letterSpacing). (DESIGN.md frontmatter). *Fix:* move uppercase into the `button-*` component tokens or the prose.
- **low** Some components used in prose have no token entry: status badge, Vital Sign field (border and icon), banner "tab", rail Facility shortcut, triage Facility tile, board ticker, and connection strip. The Queue Number chip has no foreground. The printed slip numeral size is not tokenized. (DESIGN.md frontmatter `components`). *Fix:* add `status-badge`, `vital-field-abnormal`, `facility-tile`, `rail-shortcut`, `connection-strip` and `slip-number` entries.

## 3. Component coverage — thin

| Component | DESIGN.md.Components | EXPERIENCE.md.Component Patterns |
|---|---|---|
| Action buttons | yes | implicit only |
| Banner | yes | via Issue confirmation |
| Queue Number chip | yes | via Queue list |
| Group badge | yes | **no** (no rule for which badge wins when Urgent + Senior) |
| Vital Sign field | yes | inside Triage form |
| Status badge | yes (QueueStatus only) | **no** |
| Board tile / Display Board tile | yes | yes (names differ) |
| Patient finder, Registration form, Triage form, Issue confirmation, Queue list, Call controls, Serving panel, Appointment sheet, Data tables | **no visual spec** (shadcn defaults assumed) | yes |
| Triage Facility tile, Urgency segmented control, rail Facility shortcut, connection strip | **no** | partial |

### Findings
- **medium** Group badge labels are hard-coded ("Urgent", "Senior", "PWD", "Pregnant", "Routine"), but Urgency Levels are Admin-renamable and re-rankable (FR-24), and the queue stores a snapshot (AD-6). The spines don't say which badge shows when an entry is both Urgent and Senior, or how an added rank is colored. (DESIGN.md § Components › Group badge; EXPERIENCE.md › Queue list). *Fix:* badges render the snapshotted Urgency Level name for group 1 (color `urgent`) and the Priority Category for group 2. When both apply, show the group badge plus a secondary Priority Category chip.
- **medium** The Urgency shortcut "keys 1/2/3" assumes the default 3-level scale. FR-7 notes that ESI has 5 levels. (EXPERIENCE.md › Triage form; § Interaction Primitives). *Fix:* "digit keys 1–n select levels in rank order; the ER-flagged level is always last and requires Enter to confirm."
- **low** Status badges cover QueueStatus only. AppointmentStatus (Booked, Checked in, Missed) and VisitStatus (Directed to ER, Entered from paper) are shown on screens but have no badge spec. (DESIGN.md § Components › Status badge). *Fix:* list all three unions, following AD-15.
- **low** Naming drift: "Board tile" / "Display Board tile" / `board-tile`; "Queue slip" / "Printed Queue slip"; "Facility shortcuts" / "left rail tiles". *Fix:* pick one name each and use it everywhere.

## 4. State coverage — adequate

The strong areas are cold load, background refresh, stale/offline, empty queue, closed, pre-close, conflict, permission denied, locked, and unregistered board.

### Findings
- **high** A single Serving slot is assumed. "Call next … disabled when … someone is already Serving" and "the Serving row is pinned" assume one server per Facility. FR-11 ("two staff pressing Call next at the same moment") and FR-16 ("Called or Serving Queue Numbers", plural) imply multiple counters per Facility, especially Consultation. As written, a second nurse at Consultation cannot call anyone. (EXPERIENCE.md › Call controls, Queue list). *Fix:* scope the disable to the *current user's* active Called/Serving entry, show every Serving row with the staff name, and confirm the counter count with the OPD head.
- **high** The pilot "not live" referral contradicts the PRD. The Refer menu disables not-live Facilities, but PRD §10 says a referral to a not-live Facility is **recorded as a Referral outcome naming the target, without a Queue Entry**. (EXPERIENCE.md § State Patterns › Pilot: Facility not live). *Fix:* keep the Facility selectable in Refer. On confirm, show "Referred to Prenatal (not live yet): give a paper number", with no Queue Number.
- **high** The session timeout has no warning, and its data-retention promise can't hold. A redirect to Sign in discards page memory, so "unsaved triage input is kept in the page" is not achievable as written. Counter screens idle-poll without refreshing the session (AD-9), so a nurse watching the queue is signed out every 15 minutes with no warning (WCAG 2.2.1 Timing Adjustable, Level A). (EXPERIENCE.md § State Patterns › Session expired; Open items). *Fix:* show a warning dialog 60 s before expiry ("Stay signed in"). On expiry, re-authenticate **in place** in a dialog that keeps the form mounted, and fall back to a redirect only on a full page load.
- **medium** Facility Queue refreshes have no focus rule. When a 3 s poll reorders or removes rows, keyboard focus and the row-action menu can jump or be lost (WCAG 2.4.3). (EXPERIENCE.md § State Patterns › Background refresh). *Fix:* keep focus on the same entry id. If the entry left the list, move focus to the list heading and announce it ("AB-006 was completed by Mark").
- **low** Missing states:
  - the end-of-day "Cancelled (end of day)" rows;
  - the board offline threshold (the staff side uses 2 failed polls; the board has none);
  - the FR-24 "legally required" warning;
  - the FR-23 blocked Facility deactivation;
  - the Category I "no follow-up" state in the Appointment sheet;
  - the Triage Nurse's view of the left rail. The rail links to Facility Queues, which that Role is denied.

  *Fix:* add a row for each. The rail shows counts without links for Triage Nurses.

## 5. Visual reference coverage — thin

There are no `mockups/`, `wireframes/` or `imports/` folders. Both spines lean on "the story 1.5 reference screenshot" and "the story 1.5 table" (contrast) without linking to them. Neither spine states that the spines win on conflict.

### Findings
- **low** Unlinked references. (DESIGN.md § Brand & Style, § Colors). *Fix:* link `1-5-reference-design-restyle.md` sections inline, and add one line: "Where the spines and the reference screenshot disagree, the spines win."

## 6. Bloat & overspecification — strong

Tight. The tables carry the load. There is minor restatement of PRD scope in Inspiration › Rejected (acceptable, since it records decisions). The pixel values in Layout duplicate `spacing` tokens (72px, 96px, 32px). *Fix (low):* cite `{spacing.header-height}` and the other tokens instead.

## 7. Inheritance discipline — adequate

UJ IDs are cited and Glossary terms are used verbatim (Visit, Queue Entry, Urgency Level, Priority Category).

### Findings
- **medium** Flow 2 contradicts the slip privacy rule. "The patient leaves with a slip showing their next dates" conflicts with Interaction Primitives › Banned ("any patient data on … the printed slip, other than the Queue Number, Facility, date and time"), and no appointment-slip surface exists. (EXPERIENCE.md Flow 2 step 6). *Fix:* either add an "Appointment card" print route (Facility, dates, Hospital Number, and no clinical data, handed privately), or change the step to staff writing the dates on the patient's card.
- **medium** PRIV-4 consent is missing from Registration. The architecture stores a consent timestamp on `patients`, but the Registration form has no privacy-notice acknowledgement. (EXPERIENCE.md › Registration form). *Fix:* add a required "Privacy notice given to patient" checkbox, with the notice text one click away, recorded with the staff member and time.
- **low** The `sources` entry `src/app/globals.css` does not resolve relative to the spine folder. The other sources are relative. (DESIGN.md frontmatter). *Fix:* use `../../../../src/app/globals.css`.
- **low** FR-21 fields are partial. Visits triaged and No-shows are in the PRD but absent from the Overview purpose and Flow 6. (IA › OPD Overview). *Fix:* list them.

## 8. Shape fit — strong

DESIGN.md sections are in canonical order. EXPERIENCE.md has all the required defaults, plus Responsive & Platform (triggered by the TV and print surfaces) and Inspiration (triggered by the reference and the rejected patterns). Open items is an invented section that earns its place.

## Accessibility lens (WCAG 2.1 AA, regulated)

- **high** Character-key shortcuts break WCAG 2.1.4 (Level A). `N` / `R` / `S` / `C`, `/`, and the `g x` sequences are active page-wide outside text fields, with no way to turn them off or remap them. A stray `N` also calls a patient onto a public screen. (EXPERIENCE.md § Interaction Primitives). *Fix:* add a per-user "Keyboard shortcuts" on/off toggle in the user menu, list the keys in a `?` help dialog, and make `N` (Call next) require the queue region to have focus or a modifier key (e.g. `Alt+N`).
- **high** The board's Recall re-flash cannot be driven by `DisplayBoardDTO`. AD-11 exposes only Facility names, Queue Numbers and status. A Recall leaves the status `called`, so the board can't detect it, and Flow 2's failure path ("the board flashes again") is unbuildable. (EXPERIENCE.md Flow 2 failure; Display Board tile). *Fix:* add a non-personal `calledAt` (or `callCount`) to the DTO through an architecture Update to AD-11, and flash plus chime whenever it changes.
- **medium** Board audio relies on a first-load click on an unattended, cursorless TV. After any power cycle the chime is silently lost. (§ Interaction Primitives › Sound). *Fix:* configure the TV browser's kiosk/autoplay policy at registration, and show a persistent small "Sound off: tap to enable" corner badge whenever audio is blocked, so staff notice.
- **medium** The board offers nothing for low-vision or blind patients beyond a generic chime. The PRD does not require more, but the priority groups include seniors and PWDs. *Fix:* record it as a v2 option (spoken "PN-004, Prenatal" via the SpeechSynthesis API, numbers only). Keep the flash visible and within the WCAG 2.3.1 three-flashes limit: one 3 s transition, not strobing.
- **low** The reflow floor is stated as 375px. WCAG 1.4.10 requires 320 CSS px at 400% zoom. (Foundation). *Fix:* change it to 320px.
- **low** The printed slip has no minimum sizes. *Fix:* Queue Number at least 28pt bold mono, other text at least 10pt, black on white, no color dependence. Test at 58 mm and A4.

Keyboard-first triage is otherwise well specified: finder arrow/Enter/Esc, Tab order, Ctrl+Enter, focus returning to the error field, `aria-describedby`, and `aria-live` for queue changes.

## Architecture consistency

| Check | Result |
|---|---|
| Polling 3 s (AD-10) | Consistent (board and staff). The stale state after 2 failed polls (~6 s) is reasonable. The board's offline threshold is unstated |
| Display Board DTO numbers-only (AD-11) | Consistent in content. **Recall re-flash not expressible** (see above) |
| Statuses (AD-15) | Queue statuses match the `QueueStatus` union. Appointment and Visit statuses are used but have no badge spec |
| Roles (FR-2 / AD-4) | IA roles match the matrix. Gap: the Triage Nurse's rail links to denied Facility Queues. "Hidden, not disabled" is correctly marked as cosmetic |
| Sessions (AD-9) | The idle-poll logout is not surfaced in UX (see State coverage) |
| Snapshot labels (AD-6) | Hard-coded badge labels conflict with snapshotted, renamable Urgency Levels |

## Mechanical notes

- Name inconsistencies: Board tile / Display Board tile / `board-tile`; Queue slip / Printed Queue slip; Facility shortcuts / left rail tiles.
- Broken or unresolvable reference: DESIGN.md `sources: src/app/globals.css`.
- Frontmatter: both spines have `name`, `status`, `updated` and `sources`. EXPERIENCE.md has no `description` (optional).
- There are no Mermaid diagrams, so there is nothing to validate. A state diagram for Queue Entry would help story-dev but is optional.
- Every `{path.to.token}` in the component objects resolves. The prose uses literal hexes instead of token references, so the prose and tokens can drift.
