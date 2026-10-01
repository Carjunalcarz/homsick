---
name: Hospital OPD Management System
description: OPD patient-flow system for nurses and staff (triage, per-facility queues, waiting-area board). shadcn/ui (radix-nova) on Next.js + Tailwind 4; this DESIGN.md specifies the brand layer on top of shadcn, carried over from the story 1.5 reference design.
status: final
updated: '2026-09-26'
sources:
  - ../../prds/prd-Dashboard-2026-09-26/prd.md
  - ../../architecture/architecture-Dashboard-2026-09-26/ARCHITECTURE-SPINE.md
  - ../../../implementation-artifacts/1-5-reference-design-restyle.md
  - src/app/globals.css
colors:
  # Light theme. Existing tokens in src/app/globals.css (story 1.5) are the source; values repeated here as the contract.
  background: '#ECF0F3'
  foreground: '#333A40'
  card: '#FFFFFF'
  muted: '#EEF1F4'
  muted-foreground: '#5B6770'
  border: '#E3E7EB'
  input: '#C9D0D6'
  band: '#F7F7F7'
  primary: '#00798C'
  primary-hover: '#006373'
  primary-foreground: '#FFFFFF'
  banner: '#00838F'
  banner-foreground: '#FFFFFF'
  success: '#2E7D32'
  success-foreground: '#FFFFFF'
  cta: '#C2410C'
  cta-foreground: '#FFFFFF'
  destructive: '#C62828'
  positive: '#047857'
  negative: '#B91C1C'
  warning: '#92400E'
  # Clinical and queue semantics (new). Each is a text/icon color on card or band, at least 4.5:1.
  urgent: '#B91C1C'
  priority: '#6A1B9A'
  routine: '#5B6770'
  abnormal: '#B45309'
  # Dark theme counterparts: every light token has one (values match src/app/globals.css .dark)
  background-dark: '#111820'
  foreground-dark: '#E6EBEF'
  card-dark: '#1A232D'
  muted-dark: '#222D38'
  muted-foreground-dark: '#9AA8B4'
  border-dark: '#2C3845'
  input-dark: '#3A4856'
  band-dark: '#1F2933'
  primary-dark: '#4DD0E1'
  primary-hover-dark: '#80DEEA'
  primary-foreground-dark: '#111820'
  banner-dark: '#00838F'
  banner-foreground-dark: '#FFFFFF'
  success-dark: '#81C784'
  success-foreground-dark: '#111820'
  cta-dark: '#FB8C3C'
  cta-foreground-dark: '#111820'
  destructive-dark: '#EF9A9A'
  positive-dark: '#34D399'
  negative-dark: '#F87171'
  warning-dark: '#FBBF24'
  urgent-dark: '#F87171'
  priority-dark: '#CE93D8'
  routine-dark: '#9AA8B4'
  abnormal-dark: '#FBBF24'
  # Display Board (TV): always this scheme, independent of the staff theme toggle
  board-background: '#0B1F26'
  board-foreground: '#FFFFFF'
  board-muted: '#A9C3CA'
  board-called: '#FFD54F'
  board-called-foreground: '#0B1F26'
typography:
  # Roboto (variable) for everything; Roboto Mono for Queue Numbers and Hospital Numbers.
  page-title:
    fontFamily: Roboto
    fontSize: 30px
    fontWeight: '300'
    lineHeight: '1.2'
  section-title:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.4'
  body:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  button:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: '700'
    letterSpacing: 0.04em
    textTransform: uppercase
  queue-number:
    fontFamily: Roboto Mono
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1'
  queue-number-issued:
    fontFamily: Roboto Mono
    fontSize: 64px
    fontWeight: '700'
    lineHeight: '1'
  board-now-serving:
    fontFamily: Roboto Mono
    fontSize: 120px
    fontWeight: '700'
    lineHeight: '1'
  board-next:
    fontFamily: Roboto Mono
    fontSize: 48px
    fontWeight: '500'
    lineHeight: '1'
  board-facility:
    fontFamily: Roboto
    fontSize: 40px
    fontWeight: '500'
    lineHeight: '1.1'
rounded:
  sm: 2px
  md: 4px
  lg: 6px
  full: 9999px
