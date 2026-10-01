---
title: 'Hospital Management System — PRD'
status: final
created: '2026-09-26'
updated: '2026-09-26'
---

# PRD: Hospital OPD Management System
*Working title — confirm.*

## 0. Document Purpose

This PRD defines the first version of a system for a hospital's outpatient department (OPD). Nurses and staff triage each Patient, give them a Queue Number for one OPD Facility, serve them there, and record every step. The system replaces the "Acme Store" example dashboard in this repository (stories 1.1–1.5 in `_bmad-output/implementation-artifacts/`).

Readers are the product owner (Alcarz) and the downstream BMAD workflows: UX (`bmad-ux`), architecture (`bmad-architecture`), and epics and stories (`bmad-create-epics-and-stories`).

How to read it:
- Features are grouped, and each group holds globally numbered FRs.
- Terms are defined once in §3 and used exactly.
- Inferences are tagged `[ASSUMPTION]` inline and indexed in §12.
- Technical choices and reuse notes for the existing codebase are in `addendum.md`.

## 1. Vision

A Patient walks into the OPD. Within minutes a Triage Nurse has recorded why they came, checked their Vital Signs, and handed them a Queue Number for the right Facility: Prenatal, Animal Bite Center, Treatment, or Consultation. Seniors, PWDs, pregnant women and urgent cases move ahead, as the law and good practice require. The Patient sits down and watches a screen that shows which number each Facility is serving. No one shouts names across a crowded hall, and no one loses their place.

Behind the counter, each Facility sees its own live list of who is waiting, in the right order. Staff call the next number, serve the Patient, and then finish the Visit, refer the Patient to another Facility, or book their next Appointment, such as the next anti-rabies dose or prenatal check-up. Every Visit is saved to the Patient Record, so when the Patient returns, their history is already there.

The hospital gets a calmer waiting area, fairer Queues, faster Triage, and records it can trust. It also gets a clear daily picture: how many Patients each Facility served and how long people waited.

## 2. Target Users

### 2.1 Jobs To Be Done

- **Triage Nurse:** quickly register or find the Patient, record Vital Signs and Chief Complaint, decide the Urgency Level and Facility, and hand out a Queue Number without paperwork.
- **Facility Staff** (nurses and staff at each Facility): know who is next without guessing, call them, record the outcome, refer or book a follow-up, and move on.
- **Admin:** keep the Facility, Doctor and Department lists correct, manage Staff Accounts, and see how the OPD is performing today.
- **Patients** (indirect users): know their place in line, trust that the order is fair, and not miss their turn.

### 2.2 Non-Users (v1)

- **Patients do not log in** or use a self-service kiosk in v1. They interact only with the Display Board and their printed or written Queue Number. `[ASSUMPTION]`
- **Doctors do not use the system directly** in v1. Facility Staff record the outcome for them. Doctors appear only as reference data (Doctors and Departments). `[ASSUMPTION]`
- **Emergency Room, inpatient wards, beds and admissions** are out of scope (user decision).

### 2.3 Key User Journeys

- **UJ-1. Nurse Liza triages a senior with a fever.**
  - **Persona and context:** Liza is the Triage Nurse at the OPD entrance on a busy Monday morning.
  - **Entry state:** signed in on the triage workstation.
  - **Path:**
    1. Lola Carmen, 68, arrives. Liza searches by name and birthdate and finds her existing Patient Record.
    2. She starts a Visit and records blood pressure, temperature, pulse, respiratory rate, weight and the Chief Complaint ("fever for 3 days").
    3. She sets the Priority Category *Senior Citizen* and the Urgency Level, and assigns the Consultation Facility.
    4. She issues Queue Number `CN-014`.
  - **Climax:** the system shows `CN-014`, its place in the priority order, and about how many Patients are ahead. Liza writes or prints the number for Lola Carmen.
  - **Resolution:** Lola Carmen appears at the right place in Consultation's Queue. Liza starts the next Patient.
  - **Edge case:** if the Patient is not found, Liza registers them with the minimum fields and triages them right away. If the Vital Signs are far outside normal ranges, the system warns her. She can then mark the case Urgent or direct the Patient to the Emergency Room, which is outside this system.

- **UJ-2. Staff Mark serves the Animal Bite Center Queue.**
  - **Persona and context:** Mark runs the Animal Bite Center counter.
  - **Entry state:** signed in, viewing the Animal Bite Center Queue.
  - **Path:**
    1. He presses *Call next*. The system picks the next Patient in priority order (`AB-006`), marks them Called, and shows the number on the Display Board.
    2. When the Patient comes forward, he marks them Serving and sees their Triage data and past Visits.
    3. After the first dose, he completes the Visit and books the follow-up Appointment for the next scheduled dose.
  - **Climax:** the Visit is recorded and the Patient leaves with their next Appointment date.
  - **Resolution:** `AB-006` leaves the Queue, and the Display Board moves to the next number.
  - **Edge case:** if a Called Patient does not come forward, Mark can recall the Queue Number. After an agreed number of calls, he marks them No-show. A No-show Patient who returns later can be restored to the Queue.

