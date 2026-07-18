# 02 — Feature Catalog & Package Tiers

Every feature below is tagged with the package that unlocks it:

- **B = Basic (Free)** — any school can sign up and run daily operations at no cost. Generous enough to be truly useful (the acquisition engine), bounded by student count and premium modules.
- **M = Medium** — the paid workhorse tier: full billing + online payments, communication automation, pickup security, document sharing.
- **A = Advanced** — AI suite, WhatsApp chatbot, transport, payroll, analytics, multi-campus.

The same tiers apply to standalone deployments; the tier is fixed by the vendor-signed license and can only be changed by the vendor (see [03-architecture.md](03-architecture.md)).

> Limits marked ✱ are indicative and finalized during pricing design.

## 2.1 Student Information System (SIS)

| Feature                                                                                                                                        | Tier                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Student records: bio-data, photo, guardians (multiple per student, with relationship + custody flags), medical notes, documents                | B                                      |
| School structure: campuses→levels (creche/nursery/KG/primary/JHS/SHS)→classes/streams, academic years, 3-term calendar with "Next Term Begins" | B                                      |
| Enrollment, promotion (with arrears carry-over), transfers, withdrawals, alumni archive                                                        | B                                      |
| Student count limit                                                                                                                            | B: ≤ 150✱ · M: ≤ 1,000✱ · A: unlimited |
| Admissions: online application form, applicant pipeline, admission letters                                                                     | M                                      |
| ID card generation (with QR used for pickup verification; canteen-ready for the future module)                                                 | M                                      |
| Custom fields & document checklists per level                                                                                                  | M                                      |
| Multi-campus management under one account                                                                                                      | A                                      |

## 2.2 Attendance

| Feature                                                                                               | Tier |
| ----------------------------------------------------------------------------------------------------- | ---- |
| Daily class attendance (present/absent/late/excused), register view, term totals feeding report cards | B    |
| Attendance dashboards & chronic-absence flags                                                         | M    |
| Guardian absence alerts (SMS/WhatsApp) on marking                                                     | M    |
| Staff attendance & leave tracking                                                                     | A    |
| AI attendance-risk insights (patterns predicting dropout/default)                                     | A    |

## 2.3 Assessment, Grading & Terminal Reports

The emotional core of the product for Ghanaian schools.

| Feature                                                                                                                                                                                          | Tier |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| SBA engine: configurable continuous-assessment components, scaling, SBA/exam weighting (default 30/70)                                                                                           | B    |
| Grading schemes: GES classic (scores, grades, subject & class positions), NaCCA proficiency bands (Beginning/Approaching/Meeting/Exceeding), early-years observation scales; per-level selection | B    |
| Terminal report cards: pixel-faithful GES format + modern format; attendance count, conduct, interest, teacher & head remarks, next-term date; PDF export                                        | B    |
| Broadsheets / tabulation sheets, class ranking                                                                                                                                                   | B    |
| Teacher marks entry: web + mobile, autosave, works offline                                                                                                                                       | B    |
| Remark banks (reusable comment libraries)                                                                                                                                                        | M    |
| Report card push delivery (SMS result links, notifications on publish)                                                                                                                           | M    |
| Report card delivery via WhatsApp PDF                                                                                                                                                            | A    |
| **AI remark writer** — drafts personalized teacher/head remarks from the student's data (teacher approves/edits)                                                                                 | A    |
| **AI script capture** — photograph marked scripts/registers → OCR scores into the gradebook (IntuitiveSBA pattern)                                                                               | A    |
| Exam analytics: subject/teacher/cohort trends, BECE aggregate projection vs CSSPS targets, WASSCE readiness                                                                                      | A    |
| CBT / mock exams (BECE/WASSCE prep, question banks, auto-marking)                                                                                                                                | A    |

## 2.4 Fees, Billing & Payments

