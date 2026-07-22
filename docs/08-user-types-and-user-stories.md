# 08 — User Types & User Stories

Every person who touches, is served by, or is accountable to a Klasio school, and what each of
them does daily, weekly, monthly, termly, yearly and intermittently. Compiled from the feature
catalogue ([02](02-feature-catalog.md), [FEATURES.md](FEATURES.md)), the architecture
([03](03-architecture.md)), the current codebase roles, and fresh research on the Ghanaian
educational structure (July 2026).

Two structural facts run through everything below:

1. **Below JHS, the class teacher is the school.** Creche → B6 has one teacher _stationed_ to a
   class who teaches (nearly) all subjects, owns the register, records all continuous assessment,
   and writes the reports. From JHS (B7) upward the **class teacher is an administrative role** —
   they mark attendance, handle conduct/interest remarks and first-line discipline for their class —
   while **subject teachers** teach and mark their own subject across many classes. The product
   must treat "class teacher" and "subject teacher" as _assignments_, not job titles: the same
   person is often both.
2. **Terms and academic years are lifecycle objects.** A term is _opened_, runs, and is _closed_
   (exams → SBA compilation → reports → vetting → publication → fee rollover → returns). An
   academic year is closed once (promotion, arrears carry-forward, graduation, alumni archival)
   and the next one opened (new terms, new fee structures, new class lists). Closure is a
   deliberate, permission-gated act — never an automatic date rollover — because GES moves dates
   and schools control their own calendar. Basic schools run 3 terms; public SHS now runs
   semesters with per-form calendars, so the calendar model must allow a school-defined structure.

---

## Part I — The user types

### A. Ownership & governance

| #   | User type                                           | Signs in?                                      | Summary                                                                                                               |
| --- | --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A1  | **Proprietor / Owner**                              | Yes (OWNER — cannot be narrowed or locked out) | Owns the school and the money. Often also the head in small schools. Final authority on fees, staff, licence.         |
| A2  | **Board of directors / governors**                  | Rarely (report consumers)                      | Strategy and oversight. Receive termly financial and enrolment summaries; don't operate the system.                   |
| A3  | **PTA executives** (chairman, secretary, treasurer) | No (stakeholders)                              | Levy PTA dues (a fee item), co-plan meetings and projects. Served through broadcasts, the calendar and fee reporting. |

### B. Leadership & academic management

| #   | User type                                  | Signs in?         | Summary                                                                                                                                                    |
| --- | ------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **Headteacher / Head**                     | Yes (HEAD)        | Runs the school day-to-day. Vets and signs every terminal report, writes head remarks, sees the fee position but cannot take money (separation of duties). |
| B2  | **Assistant Head — Academics**             | Yes (custom role) | Timetable, syllabus coverage, exams oversight, lesson-note vetting, substitutions.                                                                         |
| B3  | **Assistant Head — Administration**        | Yes (custom role) | Staff attendance, duty rosters, discipline escalation, registers/returns, facilities.                                                                      |
| B4  | **Head of Department / level coordinator** | Yes (custom role) | Subject department (JHS/SHS) or level (Early Years / Lower / Upper Primary) oversight: marks progress, paper vetting, teacher support.                     |

### C. Teaching staff

| #   | User type                                   | Signs in?                           | Summary                                                                                                                  |
| --- | ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| C1  | **Class teacher (creche–B6, stationed)**    | Yes (TEACHER)                       | One class, all subjects. Register, all marks, all remarks, guardians' first contact, pickup awareness for the youngest.  |
| C2  | **Class teacher (JHS/SHS, administrative)** | Yes (TEACHER + class assignment)    | Register, conduct/interest remarks, discipline, report assembly for their class — but teaches only their own subject(s). |
| C3  | **Subject teacher (JHS/SHS)**               | Yes (TEACHER + subject allocations) | Teaches and marks one or more subjects across classes; owns that subject's SBA and exam marks; follows the timetable.    |
| C4  | **Teaching assistant / nursery attendant**  | Sometimes                           | Early-years support: feeding, naps, toileting, pickup handover. May mark attendance under the class teacher.             |
| C5  | **NSS / trainee teacher**                   | Yes (TEACHER, narrowed)             | Common cheap staffing; same tools as a teacher, often with reduced permissions (e.g. cannot publish).                    |