- **UJ-3. Grace watches the Display Board in the waiting area.**
  - **Persona and context:** Grace, pregnant, holds `PN-004` for Prenatal.
  - **Path:** the screen shows the number each Facility is serving and the next few numbers. When `PN-004` is called, it is highlighted and a sound plays.
  - **Resolution:** she goes to the Prenatal counter. No names or medical details ever appear on the screen.

- **UJ-4. A Patient is referred from Treatment to Consultation.**
  - Treatment staff finish wound care and see that the Patient also needs a doctor's consultation. They mark the Visit *Referred* to Consultation.
  - The Patient keeps the same Visit and gets a Consultation Queue Number without repeating Triage. They keep their Urgency Level and Priority Category and are placed by the referral time (FR-9, FR-14).

- **UJ-5. A returning prenatal Patient arrives for a booked Appointment.**
  - The Triage Nurse finds today's Appointment for the Patient and checks her in. She still goes through Triage (Vital Signs are needed at every Visit), then gets a Prenatal Queue Number. `[ASSUMPTION]`

- **UJ-6. Admin Ana starts the day.**
  - Ana checks the OPD Overview: Patients waiting per Facility, served today, and average wait.
  - She confirms the Doctors on duty for each Facility and unlocks a nurse's Staff Account.

## 3. Glossary

- **Patient:** a person who receives OPD services. Has exactly one Patient Record.
- **Patient Record:** the Patient's identity and contact details, plus all of their Visits. Identified by a Hospital Number.
- **Hospital Number:** a unique identifier assigned when a Patient Record is created. `[ASSUMPTION: the hospital does not already have a numbering scheme this must follow]`
- **Visit:** one arrival of a Patient at the OPD on one day. It holds one Triage Record and one or more Queue Entries.
  - **Visit status** is *Open* while any Queue Entry is Waiting, Called or Serving.
  - It ends as one of: *Completed* (the last Queue Entry is Completed), *Directed to ER* (the Urgency Level has the ER flag), *No-show* (the last Queue Entry is No-show at end of day), or *Cancelled*.
- **Triage:** the first step of every Visit. A Triage Nurse records Vital Signs, Chief Complaint, Urgency Level and Priority Category, and assigns a Facility.
- **Triage Record:** what Triage produced for a Visit.
- **Vital Signs:** blood pressure, temperature, pulse rate, respiratory rate, oxygen saturation, weight and height. `[ASSUMPTION: which of these are required]`
- **Chief Complaint:** the main reason for the Visit, in the Patient's words.
- **Urgency Level:** the triage acuity.
  - Each level has a **rank** (a lower rank is served first) and an **ER flag** ("direct to the Emergency Room, do not queue").
  - Defaults: *Emergency* (ER flag), *Urgent* (rank 1), *Routine* (rank 2).
  - An Admin can rename, add or re-rank levels (FR-24). Queue ordering always uses the rank (FR-9).
- **Priority Category:** the legal or policy basis for moving ahead in a Queue: *Senior Citizen* (RA 9994), *PWD* (RA 10754), *Pregnant* (hospital or local policy), or *None*. Separate from Urgency Level. An Admin can enable or disable each category.
- **Facility:** an OPD service point with its own Queue. v1 has *Prenatal*, *Animal Bite Center*, *Treatment* and *Consultation*. An Admin can manage the list.
- **Queue:** one Facility's ordered list of Queue Entries for the current day.
- **Queue Entry:** one Visit's place in one Facility's Queue. Has a Queue Number and a Queue Status.
- **Queue Number:** the number shown to the Patient: the Facility prefix plus a daily sequence (e.g. `PN-004`, `AB-006`, `TR-010`, `CN-014`). It restarts every day. `[ASSUMPTION: the prefixes and the daily reset]`
- **Queue Status:** the status of one Queue Entry. It moves from *Waiting* to *Called* to *Serving* to *Completed*. An entry can also end as *Referred* (a new Queue Entry was created at another Facility), *No-show* or *Cancelled*.
- **Referral:** moving a Visit from one Facility's Queue to another's without repeating Triage.
- **Display Board:** a screen in the waiting area that shows, for each Facility, the Queue Number being served and the next ones. Never shows names or clinical data.
- **Appointment:** a booked future Visit for a Patient at a Facility on a date, optionally with a Doctor. Status: *Booked*, *Checked in*, *Completed*, *Missed* or *Cancelled*.
- **Doctor:** a physician listed in the directory, belonging to one Department and assignable to Facilities.
- **Department:** a clinical department (e.g. OB-GYN, Internal Medicine, Pediatrics) that groups Doctors.
- **Staff Account:** a login for a hospital employee, with one Role.
- **Role:** *Triage Nurse*, *Facility Staff* (tied to one or more Facilities), or *Admin*. `[ASSUMPTION: these three roles]`