spacing:
  # Tailwind 4-based scale inherited. Named layout values only.
  page-padding: 32px
  page-padding-mobile: 16px
  card-padding: 24px
  header-height: 72px
  rail-width: 96px
  touch-target: 44px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
    height: '{spacing.touch-target}'
    typography: '{typography.button}'
  button-success:
    background: '{colors.success}'
    foreground: '{colors.success-foreground}'
    radius: '{rounded.md}'
    height: '{spacing.touch-target}'
    typography: '{typography.button}'
  button-cta:
    background: '{colors.cta}'
    foreground: '{colors.cta-foreground}'
    radius: '{rounded.md}'
    height: '{spacing.touch-target}'
    typography: '{typography.button}'
  banner:
    background: '{colors.banner}'
    foreground: '{colors.banner-foreground}'
    radius: '0'
  section-band:
    background: '{colors.band}'
    border: '1px solid {colors.border}'
  card:
    background: '{colors.card}'
    radius: '{rounded.lg}'
    shadow: '0 1px 3px rgb(0 0 0 / 0.06)'
  queue-number-chip:
    typography: '{typography.queue-number}'
    background: '{colors.muted}'
    radius: '{rounded.md}'
  group-badge-urgent:
    foreground: '{colors.urgent}'
    border: '1px solid {colors.urgent}'
    radius: '{rounded.full}'
  group-badge-priority:
    foreground: '{colors.priority}'
    border: '1px solid {colors.priority}'
    radius: '{rounded.full}'
  group-badge-routine:
    foreground: '{colors.routine}'
    border: '1px solid {colors.border}'
    radius: '{rounded.full}'
  vital-abnormal:
    foreground: '{colors.abnormal}'
  board-tile:
    background: '{colors.board-background}'
    foreground: '{colors.board-foreground}'
  board-tile-called:
    background: '{colors.board-called}'
    foreground: '{colors.board-called-foreground}'
---

## Brand & Style