### D. Examinations & records

| #   | User type                          | Signs in?             | Summary                                                                                                                           |
| --- | ---------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Exams officer**                  | Yes (ready-made role) | Internal exam timetables, mock series, broadsheet compilation, WAEC registration (BECE/WASSCE), CSSPS school-selection logistics. |
| D2  | **Registrar / admissions officer** | Yes (ready-made role) | Admission register, applicant pipeline, enrolments, transfers, withdrawals, document checklists, records/transcript requests.     |

### E. Finance

| #   | User type                          | Signs in?             | Summary                                                                                                                                                       |
| --- | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Bursar**                         | Yes (BURSAR)          | Fee structures, billing runs, confirms bank deposits, concessions execution, reconciliation, defaulters, financial reports, payroll.                          |
| E2  | **Accounts clerk / fee collector** | Yes (ready-made role) | Takes cash at the office, records payments, issues receipts, daily feeding-fee collection. **Cannot confirm their own bank deposits** (separation of duties). |

### F. Front office & operations

| #   | User type                                   | Signs in?                        | Summary                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Front desk / secretary**                  | Yes (FRONT_DESK)                 | Visitors book, phone/WhatsApp handoffs, dismissal-change approvals, broadcasts on instruction, small-school registrar duties.                                                                                                                                                                                           |
| F2  | **Gate / security staff**                   | Yes (gate screen, minimal role)  | Morning drop-off check-in, afternoon release verification (QR/PIN/photo), visitors, lateness list. Works offline on a cheap Android phone.                                                                                                                                                                              |
| F3  | **System administrator** (IT administrator) | Yes (ready-made role)            | Runs accounts and access so the proprietor does not have to: opens accounts, builds roles, **hands out any access the school needs — including the bursar's — while holding none of it**, and answers for over-granting. Also backups, licence install, integrations. **Never sees a child's record or a single cedi.** |
| F4  | **Driver / bus attendant ("bus mother")**   | Yes (transport module, Advanced) | Route manifests, boarding/alighting scans, knows which adult meets which child at which stop.                                                                                                                                                                                                                           |
| F5  | **Cook / caterer / canteen staff**          | Rarely                           | Feeding headcounts per class per day; daily feeding-fee reconciliation with the accounts clerk. (Canteen wallets deferred.)                                                                                                                                                                                             |
| F6  | **Cleaner / groundskeeper**                 | No                               | Staff records + payroll subjects only.                                                                                                                                                                                                                                                                                  |

### G. Student welfare & specialist staff

| #   | User type                                           | Signs in?                                 | Summary                                                                                                                                   |
| --- | --------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **School nurse / first-aider**                      | Yes (ready-made role)                     | Sick bay visits, medical notes and allergies on records, guardian contact on incidents, medication notes. Sees medical data others don't. |
| G2  | **Counsellor**                                      | Yes (custom role)                         | At-risk flags (attendance/results), guardian conferences, CSSPS/SHS-choice guidance for B9.                                               |
| G3  | **Librarian**                                       | Yes (ready-made role)                     | Learning materials curation, library operations, textbooks inventory.                                                                     |
| G4  | **Chaplain / Imam**                                 | Sometimes                                 | Worship-day scheduling, RME involvement; mostly a calendar and broadcast audience.                                                        |
| G5  | **Sports master / PE coordinator**                  | Yes (custom role)                         | Inter-house competitions, sports days on the calendar, teams and permissions notes.                                                       |
| G6  | **Housemaster / housemistress / matron** (boarding) | Yes (custom role; hostel module deferred) | Boarding house rosters, exeats, weekend custody — the pickup-authorisation model extended to boarding.                                    |