## 4. Features

### 4.1 Staff Sign-in and Roles

**Description:** Every screen except the Display Board requires signing in with a Staff Account. What a person can see and do depends on their Role. Facility Staff see only their own Facilities' Queues. Patient data is shown only to signed-in staff whose Role needs it.

#### FR-1: Sign in and out

Staff can sign in with their own credentials and sign out. Realizes UJ-1, UJ-2, UJ-6.

**Consequences (testable):**

- Unauthenticated requests to any page other than the Display Board are redirected to sign-in.
- A session ends after `[ASSUMPTION: 15]` minutes of inactivity, and on sign-out.
- After `[ASSUMPTION: 5]` failed attempts, the Staff Account is locked until an Admin unlocks it.

#### FR-2: Role-based access

The system limits actions by Role. Realizes UJ-1, UJ-2, UJ-6.

**Consequences (testable):**

- Permissions follow this matrix. Anything not listed is denied.

| Action | Triage Nurse | Facility Staff | Admin |
|---|---|---|---|
| Find and view Patient Records (FR-4, FR-6) | yes | yes | yes |
| Register Patients and edit demographics (FR-5, FR-6) | yes | no | yes |
| Record Triage and issue Queue Numbers (FR-7, FR-8) | yes | no | yes |
| Queue actions: call, serve, complete, refer (FR-10–FR-14) | no | own Facilities only | yes |
| Record facility-specific fields (FR-22) | no | own Facilities only | yes |
| Book and check in Appointments (FR-15, FR-17, FR-18) | yes | own Facilities only | yes |
| Enter back-dated paper Visits (FR-25) | yes | no | yes |
| View the OPD Overview (FR-21) | yes | yes | yes |
| Manage Staff Accounts, OPD Settings, Doctors and Departments (FR-3, FR-19, FR-20, FR-23, FR-24) | no | no | yes |
| View the audit log (FR-26) | no | no | yes |

#### FR-3: Manage staff accounts

An Admin can create, edit, deactivate and unlock Staff Accounts, and assign Roles and Facilities. Realizes UJ-6.

**Consequences (testable):**

- A deactivated Staff Account cannot sign in. Its past actions stay attributed to it.

### 4.2 Patient Registration and Records

**Description:** Before Triage, the Triage Nurse finds the Patient or registers a new one. Registration asks only for what is needed to identify and contact the Patient, so the Queue keeps moving. For returning Patients, the Patient Record shows the full Visit history. The Patient list reuses the existing searchable, filterable, paginated table pattern (story 1.4).

#### FR-4: Find a patient

Staff can search Patient Records by name, Hospital Number, birthdate or phone number. Realizes UJ-1, UJ-5.

**Consequences (testable):**

- Results appear while typing and match partial names, ignoring case.
- Each result shows name, age, sex, Hospital Number and last Visit date, so staff can tell apart people with the same name.

#### FR-5: Register a patient

A Triage Nurse can create a Patient Record, and the system assigns a Hospital Number. Realizes UJ-1.

- **Required fields** `[ASSUMPTION]`: full name, sex, birthdate, address (barangay/municipality), contact number.
- **Optional fields:**
  - PhilHealth Identification Number (PIN), needed later for Konsulta and claims;
  - Senior Citizen ID number;
  - PWD ID number;
  - emergency contact.

**Consequences (testable):**

- When name and birthdate match an existing Patient Record, the system warns about a possible duplicate and offers to open that record instead.
- The birthdate cannot be in the future. Age is calculated, not typed.

#### FR-6: View and update a patient record

Staff can view a Patient Record with all its Visits (Triage Records, Facilities, outcomes, Appointments) and correct demographic details. Realizes UJ-2, UJ-5.

**Consequences (testable):**

- Every change to a Patient Record is logged with who made it, when, and the old and new values (see §6, PRIV-2).
- Records are never hard-deleted in v1. `[ASSUMPTION]`

### 4.3 Triage

**Description:** Every Visit starts with Triage, including Visits for Patients with an Appointment. The Triage Nurse records Vital Signs and Chief Complaint, sets the Urgency Level and Priority Category, and assigns the Facility. Values outside normal ranges get a visible warning; the system never decides for the nurse. Emergency cases are directed to the Emergency Room and get no OPD Queue Number.

