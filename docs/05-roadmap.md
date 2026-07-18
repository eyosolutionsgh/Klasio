# 05 — Development Roadmap

Per the chosen strategy, the first release covers **both the admin core and the differentiators** (safety, WhatsApp, first AI features) — a longer runway to launch, but a complete, stand-out product on day one. Phases are sequenced so paid-tier value lands before public launch.

Durations are working estimates for a small focused team; refine during sprint planning.

## Phase 0 — Foundations (~3–4 weeks)

- Monorepo scaffold (pnpm workspaces): `api`, `web`, `mobile`, `scanner`, `bot`, `packages/shared`
- Husky + lint-staged + commitlint, CI pipeline, migration-discipline checks (see 06)
- Auth (email/phone + OTP), RBAC, tenant model + Postgres RLS, audit log
- Entitlement engine + license-file verification (Ed25519) — built early because everything gates on it
- Design system foundation: tokens, typography, core components, icon set (see 07)
- Docker Compose packaging skeleton (the standalone story starts on day one)

**Exit:** a school can be created, users invited, tiers toggle features, one-command standalone install boots.

## Phase 1 — Admin core (~8–10 weeks)

- SIS: school structure, academic years/terms, classes, students, guardians (custody flags), promotion/transfers
- Attendance (web + mobile entry with autosave and a simple local queue-and-replay; the full sync engine arrives in Phase 4)
- Assessment engine: SBA components, weighting, GES + NaCCA grading schemes
- **Terminal reports**: GES-faithful + modern templates, broadsheets, PDF generation at scale
- Fees v1: fee structures, term invoicing, rollover, arrears carry-forward, manual payments (cash/bank-proof), receipts, defaulter lists, student ledger (event-sourced from day one)
- Guardian/student read-only portal; announcements; bulk SMS adapter
- Excel import templates for onboarding (students, fee structures, opening balances)

**Exit:** a real school runs a full term on Basic (free) — records → attendance → SBA → terminal reports → fee tracking. Pilot with 2–3 friendly schools begins here.

## Phase 2 — Money + safety + reach (the paid wedge) (~8–10 weeks)

- Online payments: Hubtel + Paystack adapters, MoMo push, hosted checkout, webhooks, idempotent application
- Reconciliation suite: auto-match, settlement import, exception queue
- Discounts/scholarships/installment plans; automated reminder schedules
- **Pickup/drop-off safety v1**: authorized lists, QR/PIN + photo verification, scanner app (local queue-and-replay offline), release log, guardian notifications, dismissal-change requests, printed-card path
- WhatsApp notifications (templates via 360dialog): reminders, receipts, absence alerts, results links
- Learning resources module (document upload/access — the LMS placeholder)
- Admissions v1 (online application, pipeline, admission letters); remark banks; custom fields; event calendar
- Timetable builder v1; GES termly returns export; ID cards
- SaaS subscription billing (self-serve upgrade, MoMo-payable)

**Exit:** Medium tier is sellable; pilots convert to paid; safety demo is the sales opener.

## Phase 3 — AI + Advanced tier (~8–12 weeks)

- AI gateway (metering, redaction, approval workflows)
- **AI remark writer** for terminal reports (highest leverage, lowest risk — human approves)
- **AI script capture** (photo → scores OCR pipeline)
- **WhatsApp guardian chatbot**: structured flows (balance, statement, results, absence, pickup change) → AI NLU fallback
- AI fee-default risk scoring; insights dashboard with natural-language queries
- Transport module: routes, manifests, boarding scans, live GPS, transport billing
- Payroll (SSNIT + GRA PAYE), staff attendance/leave
- CBT/mock exams v1 (BECE/WASSCE banks); USSD balance/payment
- Guardian mobile app (branded builds); car line management; emergency broadcast
- AI attendance-risk insights; dismissal analytics

**Exit:** Advanced tier launches with its core (AI suite, chatbot, transport, payroll, analytics). Remaining Advanced catalog items — multi-campus, API access & webhooks, AI timetable generation, substitution management, accounting exports/double-entry mini-ledger — land in Phase 5 before public launch.

## Phase 4 — Offline & standalone hardening (~6–8 weeks, overlaps Phase 3)

- Per-device offline: PowerSync integration for marks/attendance/scanner
- School-server sync agent (op-log replay, exception queue)
- LAN-box fleet tooling: image build, controlled updates, health beacon, encrypted backup shipping
- License lifecycle ops: issuance portal (internal), renewal flow, grace handling
- Load/chaos testing of sync; air-gapped install validation

**Exit:** Shape 3 (offline standalone) is deployable by a technician in under a day, tier-locked, remotely maintainable.

## Phase 5 — Launch & scale

- Remaining Advanced items: multi-campus, API access & webhooks, AI timetable generation, substitution management, accounting exports/double-entry mini-ledger
- Public launch in Ghana: published GHS pricing, self-serve Free signup, onboarding concierge for Medium/Advanced
- **Support & training model**: WhatsApp/phone support lines with tier-based SLAs, role-based training sessions (bursar/teacher/head) at onboarding, train-the-trainer packs for standalone schools; the standalone maintenance contract covers updates, backups, license renewals, and priority support
- Country pack #2 (Nigeria: NGN, Paystack-first, WAEC/NECO variants) — validates the country-pack architecture
- French i18n groundwork; marketplace of report templates
- Post-launch: full LMS module (lifts the deferral), alumni/admissions CRM, canteen wallets, hostel module for boarding SHS (all marked "deferred" in the feature catalog)

## Standing milestones & guardrails

- **Pilot schools embedded from Phase 1** — real Ghanaian school workflows validate GES report fidelity before any paid launch.
- Every phase ends with: migration-chain verification on a clean DB, standalone install smoke test, security review of new surfaces (payments, child data, bot).
- Data Protection Act (Act 843) registration + privacy policy before pilot data goes live.
- Pricing research checkpoint end of Phase 2 (validate ✱ limits against pilot willingness-to-pay).