### H. Families & learners

| #   | User type                                     | Signs in?                                                 | Summary                                                                                                                                                             |
| --- | --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **Guardian — primary contact**                | Yes (family portal, OTP by SMS/email; WhatsApp assistant) | The billed, texted, first-called adult. Fees, attendance, published reports, payments, dismissal changes, absence reporting. One account can hold several children. |
| H2  | **Guardian — secondary / extended family**    | Yes (same portal)                                         | Same read access to their linked wards; may or may not hold pickup permission; custody restrictions (RESTRICTED/BLOCKED) enforced at the gate.                      |
| H3  | **Pickup delegate** (driver, aunt, neighbour) | No account                                                | Exists only on the authorised-collection list, with a photo, an expiry ("just this term"), and a QR/PIN card. Verified at the gate; never sees data.                |
| H4  | **Student — JHS/SHS**                         | Yes (admission number + issued PIN)                       | Own fees, attendance, published reports, notices, calendar, learning materials, CBT/mock exams (Advanced).                                                          |
| H5  | **Student — creche–primary**                  | No (no PIN issued = no sign-in, the sensible default)     | The subject of nearly every record; served entirely through guardians and teachers.                                                                                 |
| H6  | **Prospective guardian / applicant**          | No account (public application form)                      | Applies from a flyer link in two minutes; tracked through the pipeline; becomes H1 on acceptance.                                                                   |
| H7  | **Alumnus / former student**                  | No                                                        | Lives in the alumni archive; surfaces years later as transcript/testimonial/records requests. Records retention is the feature.                                     |

### I. Vendor side (never on the school's box)

| #   | User type                           | Signs in?          | Summary                                                                                                                            |
| --- | ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| I1  | **Vendor licensing operator**       | Yes (apps/vendor)  | Mints/renews/withdraws Ed25519-signed licences, defines packages, watches heartbeats.                                              |
| I2  | **Deployment technician / support** | Operational access | Installs the box (cloud VM or LAN mini-PC), migration from spreadsheets/paper, training, backups, updates, theft-response runbook. |

### J. External bodies served through exports (not users, but the system works for them)

- **NaSIA** — annual licence renewal via SLIMS, inspections with ≤1 week notice; inspectors ask for the admission register, attendance registers, log book, visitors book, staff lists (NTC-licensed), safety records. Termly returns.
- **GES district office** — calendar circulars, termly enrolment/staffing returns, BECE presentation approval.
- **NaCCA** — curriculum and grading conformance (proficiency bands: _Emerging / Developing / Approaching Proficiency / Proficient / Highly Proficient_ — note: not "Beginning/Exceeding").
- **WAEC** — BECE/WASSCE candidate registration (Oct–Nov window, 10-digit index numbers, name/DOB exactly as the birth certificate — mismatches block registration).
- **CSSPS** — post-BECE placement; the JHS administers school-selection forms (now 8 choices with category quotas).
- **MoE EMIS** — annual school census (enrolment by grade/sex/age, staff qualifications, facilities) via the EMIS portal.
- **SSNIT & GRA** — payroll statutory returns (Advanced payroll).
- **Auditors / accountants** — the append-only ledger, double-entry exports, reconciliation reports.

---

## Part II — User stories by cadence

Format: _As a ⟨user⟩, I ⟨do X⟩_ — grouped by rhythm. Stories marked ◆ are supported by shipped or
catalogued features; stories marked ○ are gaps or deferred modules worth tracking.

### 1. Guardian (H1/H2)

**Daily (school days)**

- ◆ I drop my child at the gate and get the check-in confirmation.
- ◆ I get an instant text when my child is released — "Ama was picked up by Kofi Mensah at 15:42."
- ◆ My child is unwell: I tell the WhatsApp assistant at 7am; the absence is recorded and the class teacher told.
- ◆ I get a same-morning SMS if my child was marked absent and I didn't report it.
- ◆ Someone different collects today: I request a same-day dismissal change and see it approved or declined with a note.
- ◆ (Car line, Advanced) I announce my arrival as I approach so my child is brought out.