#### FR-7: Record triage

A Triage Nurse can record Vital Signs, Chief Complaint, Urgency Level and Priority Category for a Visit. Realizes UJ-1, UJ-5.

**Consequences (testable):**

- The Visit cannot enter a Queue until the Chief Complaint, Urgency Level and required Vital Signs are entered.
- Impossible values are rejected (e.g. a temperature under 30 °C or over 45 °C). Out-of-normal values are accepted but flagged. `[ASSUMPTION: the ranges; to be set with the hospital's nursing lead]`
- *Pregnant* is offered as a Priority Category only for female Patients. The Senior Citizen age (60+) is checked against the birthdate.
- Choosing Senior Citizen or PWD asks for the ID number (Senior Citizen ID, PWD ID) if the Patient Record does not have one yet. The nurse can still proceed without it and note that it was not presented.
- The Urgency Level scale comes from OPD Settings (FR-24). The default has 3 levels (Emergency, Urgent, Routine). DOH does not mandate an OPD triage scale; Philippine EDs often use the 5-level ESI.

#### FR-8: Assign a facility and issue a queue number

A Triage Nurse can assign the Visit to one Facility. The system then creates a Queue Entry with that Facility's next Queue Number. Realizes UJ-1.

**Consequences (testable):**

- Queue Numbers are unique per Facility per day and increase in sequence (`PN-001`, `PN-002`, …).
- The Triage Nurse sees the Queue Number and how many Patients are ahead, and can print a slip. `[ASSUMPTION: printing on a small receipt printer or a normal printer; the hardware is not yet known]`
- An Urgency Level with the ER flag (default: *Emergency*) issues no Queue Number. The Visit ends as *Directed to ER*.

### 4.4 Queues

**Description:** Each Facility has its own Queue for the day. The order is fair and predictable: urgent Patients first, then Patients with a Priority Category, then everyone else, each group in arrival order. Staff see the full order and why each Patient is where they are.

#### FR-9: Priority ordering

The system orders each Queue by group, then by Queue Entry time. Realizes UJ-1, UJ-2, UJ-4.

- **Groups, in order:**
  1. Entries whose Urgency Level ranks above the lowest (default: Urgent), by rank.
  2. Entries of the lowest rank that have an enabled Priority Category (Senior Citizen, PWD, Pregnant).
  3. All other entries (default: Routine).
- **Queue Entry time:** when the entry was created. For a Referral (FR-14), this is the referral time. For a restored No-show (FR-11), it is the original entry time.

**Consequences (testable):**

- A Senior Citizen who arrives after three Routine Patients is placed ahead of all three.
- Two Patients in the same group are served in arrival order.
- Every Queue Entry shows its group, as a badge and as text, so the reason for its position is visible.
- Priority is strict: all group 1 and group 2 entries are served before any group 3 entry; they do not alternate with regular Patients (decided 2026-09-26). The cost is that Routine Patients can wait a long time on busy days. SM-C3 tracks this, and the OPD Overview (FR-21) shows it.
- **Legal basis:**
  - Senior Citizen and PWD priority are required by law: RA 9994 (Expanded Senior Citizens Act) and RA 10754 (PWD express lanes).
  - No national law requires Pregnant priority; it comes from local ordinances or hospital policy.
- An Admin can therefore enable or disable each Priority Category. Senior Citizen and PWD are on by default and are marked as legally required.

#### FR-10: Live queue view

Facility Staff can see their Facility's Queue: Waiting, Called and Serving entries, each with Queue Number, Patient name, group and time waited. Realizes UJ-2.

**Consequences (testable):**

- Changes made by other staff (new entries from Triage, Referrals, calls) appear within `[ASSUMPTION: 5]` seconds without reloading the page.

#### FR-11: Call, recall, serve, no-show

Facility Staff can *Call next* (the system picks the top Waiting entry), *Recall* a Called Queue Number, mark *Serving*, and mark *No-show*. Realizes UJ-2.

**Consequences (testable):**

- *Call next* never skips a higher-placed Waiting entry. Staff can call a specific entry only by giving a reason, which is logged.
- Staff can restore a No-show entry to Waiting on the same day. It keeps its original entry time.
- Two staff pressing *Call next* at the same moment never get the same Patient.

#### FR-12: Daily queue reset

Queues start empty each day, and Queue Number sequences restart at 001. Realizes UJ-1.

**Consequences (testable):**

- At each Facility's closing time (FR-23), entries still Waiting or Called are marked Cancelled (end of day) and stay visible in the Visit history. If entries are still waiting 30 minutes before closing, staff are warned. `[ASSUMPTION: the end-of-day handling; to be confirmed by the OPD head, §11]`