A calm, flat, orderly admin tool for a busy public hospital OPD. The look is carried over from the reference design adopted in story 1.5: a white top bar with icon-over-label navigation, a narrow left rail, a light gray page, white cards with a faint shadow, a cyan highlight banner, and solid uppercase action buttons (green for "go", orange for the page's one call to action). Roboto throughout.

The posture is **clarity under pressure**. Nurses glance at these screens between patients. Numbers, names and states must read in one look, and color never carries meaning alone. There is nothing decorative beyond the one green corner shape on promo-style side cards, carried over from the reference.

The system inherits shadcn/ui (radix-nova) for every control. This file specifies only the brand layer and the clinical and queue semantics that shadcn lacks.

## Colors

- **Brand cyan** (`#00798C` light / `#4DD0E1` dark) is the primary color: primary buttons, links, the active nav item and its underline bar, focus rings. **Banner cyan** (`#00838F`) is used only for highlight banners with white text.
- **Go green** (`#2E7D32` / `#81C784`) marks forward actions that complete work: *Issue queue number*, *Complete*, *Search orders*-style secondary CTAs. At most one per card.
- **CTA orange** (`#C2410C` / `#FB8C3C`) marks at most one page-level action, top right (e.g. *New patient* on Patients, *Call next* on a Facility Queue).
- **Queue group colors** are always paired with a text label and an icon:
  - **urgent red** (`#B91C1C`);
  - **priority violet** (`#6A1B9A`), for Senior Citizen, PWD and Pregnant;
  - **routine gray** (`#5B6770`).
- **Abnormal amber** (`#B45309`) flags out-of-range Vital Signs, always together with an icon and a text hint.
- **Display Board** uses its own fixed dark scheme (`#0B1F26` background, white text, `#FFD54F` for the number just called). It ignores the staff light/dark toggle, because a TV across a hall needs maximum contrast.
- **Contrast:** all text pairs are at least 4.5:1, and large Display Board numerals are far above that. These colors are deeper than the reference screenshot's, which failed contrast; see the story 1.5 table.
- **Dark theme:** every token has a `-dark` value. Filled buttons in dark mode use **dark text** (`#111820`) on the lighter green, orange and cyan fills, because white text on them fails.

Key pairs (measured):

| Pair | Light | Dark |
|---|---|---|
| foreground / background | 10.1:1 | 14.9:1 |
| muted-foreground / background | 5.1:1 | 7.3:1 |
| muted-foreground / muted | 5.1:1 | 5.8:1 |
| primary-foreground / primary | 5.1:1 (white on `#00798C`) | 9.7:1 (`#111820` on `#4DD0E1`) |
| banner-foreground / banner | 4.5:1 | 4.5:1 |
| success-foreground / success | 5.1:1 | 8.9:1 (`#111820` on `#81C784`) |
| cta-foreground / cta | 5.2:1 | 7.6:1 (`#111820` on `#FB8C3C`) |
| urgent / card, band | 6.5:1, 6.0:1 | 5.7:1 |
| priority / card | 9.4:1 | 6.7:1 |
| abnormal / card, band | 5.0:1, 4.7:1 | 9.5:1 |
| board-foreground / board-background | 17.0:1 | (fixed scheme) |
| board-called-foreground / board-called | 12.0:1 | (fixed scheme) |

Avoid: red for anything other than Urgent and destructive; new hues without a semantic role; gradients.

## Typography

Roboto variable (300–700) for all UI; Roboto Mono for identifiers (Queue Numbers, Hospital Numbers).

| Role | Style | Where |
|---|---|---|
| `page-title` | 30px, weight 300 | Page headings ("Triage", "Consultation queue") |
| `section-title` | 16px, weight 500 | Card headings |
| `body` / `label` | 14px, weight 400 / 500 | Everything else. Inputs use 16px on phones to prevent zoom |
| `button` | 14px, bold, uppercase, tracking 0.04em | Primary, success and CTA buttons only. Secondary and ghost buttons stay sentence case |
| `queue-number` | Mono, 28px, weight 600 | Queue lists |
| `queue-number-issued` | Mono, 64px, weight 700 | The confirmation after triage |
| `board-*` | Mono 120px now-serving, 48px next; facility names 40px | Display Board, readable from 6 m on a 1080p TV |

## Layout & Spacing

- **Shell (story 1.5):**
  - a 72px white top bar with the logo, header search, page nav (icon over label), theme toggle and user block;
  - a 96px left rail;
  - `main` padding of 32px (16px on phones).
- **Left rail:** shows the four **Facility shortcuts** (Prenatal, Animal Bite Center, Treatment, Consultation), each with its waiting count. Admins also see an Admin shortcut.
- **Content grid:** 12 columns at `lg`. The standard composition is a wide card (8 columns) next to a narrow card (4 columns), then full-width table cards with a gray band header.
- **Triage** is a two-column working layout at `lg`: patient on the left, triage form on the right. It stacks at smaller widths.
- **The Display Board** has no shell. It is a full-bleed grid of four Facility tiles (2×2 at 16:9) with a ticker row for the next numbers.

## Elevation & Depth

Flat, as in the reference. Cards have a single faint shadow (`0 1px 3px rgb(0 0 0/0.06)`) and a hairline ring. Popovers, selects and dialogs use shadcn's shadows. No other elevation.

## Shapes

Small radii: 2px, 4px on buttons, inputs and chips, and 6px on cards and dialogs. Pills (`rounded.full`) are used only for queue group badges and status badges.

## Components

shadcn components used as they are: `Button` (secondary, outline and ghost variants), `Input`, `Select`, `Table`, `Sheet`, `Dialog`, `AlertDialog`, `Tooltip`, `Skeleton`, `Badge`, `Card`, `Tabs`, `Sonner`/`Toast`, `Command`.

Brand-layer components:

- **Action buttons:** `button-primary`, `button-success` and `button-cta`, 44px tall, with uppercase bold labels.
- **Banner:** cyan, full card width, white text. It is used for the one headline fact on a surface, e.g. the issued Queue Number, or "12 waiting · longest 48 min". It may carry a white "tab" on its lower edge that leads into the section below.
- **Queue Number chip:** mono numeral on a muted chip. The same shape is used in lists, on the triage confirmation and on printed slips.
- **Group badge:** an outlined pill with icon and text:
  - "Urgent" with an alert icon;
  - "Senior", "PWD" or "Pregnant" with the matching icon;
  - "Routine".

  The text is always present.
- **Vital Sign field:** a numeric input with a unit suffix. When the value is out of range it shows an amber border, a warning icon and the text "Above normal (37.5 °C max)".
- **Status badge:** a filled muted pill with text: Waiting, Called, Serving, Completed, Referred, No-show, Cancelled.
- **Board tile:** Facility name and prefix. **Now serving** shows every Called or Serving number (one per counter), with the newest in `board-now-serving` and the others beside it in `board-next` size. Below that, up to three **Next** numbers.

  When a number is called or recalled, the whole tile switches to `board-tile-called`: gold background, dark text and a "Now calling" tag. It stays that way for 8 seconds, then returns to `board-tile`. Under reduced motion it switches without a flash animation.

Visual references: [mockups/triage.png](mockups/triage.png), [mockups/queue.png](mockups/queue.png), [mockups/board.png](mockups/board.png). This file wins on conflict.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Pair every color meaning with text and an icon | Signal Urgent, priority or abnormal by color alone |
| Keep one orange CTA per page and one green action per card | Put several filled buttons side by side |
| Use Roboto Mono for every Queue Number and Hospital Number | Mix number fonts between screens |
| Keep the Display Board on its fixed dark scheme, numbers only | Show names, complaints or priority on the board |
| Use deeper, AA-checked shades of the reference hues | Reintroduce the reference's light cyan, green or orange behind white text |