**Weekly / intermittently**

- ◆ I ask WhatsApp "what do I owe?" at 9pm on a Sunday and get the live balance and a mini-statement.
- ◆ I pay fees from the portal or a payment link by MoMo or card; the receipt arrives without my visiting the office.
- ◆ I pay by bank deposit and photograph the slip; my child's balance updates once the bursar confirms.
- ◆ I read notices and the calendar; I download published learning materials and homework.
- ◆ I add or remove a pickup delegate ("my sister, just this term") and the school approves it.
- ○ I check my balance by USSD on a feature phone (Advanced✱, tier under review).

**Monthly**

- ◆ I receive the fee reminder in the school's own words (gentle first, firmer later) on the day the school chose.
- ◆ I pay an agreed installment on its due date under my payment plan.

**Termly**

- ◆ Start: I receive the bill (fees + optional transport/feeding), the term calendar and the "school reopens" SMS.
- ◆ Mid: I attend the PTA meeting and Open Day announced on the notice board.
- ◆ End: I get the results notification, read the published terminal report on the portal or WhatsApp PDF, download receipts, and see the _next term begins_ date printed on the report.
- ◆ End: I clear outstanding fees — the school may gate report release on clearance.

**Yearly / rarely**

- ◆ I apply for a place for a younger sibling on the public form; sibling discount applies automatically from the second child.
- ◆ I attend graduation (KG2, B9), speech day, Our Day.
- ◆ My BECE candidate: I verify the name/DOB against the birth certificate for WAEC registration, pay mock fees, help choose the 8 CSSPS schools, receive placement.
- ◆ I request a transfer letter when relocating; arrears follow the ledger, records follow the child.

### 2. Student — JHS/SHS (H4)

**Daily** — ◆ attends (register marked by the class teacher), keeps their ID/QR card for the gate and library.
**Weekly** — ◆ signs in with admission number + PIN to check notices, homework and materials; ◆ downloads past questions.
**Termly** — ◆ sits mid-term and end-of-term exams; ◆ reads their published terminal report and attendance percentage; ○ sits CBT mocks on the machine (Advanced).
**Yearly** — ◆ promoted / repeats by the school's decision; B9: mock series, WAEC registration data check, CSSPS choices, BECE, testimonial; SHS3: WASSCE, leaving certificate. ○ Prefect roles, house points, clubs membership are not yet modelled.

### 3. Class teacher — stationed, creche–B6 (C1)

**Daily**

- ◆ I mark the register right after assembly, one tap per child, on my phone, even with no internet.
- ◆ I correct a wrongly-marked child; the family is never double-texted by the correction.
- ◆ I see today's dismissal changes and custody flags for my class before closing.
- ◆ I record marks for today's class exercise in any subject I taught.
- ○ I record a discipline/incident note in the class conduct book (a punishment/misconduct book equivalent is not yet a feature).

**Weekly**

- ◆ I upload homework and notes for my class; nothing reaches families until published.
- ○ I submit my lesson notes/scheme of work for the head's weekly vetting (a real Ghanaian workflow, unmodelled).
- ○ When I am teacher-on-duty, I run assembly, supervise closing, and write the day into the log book (log book unmodelled).

**Termly**

- ◆ Start: I receive my class list (with new admissions and any repeaters) and the term's assessment components.
- ◆ Mid: I enter mid-term test marks; I flag chronically absent children.
- ◆ End: I enter every subject's exam marks; SBA weights to 30, exam to 70; only work actually marked counts.
- ◆ End: I write conduct, interest and teacher remarks (remark banks help; AI drafts on Advanced — I approve every word).
- ◆ End: I check my class's reports before the head vets; attendance totals flow in automatically.
- ◆ I attend the PTA meeting and Open Day to face my class's parents with the record in front of me.

**Yearly**

- ◆ I recommend promotion/repetition per child; year-end promotion carries arrears forward.
- ◆ I hand my class to next year's teacher with the cumulative record intact.