### 4.5 Facility Service and Outcomes

**Description:** At the Facility, staff open the Serving Patient's Visit to see the Triage data and history, record the outcome, and then close the Visit or pass it on.

#### FR-13: Record the visit outcome

Facility Staff can record the service given and a short note, then complete the Queue Entry. Realizes UJ-2.

**Consequences (testable):**

- A Completed entry leaves the Queue and the Display Board.
- The note is saved to the Visit and visible in the Patient Record.
- Facility-specific fields are captured for Animal Bite Center and Prenatal Visits (FR-22).

#### FR-14: Refer to another facility

Facility Staff can refer the Visit to another Facility. This creates a Queue Entry there without repeating Triage. Realizes UJ-4.

**Consequences (testable):**

- The Patient gets the target Facility's next Queue Number, is ordered by FR-9 using the referral time, and keeps their Urgency Level and Priority Category.
- The original Queue Entry ends as *Referred*.
- The Visit shows both Facilities and the reason for the Referral.

#### FR-15: Book a follow-up from the facility

Facility Staff can book an Appointment for the Patient at the end of a Visit. Realizes UJ-2, UJ-5.

**Consequences (testable):**

- **Animal Bite Center:** after a Day 0 dose, the system suggests Day 3 and Day 7 follow-ups, following the 1-week intradermal regimen in DOH AO 2018-0013. For a previously immunized Patient, it suggests Day 0 and Day 3 boosters (WHO guidance; not yet verified in the AO text, so confirm with the Animal Bite Center head, §11). Staff can always change the suggested dates. The schedules come from OPD Settings (FR-24).
- **Prenatal:** the system shows how many prenatal contacts the Patient has had, against the target in OPD Settings (FR-24). The default is 8, per DOH AO 2016-0035 and WHO; older DOH materials say at least 4.

#### FR-22: Facility-specific visit fields

Facility Staff can record structured fields for Animal Bite Center and Prenatal Visits, in addition to the general note. Realizes UJ-2, UJ-5.

**Consequences (testable):**

- **Animal Bite Center fields:**
  - biting animal (dog, cat, other) and whether it is owned or stray;
  - date of exposure;
  - site of the bite;
  - exposure category: I (licks on intact skin, no vaccine), II (minor scratches without bleeding: wound washing and vaccine), III (bites through the skin or mucosal exposure: vaccine and immunoglobulin);
  - vaccine brand (PVRV/PCEC), route and dose day (0, 3 or 7);
  - rabies immunoglobulin type (ERIG/HRIG), if given;
  - prior vaccination status;
  - outcome.
- **Prenatal fields:**
  - gestational age and expected date of delivery;
  - visit (contact) number;
  - blood pressure and weight (from Triage);
  - fundal height;
  - tetanus toxoid dose;
  - iron/folic acid given;
  - notes.
- Category I exposures record the Visit without scheduling vaccine follow-ups.

**Notes:**

- `[NOTE FOR PM]` The field lists come from DOH/WHO references (see `addendum.md`, Sources). Confirm them with the Animal Bite Center and Prenatal facility heads before these stories are built. Reporting to the National Rabies Information System (NaRIS) and DOH is out of scope for v1 (§8.2), but these fields hold the data that reporting will need.

### 4.6 Display Board

**Description:** A full-screen view on a TV in the waiting area shows, for each Facility, the Queue Number now being served and the next few. It updates by itself, and each newly called number is highlighted with a sound. It shows no personal or clinical information. It needs no staff sign-in but runs only on display devices an Admin has registered (FR-27).

#### FR-16: Show now-serving numbers

The Display Board shows each Facility's Called or Serving Queue Numbers and the next `[ASSUMPTION: 3]` Waiting numbers. Realizes UJ-3.

**Consequences (testable):**

- A newly Called number is highlighted and a chime plays within `[ASSUMPTION: 5]` seconds of the call.
- No Patient name, complaint or Priority Category is shown. Only Queue Numbers and Facility names appear.
- Text is readable from `[ASSUMPTION: 6]` meters on a standard TV (large type, high contrast).
- If the connection drops, the board shows a clear "reconnecting" state instead of stale numbers.

### 4.7 Appointments

**Description:** Staff book future Visits for a Patient at a Facility, such as follow-up doses or the next prenatal visit, and see each day's list. When the Patient arrives, staff check in the Appointment, and the Patient goes through Triage as usual.

#### FR-17: Book, reschedule, cancel

Staff can book an Appointment (Patient, Facility, date, optional Doctor and note), reschedule it, and cancel it. Realizes UJ-2, UJ-5.

**Consequences (testable):**

- Booking on a date when the Facility is closed (per FR-23) is blocked.

#### FR-18: Daily appointment list and check-in

