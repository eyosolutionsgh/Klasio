# 09 — Implementation Status Audit

An audit of the codebase on `main` (21 Jul 2026, at commit `5323d4f`) against every user story in
[08-user-types-and-user-stories.md](08-user-types-and-user-stories.md). Six parallel code audits
covered the SIS, attendance/assessment, fees/payments, safety/transport, communications/portals,
and platform/lifecycle surfaces; every verdict below was checked against actual API code **and**
web UI wiring, with file references.

**Statuses:**
- ✅ **Implemented** — API endpoints and web UI both exist and are wired end to end.
- 🟡 **Partial** — the core exists but a named sub-behaviour is missing (each gap stated).
- ❌ **Missing** — no model, endpoint, or UI.
- ⛔ **Skipped by decision** — deliberately not built (recorded in memory/docs).

---

## Headline summary

| | Count |
|---|---|
| ✅ Fully implemented | **63** |
| 🟡 Partial | **13** |
| ❌ Missing | **10** |
| ⛔ Skipped by decision | 2 (USSD, live GPS) |

The product substantially delivers the catalogue: every daily-operations story (registers, marks,
gate, fees, portals, WhatsApp) is fully wired. The gaps cluster in four places:

1. **Two real defects in shipped features** (§Defects below) — the deposit separation-of-duties
   guard was never written, and the republish-consent flow cannot be completed from the UI.
2. **The term/year close lifecycle** — doc 08 Part III describes closure as a deliberate act;
   the code models only an `isCurrent` flag flip, and promotion is whole-class with no per-child
   repeat.
3. **The regulator-facing surface** (WAEC registration, CSSPS, EMIS, SBA export, admission
   register artifact) — entirely absent, as doc 08 Part IV predicted.
4. **The Ghanaian paper registers** (log book, duty roster, lesson-note vetting, discipline book,
   visitors book, daily feeding fees) — entirely absent, as doc 08 Part IV predicted.

### Defects found in shipped features (fix first)

| Defect | Where | Detail |
|---|---|---|
| **Clerk can confirm their own bank deposit** | `apps/api/src/fees/fees.module.ts:1243-1303` | `submittedById` is recorded on submission (`:1168`) but `confirmDeposit` never compares it to `auth.sub`. The permission split (`fees.deposit_submit` vs `fees.deposits`) implies the rule, and `hr.module.ts:215` implements the same pattern for leave — the guard is simply absent here. FEATURES.md §17 promises it ("an accounts clerk … cannot confirm their own bank deposits"). |
| **Republish consent cannot be completed from the UI** | `apps/web/src/components/ReportActions.tsx:55` | The API refuses regenerating a published report without `regeneratePublished: true` (`assessment.module.ts:718`) — correct. But the UI never sends that flag, so a head who *wants* to consent and republish only ever sees the error. There is no confirm-and-resend path. |
| **No SMS on morning drop-off** | `apps/api/src/pickup/pickup.module.ts:612-682` | Release fires `notifyRelease` (`:537-571`); `checkIn()` writes log + audit only. The guardian story "I drop my child and get the check-in confirmation" is half-served. |
| **Media uploads not licence-gated** | `apps/api/src/resources/resources.module.ts:222-236` | Video/audio is catalogued Advanced, but on `main` the whole controller sits behind `resources.documents` only; no `resources.media` code exists in the entitlements catalogue. (A full per-file-gated, streaming implementation exists on the unmerged branch `claude/cranky-dijkstra-03d1ad` — it never landed on `main`.) |

---