### 4. Class teacher — JHS/SHS administrative (C2)

Everything in C1's daily register/discipline/remarks lane, **minus** subject teaching beyond their own subject, **plus**:

- ◆ I chase the subject teachers whose marks are missing before reports can generate.
- ◆ I assemble my class's reports: conduct + interest + class-teacher remark on top of subject lines from many hands.
- ◆ I administer my form's CSSPS selection forms (B9) and check candidates' registration details.

### 5. Subject teacher — JHS/SHS (C3)

**Daily** — ◆ follows their timetable across classes (clash-free by construction); ◆ enters marks for exercises as they happen, offline-safe.
**Weekly** — ◆ tracks syllabus coverage for each class; ◆ uploads subject materials and past questions.
**Termly** — ◆ defines/confirms this term's assessment components for their subject; ◆ sets the exam paper (○ vetting workflow unmodelled; ◆ AI question generation on Advanced); ◆ marks and enters exam scores (◆ AI script capture from photographs on Advanced); ◆ writes subject remarks.
**Intermittently** — ◆ a substitution covers their classes when away (Advanced).

### 6. Headteacher (B1)

**Daily**

- ◆ I open the dashboard: today's attendance across classes, fees collected this week, anything flagged.
- ◆ I approve overrides that need authority (restricted pickup override — with my reason recorded; BLOCKED has no override).
- ◆ I answer the escalations WhatsApp couldn't: the assistant hands conversations to staff with context.

**Weekly**

- ◆ I review attendance trends and children-at-risk flags.
- ○ I vet lesson notes and check the duty roster (unmodelled).
- ◆ I hold the staff meeting; notices go on the board to staff only.

**Monthly**

- ◆ I review the collection summary — billed, collected, outstanding, percentage — and the defaulter list (I can _see_ money; I cannot _take_ it).

**Termly**

- ◆ Start: I confirm the term is opened correctly — dates, "next term begins", fee structure rolled forward, timetable in force.
- ◆ Mid: mid-term break scheduling; PTA meeting; open day.
- ◆ End: I vet **every** terminal report, write or approve head remarks, then publish — publishing is what releases reports to families.
- ◆ End: I approve regenerating any published report (consent required — families may have read it).
- ◆ End: I sign off the GES/NaSIA termly return exported from live records, and formally **close the term**.

**Yearly**

- ◆ I preside over promotion, graduation (confirmed deliberately — it cannot be undone), speech day.
- ◆ I close the academic year and open the next: new terms, calendars, class lists.
- ◆ I face the NaSIA inspection with registers, staff lists and records exportable on demand.

### 7. Assistant heads & HoDs (B2/B3/B4)

- ◆ B2 daily/weekly: timetable exceptions, substitutions (Advanced), syllabus-coverage review, exams oversight with D1.
- ◆ B3 daily: staff attendance and leave (Advanced); ○ duty roster management (unmodelled); ◆ discipline escalations; registers for inspection.
- ◆ B4 termly: department marks progress, ○ exam-paper vetting chain, teacher support notes.

### 8. Exams officer (D1)

**Termly**

- ◆ I publish the internal exam timetable (calendar events scoped to pupils/staff).
- ◆ I compile broadsheets/tabulation per class once marks close; positions rank by standard competition ranking.
- ◆ I run the report-generation pass and hand the vetting queue to the head.

**Yearly (the BECE/WASSCE cycle overlays every term)**

- ◆ Oct–Nov: I register B9/SHS3 candidates with WAEC — names and DOBs exactly as the birth certificates on file; photos from student records.
- ◆ I run the mock series (mock 1, 2, 3 … are exam series, not terms) with BECE-style aggregates: 4 cores + best 2 electives.
- ◆ I produce the BECE aggregate projection and WASSCE readiness analysis (Advanced).
- ◆ May: BECE sits (now May, results ~mid-July); I supervise CSSPS selection (8 choices, category quotas) and placement follow-through.
- ○ I compile and submit the SBA/CA marks WAEC requires for the 30% component (an export shape worth adding).