Staff can see the Appointments for a day, filtered by Facility and status, and check a Patient in, which starts a Visit at Triage. Realizes UJ-5.

**Consequences (testable):**

- Appointments not checked in by the end of the day become Missed.
- A Patient's upcoming Appointments are shown on their Patient Record.

### 4.8 Doctors and Departments

**Description:** Admins keep a directory of Doctors and Departments and set which Doctors serve which Facilities on which days. Staff can look up who is on duty.

#### FR-19: Manage the directory

An Admin can create, edit and deactivate Departments and Doctors (name, Department, specialty, and the Facilities they serve). Realizes UJ-6.

#### FR-20: Duty schedule

An Admin can set each Doctor's duty days per Facility. Staff can see today's Doctors per Facility. Realizes UJ-6.

**Consequences (testable):**

- An Appointment with a Doctor can be booked only on that Doctor's duty days at that Facility.

### 4.9 OPD Overview

**Description:** This home screen replaces the store Overview. It shows today at a glance: Patients waiting and served per Facility, average waiting time, and today's Appointments. It keeps the current design (top bar, left rail, cards; story 1.5).

#### FR-21: Today's OPD summary

Signed-in staff see, for today:
- Visits triaged, and Patients waiting, being served and served, per Facility.
- Average and longest current waiting time per Facility, with the longest Routine (group 3) wait shown separately.
- Appointments booked vs. checked in.
- No-shows.

Realizes UJ-6.

**Consequences (testable):**

- The numbers match the Queue and Appointment data at the time of viewing.
- Each Facility card links to that Facility's Queue.

### 4.10 OPD Settings and Oversight

**Description:** Hospital policies that vary are kept in Admin-editable settings instead of being hard-coded: Facilities and their hours, the Urgency Level scale, the Priority Categories, and the clinical schedules. This group also covers entering paper records after an outage and reviewing the audit log that privacy law requires.

#### FR-23: Manage facilities

An Admin can create, edit and deactivate Facilities. Each Facility has a name, a Queue Number prefix, opening days, and opening and closing times. Realizes UJ-6.

**Consequences (testable):**

- Prefixes are unique. A prefix change takes effect the next day, never mid-day.
- Triage cannot assign a Facility that is closed at that moment. Appointments cannot be booked on its closed days (FR-17).
- Deactivating a Facility with entries still Waiting is blocked until they are served or cancelled.

#### FR-24: Manage triage and clinical settings

An Admin can edit:
- the Urgency Levels (name, rank, ER flag);
- which Priority Categories are enabled;
- the Animal Bite Center dose schedules (days from Day 0, for new and previously immunized Patients);
- the prenatal contact target.

Realizes UJ-6.

**Consequences (testable):**

- At least one Urgency Level must be non-ER, and ranks are unique.
- When someone tries to disable Senior Citizen or PWD, a "legally required (RA 9994 / RA 10754)" warning appears.
- Changes apply to new Queue Entries and suggestions. Existing entries keep the group they were given.

#### FR-25: Enter paper-recorded visits

After an outage (NFR-3), a Triage Nurse or Admin can enter a Visit that was recorded on paper, with its real date and times, Triage data and outcome. Realizes UJ-6.

**Consequences (testable):**

- Back-dated Visits are marked *Entered from paper*, with who entered them and when.
- They never create a Queue Entry for the current day and never appear on the Display Board.

#### FR-26: Review the audit log

An Admin can search the audit log (PRIV-2) by staff member, Patient Record, action and date range. Realizes UJ-6.

**Consequences (testable):**

- Every Patient Record view and every create, update, call, Referral, setting change and sign-in is present, with staff, time and action.
- No one, including Admins, can edit or delete log entries.

#### FR-27: Register display devices

An Admin can register and revoke Display Board devices. Realizes UJ-3.

**Consequences (testable):**

- Only a registered device can open the Display Board (FR-16). A revoked device shows a "not authorized" screen within one refresh cycle.

## 5. Cross-Cutting Non-Functional Requirements

- **NFR-1 Responsiveness:** common actions (search a Patient, save Triage, call next) complete in under 1 second on the hospital network. `[ASSUMPTION]`
- **NFR-2 Live updates:** Queue changes reach other staff screens and the Display Board within 5 seconds (FR-10, FR-16).
- **NFR-3 Availability:** available during all OPD hours `[ASSUMPTION: 7 AM–5 PM, Monday–Saturday]`. A documented manual fallback (paper queue slips) covers outages, and paper-recorded Visits are entered afterwards (FR-25).
- **NFR-4 Data integrity:** Queue Numbers are never duplicated (FR-8), and no two staff get the same Patient (FR-11), even when they act at the same moment.
- **NFR-5 Devices:** works in desktop and laptop browsers at triage and at Facility counters, and on tablets. The Display Board runs in a TV browser. `[ASSUMPTION: what hardware the hospital has]`
- **NFR-6 Accessibility and usability:** WCAG 2.1 AA contrast, 44px touch targets, and full keyboard use at triage for speed (continuing the standards of stories 1.2–1.5).
- **NFR-7 Language:** the interface is in English. `[ASSUMPTION: Filipino labels are not needed in v1]`