| Feature                                                                                                                                                                                      | Tier |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Fee structures per level/class/term: tuition, PTA, exam, books, admission + per-student optional items (transport, feeding)                                                                  | B    |
| Term invoice generation (bulk, one-click rollover to next term), arrears carry-forward                                                                                                       | B    |
| Manual payment recording (cash, bank deposit w/ proof upload + confirm workflow), branded PDF receipts with student photo                                                                    | B    |
| Student ledger, defaulter lists, collection dashboard (collected vs expected)                                                                                                                | B    |
| Discounts, waivers, scholarships, sibling discounts — with reason notes & audit trail                                                                                                        | M    |
| Installment plans with per-installment due dates                                                                                                                                             | M    |
| **Online payments**: MTN MoMo / Telecel Cash / AT Money / cards via Hubtel + Paystack (+ Flutterwave for diaspora), unique payment reference per invoice, gateway webhooks + status re-query | M    |
| Automated fee reminders (SMS/WhatsApp templates, schedules, escalation)                                                                                                                      | M    |
| **Reconciliation suite**: auto-match on reference+amount, gross-vs-net fee tolerance, settlement report import, 3-way match, unmatched-payment exception queue                               | M    |
| USSD fee payment & balance check (feature phones)                                                                                                                                            | A✱   |

> ✱ USSD sits in Advanced only because of aggregator setup/session costs; it is in tension with the "meet parents where they are" principle. Feature-phone reach at B/M comes via SMS and printed pickup/PIN cards. Revisit USSD's tier after pilot cost data — moving it to Medium is the preferred outcome if economics allow.
> | **AI default-risk prediction** & collection-strategy nudges | A |
> | Fee income accounting exports; double-entry mini-ledger; Excel/PDF financial reports | A |

## 2.5 Pickup & Drop-off Safety

| Feature                                                                                                                                    | Tier |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Authorized pickup list per student (guardians + delegates), school override, custody red-flags                                             | M    |
| Handoff verification: QR on ID/pickup card + PIN fallback + guardian photo confirmation; **printed card path for no-smartphone guardians** | M    |
| Staff check-out/check-in app (offline-capable scanner), immutable release log (who, whom, when, mode)                                      | M    |
| Instant guardian notification on pickup/drop-off ("Ama was picked up by Kofi Mensah at 15:42")                                             | M    |
| Same-day dismissal-change requests (guardian PWA → front-office approval)                                                                  | M    |
| Car line management: guardian "announce arrival" (GPS/geofence), staging queue display                                                     | A    |
| Bus/transport module: routes, manifests, boarding/alighting scans, live GPS tracking, per-term transport billing                           | A    |
| Emergency broadcast & lockdown alerts                                                                                                      | A    |
| Dismissal analytics (wait times, per-guardian history)                                                                                     | A    |

## 2.6 Communication & Guardian Access

| Feature                                                                                                                                                                                                         | Tier              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Announcements & notice board (web portal)                                                                                                                                                                       | B                 |
| Guardian & student portal/PWA — read-only at B (bills, receipts, attendance, published report cards, notices); M adds actions (online payment, dismissal-change requests)                                       | B                 |
| Bulk SMS (integrated Ghana SMS gateways e.g. Arkesel/Hubtel; school buys credits)                                                                                                                               | B (pay-as-you-go) |
| Event calendar, targeted messaging by class/level/route                                                                                                                                                         | M                 |
| WhatsApp notifications (templates): fee reminders, receipts, absence alerts, results links, announcements                                                                                                       | M                 |
| **WhatsApp guardian chatbot** (self-service): check balance, mini-statement, results link, attendance summary, report absence, request dismissal change, talk-to-school handoff; opt-in collected at enrollment | A                 |
| **AI assistant in chatbot** — natural-language Q&A grounded in the school's data, English + local-language friendly phrasing                                                                                    | A                 |
| Guardian mobile app (branded, push notifications)                                                                                                                                                               | A                 |

## 2.7 Learning Resources (LMS deferred)

| Feature                                                                                                                                                               | Tier                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| School uploads documents/resources (notes, homework, past questions, timetables) organized by class & subject; students/guardians access from home; download tracking | M                            |
| Resource size/count limits lifted; video/audio files                                                                                                                  | A                            |
| _Full LMS (lessons, assignments, quizzes, live classes)_                                                                                                              | **Deferred — future module** |
| _Canteen wallets (cashless, parent-funded, spending limits)_                                                                                                          | **Deferred — post-launch**   |
| _Hostel/boarding management (boarding SHS)_                                                                                                                           | **Deferred — post-launch**   |