### 9. Registrar / admissions officer (D2)

**Daily / intermittently**

- ◆ I move applicants through the pipeline: enquiry → applied → assessed → offered → accepted → enrolled/declined.
- ◆ Accepting creates the student record; the admission number is issued in the school's own pattern, in sequence, never reused.
- ◆ I chase outstanding items on the required-document checklist per level (birth certificate, immunisation card…).
- ◆ I process transfers in (with previous records) and out (transfer letter; ○ testimonial generation unmodelled).
- ◆ I serve records requests from alumni years later — export always works.

**Yearly**

- ◆ Admission season: the public application link goes out on flyers; I print admission letters.
- ◆ I reconcile the admission register (the permanent numbered ledger NaSIA inspects) — Klasio _is_ that register.

### 10. Bursar (E1)

**Daily**

- ◆ I confirm or reject bank-deposit submissions (slip photo attached; rejections carry a reason) — never my own.
- ◆ I watch payments settle from Hubtel/Paystack; every bill's unique reference makes double-application impossible.
- ◆ I answer "what does this family owe?" from the cumulative ledger — arrears included, never a bare this-term figure.

**Weekly**

- ◆ I review the defaulter list and trigger/adjust reminder schedules; ◆ (Advanced) I read the likely-to-fall-behind flags.
- ◆ I import the gateway settlement file; auto-match on reference+amount with fee tolerance; the exception queue gets human eyes. Importing never moves money.

**Monthly**

- ◆ I run payroll: SSNIT tiers, GRA PAYE, payslips, bank/MoMo payout files (Advanced).
- ◆ I produce the collection summary for the head and proprietor.

**Termly**

- ◆ Start: I build/roll forward the fee structure (tuition, PTA, exams, books; optional feeding/transport per child) and **bill the whole term at once**; unpaid balances carry forward automatically.
- ◆ I apply scholarships (each with a written reason), sibling discounts (automatic from the second child), waivers, and agree payment plans.
- ◆ End: I run fee clearance ahead of report release; export financial reports and the double-entry journal for the accountant.

**Yearly**

- ◆ Year-end promotion carries arrears into the new year's bills; I archive the year's financials; auditors get the append-only ledger, where every correction is a visible REVERSAL.

### 11. Accounts clerk / fee collector (E2)

**Daily**

- ◆ I take cash at the office and print a branded receipt with the child's photograph; receipt numbers are strictly sequential even with two of us collecting at once.
- ◆ I record a family's bank-deposit claim with the slip photo — it does not touch the balance until the bursar confirms.
- ○ I collect and reconcile **daily feeding fees** per child per day (a real Ghanaian pattern distinct from termly billing; today it fits only as an optional termly item).

### 12. Front desk / secretary (F1)

**Daily**

- ◆ I approve or decline same-day dismissal-change requests with a note.
- ◆ I take the handoffs the WhatsApp assistant escalates, with the conversation so far in front of me.
- ◆ I send targeted notices on instruction (a class, a level, a route, a picked list) across board + SMS + email + socials.
- ○ I keep the visitors book (unmodelled — the gate log covers pupils, not visitors).

### 13. Gate / security staff (F2)

**Daily**

- ◆ Morning: I check each child in on the gate screen; lateness is visible to the duty teacher.
- ◆ Afternoon: I scan the QR (or take the PIN), see the authorised person's photograph, and get a verdict: **allowed / needs an override / refused with the reason**.
- ◆ A BLOCKED arrangement cannot be overridden by anyone, including me; a RESTRICTED one needs a staff override with a stated reason, recorded separately from the identification.
- ◆ A child can never be released twice in one day, even offline; everything queues and syncs when the network returns.
- ◆ (Car line, Advanced) I work the staging queue display; (emergency, Advanced) I trigger the lockdown broadcast drill.

### 14. System administrator (F3)