## 6. Privacy, Security and Compliance

Under the Philippine Data Privacy Act of 2012 (RA 10173), health information is **sensitive personal information**. These rules also apply:

- **NPC Circular 2023-06** (security of personal data, in force since March 2024): access limited to authorized personnel, secure authentication, acceptable use, logging and monitoring, and business continuity.
- **NPC Circular 16-03** (personal data breach management): notify the NPC and affected Patients within 72 hours of learning of a breach.
- **The Health Privacy Code** (Joint Administrative Order 2016-0002, DOH-DOST-PhilHealth): consent, disclosure and access to health information.

Sources are listed in `addendum.md`.

- **PRIV-1 Access by need:** only signed-in staff see Patient data, limited by Role (FR-2). The Display Board shows only Queue Numbers.
- **PRIV-2 Audit trail:** every view of a Patient Record, and every create, update, call or Referral, is logged with staff, time and action. Admins review the log through FR-26. Logs cannot be edited.
- **PRIV-3 Encryption:** Patient data is encrypted in transit and at rest.
- **PRIV-4 Consent and notice:** registration records that the Patient was told how their data is used. `[ASSUMPTION: the hospital's privacy notice and consent form]`
- **PRIV-5 Retention:** outpatient records are kept at least 7 years after the Patient's last consultation, per the DOH Records Disposition Schedule (DC 2021-0226; seen only in a secondary summary, so confirm with the hospital's records officer). They are never hard-deleted in v1.
- **PRIV-6 Breach readiness:** the audit trail must let the hospital quickly find who accessed or changed which records, and when. The hospital needs this to meet the 72-hour notification rule of NPC Circular 16-03.
- **PRIV-7 Unique accounts:** every person has their own Staff Account. Shared logins (e.g. one "triage" account) are not allowed, so every action traces to one person (NPC Circular 2023-06).
- `[NOTE FOR PM]` The hospital's Data Protection Officer should review this section before go-live.

## 7. Non-Goals (Explicit)

- Not an electronic medical record (EMR) for doctors. No diagnosis coding, e-prescriptions, or lab or imaging orders in v1.
- No inpatient features: no beds, wards or admissions (user decision).
- No Emergency Room workflow. Emergencies are only redirected.
- No billing, PhilHealth claims, pharmacy or inventory.
- No patient-facing app, SMS notifications or self-service kiosk in v1.
- No integration with other hospital systems in v1. `[ASSUMPTION: the hospital has no system this must connect to]`

## 8. MVP Scope

### 8.1 In Scope

- Staff sign-in with the Triage Nurse, Facility Staff and Admin Roles.
- Patient registration, search and Patient Records.
- Triage with Vital Signs, Chief Complaint, Urgency Level, Priority Category and Facility.
- Per-Facility Queues with priority ordering, call, recall, serve, no-show, Referral and daily reset.
- Facility outcomes and follow-up booking.
- The Animal Bite Center and Prenatal fields (FR-22). The field lists are in scope, but the facility heads must confirm them before those stories are built (§11).
- The Display Board and display device registration.
- Appointments.
- The Doctors and Departments directory with duty days.
- The OPD Overview.
- OPD Settings: Facilities, Urgency Levels, Priority Categories, schedules.
- Entry of paper-recorded Visits.
- The audit trail and audit log review.

### 8.2 Out of Scope for MVP

- Clinical forms for Treatment and Consultation beyond the general outcome note (FR-13).
- Reports and exports for DOH or PhilHealth: deferred to v2, pending the hospital's reporting needs.
- SMS or text reminders for Appointments: deferred to v2.
- A kiosk or self-registration: deferred.
- Doctor logins and EMR: deferred.

## 9. Success Metrics

**Primary**
- **SM-1 Triage time:** median time from starting Triage to issuing a Queue Number is under 3 minutes. Validates FR-4, FR-5, FR-7, FR-8.
- **SM-2 Waiting time visibility:** 100% of served Patients have a measured wait time (Queue Entry to Serving), reported per Facility each day. Validates FR-10, FR-21.
- **SM-6 Waiting time improvement:** the median wait per Facility, from arrival to being served, falls by at least 20% within 3 months of go-live. The baseline is measured by hand for one week before go-live (arrival and service times logged on paper at each Facility). Validates FR-9–FR-11. `[ASSUMPTION: the 20% target]`