## 2.8 Timetabling & Academic Operations

| Feature                                                          | Tier |
| ---------------------------------------------------------------- | ---- |
| Manual timetable builder, class & teacher views, clash detection | M    |
| Subject/teacher allocation, syllabus coverage tracking           | M    |
| AI-assisted timetable generation                                 | A    |
| Substitution management                                          | A    |

## 2.9 Staff, HR & Payroll

| Feature                                                                                     | Tier |
| ------------------------------------------------------------------------------------------- | ---- |
| Staff records & roles                                                                       | B    |
| Staff attendance & leave                                                                    | A    |
| Payroll with Ghana statutory: SSNIT tiers, GRA PAYE bands; payslips; bank/MoMo payout files | A    |

## 2.10 Administration, Reporting & Platform

| Feature                                                                                                                                            | Tier                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Role-based access control (owner, head, bursar, teacher, front-desk, guardian, student)                                                            | B                                      |
| Audit log (who changed what, when)                                                                                                                 | B (basic) / A (full forensic + export) |
| GES/NaSIA termly returns export (enrolment, attendance, performance)                                                                               | M                                      |
| Data export (Excel/CSV/PDF) & import (Excel onboarding templates)                                                                                  | B                                      |
| **Insights dashboard** — cross-module KPIs; **AI natural-language queries** ("Which JHS2 students owe more than GHS 500 and were absent 3+ days?") | A                                      |
| White-label branding (school logo/colors on portal, receipts, reports, apps)                                                                       | M (docs/receipts) / A (full apps)      |
| API access & webhooks for school's own integrations                                                                                                | A                                      |
| Offline data entry (marks, attendance, gate scanner — local queue, sync on reconnect)                                                              | All tiers, all shapes                  |
| Full offline operation (school LAN server, air-gap capable)                                                                                        | Standalone deployments                 |

## 2.11 AI feature summary (the "stand out" layer)

All AI features are human-in-the-loop (staff approve before anything reaches guardians) and are concentrated in Advanced:

1. AI remark writer for terminal reports (per-student, curriculum-aware)
2. AI script/register capture (photo → scores)
3. AI guardian chatbot on WhatsApp (grounded, scoped to the guardian's own wards)
4. AI fee-default risk scoring + suggested collection actions
5. AI natural-language analytics over school data
6. AI attendance/at-risk pattern alerts
7. AI-assisted timetable generation
8. (Later, with LMS) AI question generation for CBT banks

## 2.12 Package summary

|                      | **Basic — Free**                                                                                                                                                                                                                              | **Medium**                                                                                       | **Advanced**                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Positioning          | Run your school digitally                                                                                                                                                                                                                     | Collect fees & keep kids safe                                                                    | AI-powered, fully automated school                                                |
| Wedge                | Records, attendance, GES reports, manual fee tracking                                                                                                                                                                                         | Online MoMo payments + reconciliation, pickup security, WhatsApp notifications, document sharing | WhatsApp chatbot, AI suite, transport/GPS, payroll, USSD, analytics, multi-campus |
| Students             | ≤150✱                                                                                                                                                                                                                                         | ≤1,000✱                                                                                          | Unlimited                                                                         |
| Pricing model (SaaS) | Free forever                                                                                                                                                                                                                                  | Per-student/term or flat per term✱                                                               | Per-student/term + AI usage fair-use✱                                             |
| Standalone           | Medium/Advanced only (a deployment + annual maintenance contract is inherently paid; the free tier is SaaS-only). Tier locked by vendor-signed license. Maintenance contract covers updates, backups, license renewals, and priority support. |                                                                                                  |                                                                                   |

Pricing philosophy: published, per-term, in GHS (multi-currency for other countries), undercutting SAFSIMS (GHS 6k–12k/term) for equivalent value and clearly out-featuring fees-only tools (SchoolFlow GHS 99–349/mo). Payment-processing margin (negotiated education rates with Hubtel/Paystack) is a second revenue line — Hubtel RaiseUp proves the model.