## 1. Student records & admissions (Registrar D2, guardian admission stories)

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Student records: bio, photo, multiple guardians (relationship, primary, canPickup, custody), medical notes, documents | ✅ | `students.module.ts:80-113,296-337,828-918`; UI `students/[id]/page.tsx:221-249` | |
| Admission numbers: school pattern, sequential counter (not row count), never reused | ✅ | `schema.prisma:72-75`; `students.module.ts:379-417` | |
| Required-document checklists per level | ✅ | `customfields.module.ts:219-357`; `schema.prisma:1622` | |
| Custom fields on student records | ✅ | `customfields.module.ts:113-343`; `schema.prisma:1589-1620` | |
| Levels creche→SHS, classes; multi-campus | 🟡 | `schema.prisma:279-284,315,327-335`; `schools.module.ts:634-679` | **No stream concept** — streams are free-text class names only. Campus is an organizational label; no per-campus reporting rollups. |
| Enrolment statuses with dates/reasons; alumni archive | 🟡 | `schema.prisma:368`; `students.module.ts:734-752`; alumni tab `students/page.tsx:32-35` | **Transfer letters and testimonials missing** — lifecycle records status+reason but generates no leaver documents (`common/pdf.ts` has no transfer-letter/testimonial builder). |
| Promotion with arrears carry-forward; deliberate irreversible graduation | 🟡 | `students.module.ts:695-732` (graduate requires explicit flag `:713-718`); UI `PromoteClass` | **Whole-class bulk only.** No per-child promote/**repeat**/graduate decisions in one run — a child cannot be held back while classmates move. Not orchestrated as a year-end run. |
| Admissions: public form, pipeline with counts, accept→student, letters, docs, unique reference | ✅ | `admissions.module.ts:126-135,275-307,397-460,542-614`; `apply/[schoolId]/page.tsx` | |
| Spreadsheet import/export; search/filter/sort | ✅ | `onboarding.module.ts:113-142,339-361`; `students.module.ts:999-1098,163-219` | |
| Student ID cards with QR | ✅ | `students.module.ts:936-997`; `common/pdf.ts:1063` | |
| Sibling guardian dedupe by phone; one-primary invariant | ✅ | `students.module.ts:483-635`; `admissions.module.ts:181` | |
| Alumni records/transcript requests | ❌ | Exports work for GRADUATED students, but no request-tracking workflow or transcript document exists. | |
| Cumulative record card | 🟡 | `assessment.module.ts:930-1012` (year-on-year academics, attendance, trend); UI on student page | **Academic + attendance only** — no conduct or health history year-on-year. |
| Admission register as a NaSIA-facing printable artifact | 🟡 | Generic student export only (`students.module.ts:999-1060`) | No dedicated, labelled "Admission Register" export shaped as the permanent numbered ledger inspectors ask for. |