**Secondary**
- **SM-3 Adoption:** within 4 weeks of go-live, at least 95% of OPD Visits go through the system rather than paper. Validates all features.
- **SM-4 Priority compliance:** 100% of Priority Category Patients are served ahead of Routine Patients who arrived earlier (per FR-9). Validates FR-9.
- **SM-5 No-show clarity:** No-shows are recorded, not silently dropped. The number of entries left Waiting at the end of the day is tracked. Validates FR-11, FR-12.

**Counter-metrics (do not optimize)**
- **SM-C1 Triage completeness:** do not push SM-1 down by skipping Vital Signs. The share of Visits with all required Vital Signs must stay at 100%.
- **SM-C2 Calls per patient:** do not reduce reported wait times by marking Patients No-show too early. Watch the number of recalls before No-show, and the number of restored No-shows.
- **SM-C3 Longest Routine wait:** strict priority (FR-9) can make Routine Patients wait very long on busy days. Track the longest Routine wait per Facility per day. If it regularly exceeds `[ASSUMPTION: 3 hours]`, the OPD head should review the priority policy. Do not improve SM-4 at this metric's expense without a decision. Counterbalances SM-4 and SM-6.

## 10. Rollout

- Pilot one Facility first `[ASSUMPTION: Consultation, the highest volume]`, with paper backup, then add the others. During the pilot:
  - Triage issues system Queue Numbers only for Facilities that are live. Patients for other Facilities get paper numbers, as today.
  - A Referral to a Facility that is not live yet is recorded as a Referral outcome naming the target Facility, without creating a Queue Entry.
  - The Display Board shows only live Facilities.
- Train Triage Nurses and Facility Staff on the four core actions: find or register, triage, call next, complete or refer.
- `[NOTE FOR PM]` Decide who in the hospital approves go-live (e.g. the OPD head, IT and the Data Protection Officer).

## 11. Open Questions

Resolved on 2026-09-26, when the product owner confirmed the draft's defaults:
- **Priority policy:** strict priority (FR-9).
- **Queue Number delivery:** a printed slip through the browser print dialog.
- **Hospital Numbers:** there is no existing scheme, so the system assigns them.
- **Display Board:** one screen showing all Facilities.

Still open. None of these block UX, architecture or epics. The hospital owns each one, and each should be settled before go-live:

1. Required Vital Signs and their normal and impossible ranges (FR-7). *Owner: nursing lead. Revisit: before the triage story is built.*
2. Confirm the Facility-specific fields (FR-22), which are seeded from DOH and WHO references. *Owner: facility heads. Revisit: before the facility-outcome stories.*
3. OPD hours and days per Facility (FR-23), and the end-of-day handling of leftover entries (FR-12). *Owner: OPD head.*
4. Where the system runs: a hospital server or the cloud. This affects the Data Privacy Act review (§6). *Owner: hospital IT and the DPO. Revisit: during `bmad-architecture`.*
5. Who approves go-live (§10). *Owner: OPD head.*
6. Confirm the booster schedule for previously immunized Animal Bite Center Patients (FR-15) against the DOH AO 2018-0013 text. *Owner: Animal Bite Center head.*

## 12. Assumptions Index

*The product owner accepted all of these as working defaults on 2026-09-26. Two still need the hospital's clinical owners and are listed in §11: the Vital Signs ranges and the end-of-day handling. Numeric thresholds (timeouts, ranges, seconds, meters, targets) are starting values the hospital can tune.*

- §2.2: Patients do not log in and there is no kiosk. Doctors do not use the system in v1.
- §2.3 UJ-4: a referred Patient is ordered by the normal priority rules in the target Queue.
- §2.3 UJ-5: Appointment Patients still go through Triage.
- §3: Hospital Number format. The Vital Signs list. The 3-level Urgency Level scale. Queue Number prefixes and daily reset. Three Roles.
- §4.1: 15-minute session timeout. Lock after 5 failed sign-ins.
- §4.2: the registration fields. No hard deletion.
- §4.3: Vital Signs ranges. Printing Queue Numbers.
- §4.4: 5-second live updates. End-of-day handling (still open in §11).
- §4.5: suggested follow-up dates from the vaccination schedule.
- §4.6: device restriction for the Display Board. 3 next numbers. 6-meter readability. 5-second update.
- §4.10: Facility opening days.
- §5: under-1-second actions. OPD hours. Hardware. English-only interface.
- §6: Philippines and RA 10173. Privacy notice and consent form.
- §7: no existing system to integrate with.
- §9: SM-6's 20% target. SM-C3's 3-hour review threshold.
- §10: pilot with Consultation.