- ◆ Intermittently: I install/renew the licence file (Settings → Licence), create staff accounts in their roles, connect integrations (SMS credits, Hubtel/Paystack keys, WhatsApp, socials), restore from backup, run updates — all **without seeing a child's record or a cedi**.
- ◆ I can put anyone on any role, including roles full of access I do not have myself — that is the job the school employs me for. What I hand out beyond my own reach is recorded against my name, and I am the one answerable if somebody ends up with more than they needed.
- ◆ What I cannot do: make another proprietor, or narrow the one we have.
- ◆ I force a password change when a laptop goes missing; that signs the person out everywhere **and sends them their own link to choose a new one** — I never see it, so I can never sign in as the bursar.
- ◆ On a LAN box: I keep the mini-PC alive (UPS, disk, backup shipping) with the vendor's fleet tooling behind me.

### 15. School nurse (G1)

- ◆ Daily: I see medical notes and allergies on the child's record before treating; I call the primary guardian first.
- ○ I log sick-bay visits and medication given (an incident/visit log is unmodelled; medical notes are static fields today).
- ◆ Termly: immunisation-card status via document checklists.

### 16. Librarian / learning materials (G3)

- ◆ Weekly: I curate uploads by subject, level and class; publish deliberately; watch download tracking.
- ○ Book lending/returns and textbook inventory (the NaSIA stock book) are unmodelled.

### 17. Counsellor (G2)

- ◆ Weekly: I work the children-at-risk flags raised from attendance and results patterns (Advanced).
- ◆ Yearly: I guide B9 families through the 8-school CSSPS selection.
- ○ Session/case notes with tighter-than-teacher confidentiality are unmodelled.

### 18. Transport crew (F4, Advanced)

- ◆ Daily: the manifest tells me who should be on my bus; I scan boarding and alighting; guardians see the pickup notifications; live GPS shows the bus.
- ◆ Termly: per-term transport billing per child per route.

### 19. Proprietor (A1)

- ◆ Weekly/monthly: dashboards — enrolment, collection percentage, outstanding, staff; (Advanced) plain-English questions: "which classes are furthest behind on fees this term?"
- ◆ Termly: signs the big decisions — fee levels, concession policy, staff changes; reads the termly return before it goes out.
- ◆ Yearly: renews the NaSIA licence (SLIMS), the Klasio annual subscription, and the annual EMIS census return; approves next year's fee structure.
- ◆ My account can never be narrowed or locked out — including by mistake.

### 20. Vendor operator & technician (I1/I2)

- ◆ Intermittently: mint a licence for a new school (tier bundle + any extra entitlement codes, expiry, grace); renew before expiry (expiry must never be an upgrade); withdraw when a school lapses — knowing a withdrawal is a record that never reaches an offline box.
- ◆ Watch heartbeats from internet-facing boxes; chase silent ones.
- ◆ Deploy: cloud VM or LAN mini-PC in under a day; migration quoted after seeing the records (clean spreadsheets / spreadsheets+paper / paper only); train per role (bursar, teachers, head); leave the box on the school's own branding from the first sign-in screen.

---

## Part III — The lifecycle calendars (cross-role choreography)

### A term, opened to closed

| Phase             | Who                           | What happens                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**          | Head + bursar + IT            | Term dates set (start, end, **next term begins** — GES moves dates, so these are always school-controlled); fee structure rolled forward; bills issued with the reopening SMS; class lists confirmed; timetable in force; assessment components confirmed per subject/level.                          |
| **Running**       | Everyone                      | Daily registers, gate check-in/out, marks as they happen, payments settling, reminders firing on schedule, notices flowing.                                                                                                                                                                           |
| **Mid-term**      | Head, teachers, exams officer | Mid-term break on the calendar; mid-term tests marked and entered; chronic-absence flags reviewed; PTA meeting.                                                                                                                                                                                       |
| **Closing weeks** | Exams officer, all teachers   | Exam timetable published; papers set (○ vetting), sat, marked; marks entered; SBA scales to 30, exam to 70.                                                                                                                                                                                           |
| **Close**         | Exams officer → head → bursar | Broadsheets compiled; reports generated with remarks; head vets **every** report; fee clearance gate applied; reports **published** (results SMS, WhatsApp PDFs); GES/NaSIA termly return exported; Our Day; term formally closed — after which registers and marks for the term are settled history. |