## 2. Attendance & assessment (Teachers C1–C3, Exams officer D1)

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Daily register (P/A/L/E), one mark per child per day, correction | ✅ | `attendance.module.ts:93-134` (upsert on `studentId_date`) | |
| Offline register: queue/replay, stale-replay guard, 401 keeps work | ✅ | `lib/offline.ts:21-195`; `common/replay.ts`; `attendance.module.ts:130` | |
| Same-morning absence texts, deduped on correction | ✅ | `attendance.module.ts:158-193` (`ABS-date-student` key) | |
| Term totals feed terminal reports | ✅ | `assessment.module.ts:684-695` | |
| Trends, chronic-absence flags, children-at-risk | ✅ | `attendance.module.ts:214-271`; `ai/ai.module.ts:529`; `common/risk.ts` | |
| Staff attendance & leave (self-decision blocked) | ✅ | `hr.module.ts:75-231` (`:216` blocks own leave decision) | |
| Configurable assessment components, scoped; only marked work counts | ✅ | `assessment.module.ts:110-238`; `common/weighting.ts` (null, not zero) | |
| SBA 30 / exam 70 adjustable; early-years no-exam | ✅ | `assessment.module.ts:155-215`; early-years branch in `weighting.ts` | Weights are school-wide; early-years mode keys off the level's scheme kind, which serves the story. |
| Grading schemes (GES/NaCCA/early-years) per level; 0–100 band validation | ✅ | `assessment.module.ts:128,548`; `common/grading.ts` | Band editor is a minimal textarea, functional. |
| Class positions: standard competition ranking on subject average | ✅ | `assessment.module.ts:504-513,649-661`; early-years exempt | |
| Generate → publish gate; republish consent | 🟡 | Publish/notify `assessment.module.ts:856-882`; consent required `:718` | **No UI path to complete a consented republish** (`ReportActions.tsx:55` never sends the flag). No modelled "checked" state between generate and publish (head review is out-of-system). |
| GES-faithful A4 PDF + modern template; crest/motto/next-term-begins | ✅ | `common/pdf.ts:186-297`; on-screen render `reports/[studentId]/[termId]/page.tsx` | |
| Broadsheets per class, view + export | ✅ | `assessment.module.ts:1151-1377` | |
| Conduct/interest/teacher/head remarks; remark banks by performance | ✅ | `assessment.module.ts:822-829`; `remarks.module.ts:65` | |
| AI remark writer (draft only, human saves) | ✅ | `ai/ai.module.ts:100`; `ReportRemarks.tsx:100` | |
| AI script capture (photo → suggested scores → review → save) | ✅ | `ai/ai.module.ts:192`; `marks/capture/page.tsx` | |
| BECE aggregate projection (4 cores + best 2) & WASSCE readiness | ✅ | `common/exam-analytics.ts:54`; `reports/outlook/page.tsx` | |
| CBT, question banks, AI question generation, auto-marking, post-to-gradebook | 🟡 | `exams.module.ts:92-449`; `ai.module.ts:147`; student sitting `student/exams` | **Mock exam *series* distinct from terms are not modelled** — CBT attaches to the current term; no mock-1/2/3 objects with BECE-style per-series aggregates (doc 08 gap #6 confirmed unbuilt). |
| Timetable: day template, weekly builder, clash refusal naming the clash, class+teacher views, rooms | ✅ | `timetable.module.ts:145-464`; `common/timetable.ts` | |
| Syllabus coverage; timetable auto-draft; substitutions | ✅ | `syllabus.module.ts`; `timetable.module.ts:486-713` (deterministic solver, review-then-apply) | |
| Marks entry offline + autosave | ✅ | `marks/page.tsx:104-129`; per-cell stale guard `assessment.module.ts:463` | |
| Exam timetable publication | 🟡 | Generic audience-scoped calendar events only (`calendar.module.ts:104-178`) | No purpose-built exam-timetable object (subject × date × session/room grid). |
| Lesson-note vetting, duty roster, log book, discipline/incident book | ❌ | Repo-wide search: no models, endpoints, or UI | Doc 08 Part IV gaps #2–4 confirmed. |

## 3. Fees, payments & payroll (Bursar E1, Clerk E2)

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Fee items per term/level; optional items per subscribing child | ✅ | `fees.module.ts:171-177,342-364,418-451,532-557` | |
| Bill whole term; rollover; arrears carry-forward (`asOfTerm`) | ✅ | `fees.module.ts:396-500,1520-1561,259-283` | |
| Append-only ledger, REVERSAL corrections, `NumberSequence` documents | ✅ | `fees.module.ts:962-1009`; `common/sequences.ts` | |
| Cash payment with branded receipt incl. child photo | ✅ | `fees.module.ts:1077-1125,1336-1397` | |
| Bank deposit: slip photo → confirm / reject with reason | 🟡 | `fees.module.ts:1133-1328` | **Self-confirmation not blocked** — see Defects. |
| Statements; defaulters computed-then-paged (not SQL-paged); collection summary | ✅ | `fees.module.ts:682-831,285-335` | |
| Scholarships (reason required), auto sibling discounts, waivers, time-boxed | ✅ | `fees.module.ts:212-229,1021-1074,1750-1786`; `common/concessions.ts` | |
| Payment plans with due dates that never define the balance | ✅ | `fees.module.ts:1404-1509` | |
| Automated reminders: day+hour schedule, school wording, gentle/firm escalation | ✅ | `fees.module.ts:154-159,590-636,2182-2280`; `common/templates.ts` | |
| AI default-risk (families likely to fall behind) | ✅ | `ai/ai.module.ts:457-527`; `common/risk.ts` | |
| Double-entry journal export; ledger/defaulter exports | ✅ | `fees.module.ts:838-947`; `common/journal.ts` | Journal/summary export in XLSX/CSV only, no PDF variant — minor. |
| Online payments: Hubtel + Paystack, MoMo/cards, no-login pay links, unique refs, signature verify, re-query, idempotent, verify-before-dedupe | ✅ | `payments.module.ts:228,337-599,700-709,887-898`; `common/payments/*` | |
| Flutterwave diaspora | ✅ | `common/payments/flutterwave.ts`; wired `payments.module.ts:122-125` | |
| USSD balance/payment | ⛔ | Entitlement flag exists (`comms.ussd`) with no service behind it | Skipped by decision. |
| Reconciliation: import, auto-match with tolerance, exception queue, import moves no money | ✅ | `reconciliation.module.ts:79-317`; `common/reconcile.ts` | |
| Payroll: SSNIT tiers, GRA PAYE, payslips, bank/MoMo payout files | ✅ | `hr.module.ts:521-585`; `common/payroll.ts:436-441` | |
| **Fee clearance gating report release** | ❌ | No balance check anywhere on report serving (`guardian.module.ts:835-900`) | Specified in two doc-08 stories (E1, H1); near-universal Ghanaian practice. Biggest missing *feature* in the money domain. |
| Daily feeding-fee collection (per child per day) | ❌ | Feeding exists only as an optional termly `FeeItem` | Doc 08 gap #1 confirmed. |
| Guardian portal payment, receipts, history | ✅ | `guardian.module.ts:407-444,601-630,849-898`; `family/page.tsx:322-346` | |

## 4. Pickup, safety & transport (Gate F2, Transport F4)

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Authorised list (guardians + photographed delegates); delegates expire by default | ✅ | `pickup.module.ts:126-224` (term end or +90d) | |
| RESTRICTED override with separately-recorded reason; BLOCKED absolute | ✅ | `common/pickup.ts:44-81`; `schema.prisma:1015-1017` | |
| Check-in + check-out on one gate device; browser QR + PIN fallback | ✅ | `pickup/page.tsx:160-226,456-473`; `QrScanner.tsx` (BarcodeDetector) | |
| Printed pickup cards; reissue; revoke | ✅ | `pickup.module.ts:250-345` | |
| Photo before release; allowed/override/refused-with-reason verdict | ✅ | `pickup/page.tsx:520-569`; `common/pickup.ts:65-76` | |
| No double release in a day, incl. offline (`clientRef` dedupe) | ✅ | `pickup.module.ts:399-503`; `schema.prisma:1027` | |
| Immutable release log; collector name captured at the time | ✅ | `schema.prisma:1006-1029`; delegate soft-delete preserves history | |
| Instant guardian SMS on pickup and drop-off | 🟡 | Release SMS `pickup.module.ts:537-571` | **Check-in sends no SMS** — see Defects. |
| Dismissal-change requests (portal + WhatsApp) → decide with note + SMS | ✅ | `family/page.tsx:173-188`; `whatsapp.module.ts:498-507`; `pickup.module.ts:868-905` | |
| Car line: announce arrival, staging queue display | ✅ | `guardian.module.ts:500-511`; `pickup.module.ts:720-773` | |
| Emergency broadcast & lockdown (typed-word confirm) | ✅ | `broadcasts.module.ts:94-105,608-612`; `EmergencyAlert.tsx` | |
| Dismissal analytics: wait times, per-collector history | ✅ | `pickup.module.ts:802-837`; `pickup/analytics/page.tsx` | |
| Gate offline queue | ✅ | `lib/offline.ts` (IndexedDB, ordered replay, idempotent appends) | |
| Transport: routes/stops, manifests, boarding/alighting scans, per-term billing | ✅ | `transport.module.ts:66-366` | |
| Live GPS tracking | ⛔ | `transport.module.ts:3-4` states the deliberate scope | Skipped by decision. |
| Visitors book (front-desk, distinct from pupil gate log) | ❌ | No `Visitor` model | Doc 08 gap #5 confirmed. |

## 5. Communications & portals (Guardians H1/H2, Students H4, Front desk F1)

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Notice board: audience + channels in one send | 🟡 | API scopes ALL/CLASS/LEVEL/ROUTE/CUSTOM (`broadcasts.module.ts:63-65,267`) | **Composer UI exposes only ALL/CLASS/LEVEL** — ROUTE has no UI anywhere; picked-list (CUSTOM) exists only in the SMS-only composer. |
| Bulk SMS: sender name, PAYG credits, per-recipient delivery record | ✅ | `sms.module.ts:281-311,385` | |
| Email to parents; targeted messaging | 🟡 | `broadcasts.module.ts:214-248,472-526` | Same UI gap: route targeting API-only. |
| Social publishing (FB/IG/X/TikTok) alongside SMS/email | ✅ | `social.service.ts:54-181`; single fan-out `broadcasts.module.ts:307,528` | X/TikTok env-gated (paid API tier / audited app) — present, off by default. |
| School-authored wording for all five automatic message kinds | ✅ | `common/templates.ts:17-47`; editor `ReminderSettings.tsx` | |
| WhatsApp structured flows (balance, statement, results, attendance, absence→teacher, pickup change, notices, handoff) | ✅ | `whatsapp.module.ts:309-544,569` | |
| WhatsApp identity & isolation; reply-only | ✅ | `whatsapp.module.ts:41-47,160-285,611` | |
| WhatsApp AI free-text NLU (intent routing only) | ✅ | `whatsapp.module.ts:304-307`; `ai.module.ts:424-453` | |
| Report cards delivered over WhatsApp as PDF | 🟡 | `resultsAnswer` text + portal link (`whatsapp.module.ts:406-427`) | **Provider sends text only** (`:66-88`) — no document/media send, so the FEATURES.md promise of WhatsApp PDF delivery is unmet; parents are redirected to the portal. |
| Family portal (OTP by SMS/email, no enumeration, multi-child, fees/attendance/published reports/receipts/pay/dismissal/notices, isolation) | ✅ | `guardian.module.ts:97-210,392-795,887-900`; `family/page.tsx` | |
| Student portal (admission no + PIN; no PIN = no sign-in; balance/attendance/reports/notices/materials; CBT sitting) | ✅ | `student-portal.module.ts:123-363`; `student/exams/page.tsx` | |
| Learning materials: draft→publish, tags, download tracking, video/audio | 🟡 | `resources.module.ts:83-96,110-116,264-303,395-427` | **Media not separately licence-gated** — see Defects. |
| Calendar: audience-scoped, per-level, in both portals | ✅ | `calendar.module.ts:104-178`; consumed by both portals | |
| Dashboard natural-language questions | ✅ | `ai.module.ts:260-350` (routes to fixed report set, deterministic fallback); `AskData` on dashboard | |
| In-app user guide with the school's name | ✅ | `guide/page.tsx:64`; `help/page.tsx` | |

## 6. Platform, roles, lifecycle & compliance (Head B1, IT F3, Proprietor A1)

| Item | Status | Evidence | Gap |
|---|---|---|---|
| 13 ready-made roles; custom roles; per-person adjustment; can't-grant-what-you-don't-hold; separation of duties; owner unlockable | ✅ | `common/permissions.ts:289-516`; `roles.module.ts:108-212`; `users.module.ts:108-181` | The one SoD hole is the deposit defect (§3). |
| Password lifecycle: tokenVersion sign-out-everywhere, lockout throttle, reset by email or SMS | ✅ | `users.module.ts:241-305`; `auth.module.ts:95-142,190-435`; `common/auth.ts:193` | |
| Audit log: before/after, searchable UI, export | ✅ | `audit.module.ts:46-126`; `db.audit`/`db.auditChange` across modules | Coverage is a per-author convention, not interceptor-enforced. |
| GES/NaSIA termly returns, roll as-at-term, Excel/CSV | ✅ | `returns.module.ts:51-208`; `common/returns-roll.ts` | |
| Export everything; works in every licence state | ✅ | `common/export.ts`; `platform.export` in the BASIC bundle (`entitlements.ts:20`) | |
| Academic year + terms with next-term-begins; atomic current switch | ✅ | `schools.module.ts:92-110,413-526` | |
| **Explicit term/year close lifecycle** | ❌ | `Term`/`AcademicYear` carry only `isCurrent` (`schema.prisma:260,274`) | No `closedAt`/status, no close operation, no settled-history semantics, and promotion is not linked to a year-close step. Doc 08 Part III describes this as the core choreography; it is the largest *structural* gap. |
| School setup & branding: crest/colour/motto everywhere, per-door sign-in photos, /setup wizard | ✅ | `schools.module.ts:271-409`; `setup.module.ts:193-296` | |
| Licence: install paths, grace banner, lapse→BASIC, entitlement gating | ✅ | `licence.service.ts:211-297`; `auth.module.ts:494-497` | |
| Integrations: read-only API keys | 🟡 | `integrations.module.ts:86-219` | **No outbound webhooks** (catalogue lists "API access & webhooks"); external API is read-only by design. |
| Offline platform: SW, queue rules (network queued, rejection dropped-but-named, 401 keeps work), PWA | ✅ | `lib/offline.ts:71-207`; `public/sw.js`; `manifest.webmanifest` | |
| Dashboard KPIs (money gated on `fees.view`) | ✅ | `dashboard.module.ts:10-144` | |
| Staff records / attendance / leave / payroll separation | 🟡 | `users.module.ts`; `hr.module.ts` | Staff record = account + role; **no NTC licence/qualification fields**, which the NaSIA staff list and EMIS census both want. |
| WAEC registration export, CSSPS choice capture, EMIS census, WAEC SBA export | ❌ | `returns` module holds only the termly summary | Doc 08 gaps #7–9 confirmed; the whole exam-body/compliance surface beyond termly returns is unbuilt. |
| Multi-campus | ✅ | `schools.module.ts:634-679`; gated `platform.multicampus` | |
| Vendor portal (licences, heartbeats) separate from the school box | ✅ | `apps/vendor` (own Prisma, e2e suite) | Not audited deeply here. |

---

## Consolidated gap list (ranked, deduplicated)

**Defects in shipped behaviour — small fixes, do first**
1. Deposit self-confirmation guard (one `if` in `confirmDeposit` — the pattern already exists in `hr.module.ts:215`).
2. Republish-consent UI path (send `regeneratePublished: true` behind a confirmation dialog).
3. Drop-off check-in SMS (mirror `notifyRelease` in `checkIn`, with a `CHECKIN` template).
4. Land or re-do the `resources.media` entitlement gating (exists on the unmerged `claude/cranky-dijkstra-03d1ad` branch with streaming + 512MB caps; `main` has buffered 200MB uploads with no gate).
5. Broadcast composer: expose ROUTE and picked-list audiences the API already supports.

**Missing features that existing stories depend on**
6. Fee clearance gate on report release — near-universal Ghanaian practice, specified in doc 08.
7. Explicit term/year close lifecycle + per-child promotion run (promote/repeat/graduate in one pass).
8. WhatsApp document sending (report-card PDF delivery, promised in FEATURES.md §4).
9. Mock exam series distinct from terms, with BECE-style per-series aggregates.
10. Transfer letters and testimonials (leaver documents).

**Regulator-facing surface (doc 08 Part IV #7–9, all unbuilt)**
11. WAEC candidate-registration export (names/DOB/photos as per birth certificates).
12. CSSPS choice capture (8 schools, category quotas) + selection sheets.
13. EMIS annual census export; NTC licence/qualification fields on staff records.
14. WAEC SBA (continuous assessment) export; dedicated Admission Register artifact.

**Ghanaian paper registers (doc 08 Part IV #1–5, all unbuilt)**
15. Daily feeding-fee collection; log book + teacher-on-duty roster; lesson-note vetting;
    discipline/incident book; visitors book.

**Smaller completeness items**
16. Streams as a first-class concept; conduct/health on the cumulative record; exam-timetable
    builder; records-request workflow for alumni; outbound webhooks; PDF variants of financial
    summaries; "checked" state between report generation and publish.

⛔ **Deliberately out of scope** (do not build without a new decision): USSD flows, live GPS
vehicle tracking, native mobile apps, full LMS, canteen wallets, hostel/boarding.