### An academic year, opened to closed

| Phase               | What happens                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open (Sep)**      | New year + 3 terms created; classes/streams rolled; new intake enrolled from the admissions pipeline; fee structures set; WAEC registration season begins for the new B9/SHS3.                                                                                                                                            |
| **Running**         | The three term cycles above; mock series for candidates; annual EMIS census when the window opens; NaSIA renewal 3 months before licence expiry.                                                                                                                                                                          |
| **Close (Jul–Aug)** | Term 3 closes; **promotion run** — every child promoted / repeated / graduated, arrears carried forward onto next year's bills; **graduation confirmed deliberately (irreversible)**; B9/SHS3 leavers get testimonials and move to the alumni archive; transfer letters for leavers; year archived; the next year opened. |

### Always-on / no fixed cadence

- Enrolments, transfers and withdrawals happen any day of the term.
- Custody changes (a court order arrives → BLOCKED takes effect at the gate immediately).
- Delegate additions and expiries; lost pickup cards reprinted.
- Incidents: sick bay, discipline, emergency broadcast/lockdown.
- Staff joining/leaving: account provisioning, password resets, role changes, payroll changes.
- Licence events: renewal install, grace banner, lapse-to-Basic (the register must still work the morning after a holiday lapse; export works in every state).
- Audit: any dispute — a fee balance, a pickup, a changed mark — answered from the forensic change log and the append-only ledger.

---

## Part IV — Gaps surfaced by this research (candidate backlog)

Ranked roughly by how often Ghanaian schools would hit them:

1. **Daily feeding-fee collection** — per-child, per-day small cash with daily reconciliation; distinct from termly optional items. (E2, F5)
2. **Log book & teacher-on-duty roster** — the head's/duty teacher's daily record; NaSIA inspects it. (B3, C1)
3. **Lesson-note / scheme-of-work vetting** — a weekly submit→vet→return loop between teachers and the head. (C1/C3 ↔ B1)
4. **Discipline / incident book** — recorded incidents with escalation trail (class teacher → section head → head). (C1, B3)
5. **Visitors book** — front-desk log distinct from the pupil gate log. (F1)
6. **Exam-series-that-are-not-terms** — mock 1..n with BECE-style aggregates (4 cores + best 2 electives), mock fees as fee items. (D1) _(partially served by CBT/mocks, Advanced)_
7. **WAEC SBA export** — the CA component schools must submit for the BECE 30%. (D1)
8. **CSSPS selection capture** — record the 8 choices per candidate, print selection sheets. (D1, G2)
9. **EMIS annual census auto-fill** — enrolment by grade/sex/age + staff qualifications, shaped for the portal. (A1, B3)
10. **Testimonial & leaving-certificate generation** — sibling documents to the transfer letter. (D2)
11. **Sick-bay visit log** — dated visits/medication against the medical record. (G1)
12. **House system & prefects** — houses, house points, prefect titles on students; inter-house events. (G5, H4)
13. **Textbook/library lending & inventory** — the stock book NaSIA asks about. (G3)
14. **SHS semester calendars** — if SHS schools are targeted: semesters, per-form date variance, GPA/CGPA transcripts (Student Transcript Portal direction — still unstable, watch before building).
15. **NaCCA band naming check** — ensure shipped proficiency-band defaults read _Emerging / Developing / Approaching Proficiency / Proficient / Highly Proficient_.
16. **Hostel/boarding module** (already deferred) — exeats, weekend custody, matron workflows for boarding SHS. (G6)

Items 1–5 are inspection-facing paper registers Klasio could absorb outright — "everything NaSIA
asks for, printable on demand" is a sales line no competitor in the July 2026 research owns.
