# 01 — Market Research

Competitive research conducted July 2026. Sources linked inline.

## 1. Global leaders (what "world-class" looks like)

| Vendor                                                                          | Segment                         | Notable for                                                              | AI (2025–26)                                               | On-prem/offline                          |
| ------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------- |
| [PowerSchool](https://www.powerschool.com/solutions/powerschool-ai/powerbuddy/) | US districts (~23% share)       | Deepest module ecosystem (SIS, Schoology LMS, analytics)                 | **PowerBuddy** — tutoring, NL data queries, at-risk alerts | Self-hosting still supported; no offline |
| Blackbaud                                                                       | US private schools              | SIS+LMS bundled, tuition billing (ex-Smart Tuition)                      | AI grading assistance, agentic fundraising AI              | Cloud only                               |
| [FACTS](https://factsmgt.com/)                                                  | US private/faith (15k+ schools) | Tuition/payment plans as the wedge product                               | Admissions yield prediction                                | Cloud only                               |
| [Gradelink](https://gradelink.com/pricing-plans/)                               | Small private schools           | Simplicity; ~$106/mo flat; 10-day onboarding                             | None                                                       | Cloud only                               |
| [Classe365](https://www.classe365.com/pricing/)                                 | Global, 6k+ institutions        | Transparent modular pricing ($100/mo core + $75/module)                  | AI add-on: predictive analytics, AI report comments        | Cloud only                               |
| [openSIS](https://www.opensis.com/pricing)                                      | Budget/self-hosters             | **Per-staff pricing**; open-source Classic edition                       | Marketing-level "AI"                                       | **Yes** — self-hostable (GPL)            |
| [Fedena](https://fedena.com/pricing-and-plans)                                  | India/emerging markets          | Flat annual license ($999–$1,699/yr), 50+ modules incl. transport/hostel | None                                                       | Enterprise source-code license           |
| [TeachMint](https://www.teachmint.com/)                                         | India → Africa/ME               | Ultra-low ARPU freemium (~$5/user/yr); hardware bundle                   | EduAI teaching assistant                                   | Cloud only                               |
| [Arbor](https://arbor-education.com/blog-ask-arbor-openai/)                     | UK (8.5k schools)               | Published per-pupil pricing; **Ask Arbor** (OpenAI in the MIS)           | Ask Arbor assistant                                        | Cloud only                               |
| Veracross                                                                       | Premium independents            | "One person, one record" unified DB                                      | AI-powered reporting                                       | Cloud only                               |

**Global table-stakes:** student records, attendance, gradebook + report cards, timetabling, parent/student portals, mobile apps, messaging, admissions forms, reporting, SSO/MFA/backups.

**Global differentiators (2025–26):** generative AI assistants (the hottest battleground), predictive analytics, bundled LMS, unified data architecture, transparent pricing, implementation-speed guarantees. **True offline capability effectively doesn't exist in this market — white space for connectivity-constrained regions.**

## 2. African & Ghanaian competitive set

### Regional heavyweights

- **[Edves](https://edves.ng/)** (Nigeria, 2,300+ schools) — now an "AI-Powered Pedagogy Platform": diagnostic assessment AI, adaptive learning paths, AI lesson plans. Full admin suite, WAEC/BECE/NECO support, SMS/WhatsApp notifications. From ~₦180k/yr. Cloud-only.
- **[Zeraki](https://www.zeraki.app/)** (Kenya, 5,000+ schools, claims presence in Ghana) — mobile-first (teachers enter marks on phones), exam analytics, finance module with fee registers and SMS reminders, some offline support. Quote pricing.
- **[SchoolTry](https://schooltry.com/)** (Nigeria; active in Ghana) — grade computation with broadsheets, CBT with malpractice detection, financials, HR/payroll. Quote-based.
- **[SAFSIMS](https://safsims.com/the-best-school-management-system-in-ghana/)** (Nigeria → Ghana) — published Ghana pricing: Free / GHS 6,000/term / GHS 12,000/term. Paystack integration, auto reconciliation, autosave for poor connectivity. No GES report formats, no offline, no AI. WhatsApp on roadmap.
- **[SchoolHub](https://schoolhub.tech/blog/school-management-system-ghana)** (Nigeria → Ghana) — AI lesson-note generator, AI assistants, claims NaCCA proficiency-band report cards, MTN MoMo integration, data caching for intermittent connectivity.

### Ghana-local players

- **[sERP](https://schoolerpghana.com/)** — deepest GES localization: GES grading/comments standards, SBA tracking, **USSD fee payment on all Ghana MoMo networks**, SSNIT/GRA PAYE payroll, double-entry accounting. Quote-based; dated UX.
- **[Britsoft](https://britsoftghana.com/school-software/)** — GES terminal reports (class/subject positions, "Next Term Begins", remarks), arrears carry-over on promotion, SMS triggers. Flat GH¢2,497 setup + GH¢1,997/yr.
- **[SmartSapp](https://www.smartsapp.com/)** (Ghana, 100+ schools incl. Ghana International School) — **the pickup-security specialist**: authorized-person photo/QR verification, real-time check-in/out alerts, offline-capable scanner app, express pickup, cashless canteen, MoMo fee collection, SSNIT payroll. Free tier + 3 paid tiers.
- **[IntuitiveSBA](https://intuitivesba.com/)** — AI reads photographed marked scripts → auto SBA scaling → GES-format reports with same-day SMS result links. Currently free (launch phase).
- **[SchoolFlow](https://www.myschoolflowapp.com/)** — fees-only SaaS: GHS 99–349/mo, term rollover, defaulter lists, **WhatsApp reminders/receipts**, MoMo + bank-proof-upload workflow.
- **[Hubtel RaiseUp](https://explore.hubtel.com/schools/)** — a payments company moving up-stack: zero subscription, transaction-fee-only, pickup management, notices. Signals payments-led disruption risk.
- Long tail: Skuuni, Schoolpal, TeacherDeskGH, Fawoma, plus Nigerian free plans (Nersapp, Gosfem open-source, Smart School Africa — whose top tier includes **offline CBT and offline fee entry**).

**The real incumbent to displace: Excel + Word GES report templates and paper receipt books.**

## 3. What resonates in this market (validated patterns)

1. **Fee management is the #1 wedge.** Every serious product leads with invoicing, partial payments, arrears carry-forward, defaulter lists, and "collect 100% of fees" claims.
2. **Mobile money rails:** Paystack GH 1.95% flat; Hubtel 1.95% MoMo (min GHS 0.30), GHS 200 API fee, T+1–T+3 settlement; Flutterwave 2% MoMo. Paystack Nigeria reportedly offers a **special education rate (~0.7% capped — verify before relying on it)** — precedent to negotiate school-specific pricing. USSD payment reaches feature-phone parents.
3. **SMS ≫ email; WhatsApp rising.** SMS is the default parent channel and usually the cheapest per message locally; WhatsApp is richer (PDFs, buttons, free parent-initiated replies) but needs opt-in. Both must coexist.
4. **Terminal report cards are the emotional product.** Class position, subject position, GES grade, remarks, "Next Term Begins", attendance — and increasingly NaCCA proficiency bands (Beginning/Approaching/Meeting/Exceeding). Software must support **both** formats, plus Cambridge/Montessori scales for premium schools.
5. **SBA engine:** configurable SBA-vs-exam weighting (30/70 standard), scaling of raw scores, aggregates, class ranking.
6. Recurring paid modules: CBT/mock exams (BECE/WASSCE prep), payroll with SSNIT + GRA PAYE, transport/bus billing, canteen wallets, pickup security, hostel (boarding SHS).

## 4. Ghana education context (design constraints)

- **Structure:** creche/nursery → KG1–KG2 → Primary B1–B6 → JHS (B7–B9) → SHS 1–3. Three terms per year (GES has shifted calendar dates several times in recent years — term dates must be fully configurable, never hard-coded). Governance: GES, NaCCA (curriculum), NaSIA (private-school licensing).
- **BECE:** SBA 30% + external exam 70%; aggregate = best six (4 core + 2 electives); drives CSSPS placement. **WASSCE:** A1–F9.
- **GES returns:** schools must file termly enrolment/attendance/performance reports — an export feature, not an afterthought.
- **Payments culture:** MTN MoMo dominant; Telecel Cash and AT Money secondary; bank deposit with proof-of-payment upload still common; cash at the office persists. E-Levy abolished 2025.
- Private schools outnumber public at basic level in urban Ghana — a large, fragmented buyer pool with GHS 99–349/mo software budgets (SchoolFlow benchmark) up to GHS 6,000–12,000/term for bigger schools (SAFSIMS benchmark).

## 5. Feature-domain deep dives

### Pickup/drop-off safety (PikMyKid, CurbSmart, SchoolPass, Raptor)

- **Minimal viable set:** per-student authorized pickup list with parent-managed delegates + school override; custody red-flags; verification token at handoff (QR/PIN/placard) plus stored guardian photo; immutable release log (timestamp, student, staff, receiving adult, mode); parent notification on release; same-day dismissal-change requests; **a no-smartphone path (printed placard/PIN card)**.
- **Advanced:** GPS announce/geofenced check-in, multi-lane car line orchestration, bus manifests + live GPS, LPR/RFID vehicle recognition, after-school rosters, emergency broadcast, wait-time analytics.
- Sources: [PikMyKid](https://www.pikmykid.com/faq) · [CurbSmart](https://nutrilinktechnologies.com/products/school-dismissal/) · [SchoolPass](https://schoolpass.com/solutions/dismissal-management/) · [Raptor](https://raptortech.com/protect-your-school/raptor-dismissal-management-system/)

### WhatsApp Business Cloud API (2026)

- **Per-delivered-message pricing** since July 2025. Ghana = "Rest of Africa" rate card: Marketing ~$0.0259, Utility ~$0.0046, Auth ~$0.0046. Service (free-form) replies inside the 24-hour customer window are **free**, and utility templates inside the window are free too — so **parent-initiated flows ("BALANCE") cost ≈ $0**; only school-initiated pushes cost money.
- Constraints: pre-approved templates for business-initiated messages; **mandatory opt-in** (paper form at enrollment works); one dedicated number per school or one central bot number; new numbers throttled (250→1k→10k unique users/24h).
- Providers from Ghana: Meta direct (cheapest, most build effort), Twilio (+$0.005/msg), 360dialog (€49/number/mo, no markup, ISV partner tiers — right shape for us as a vendor), Wati (+20% markup). Avoid unofficial gateways (ban risk).
- Sources: [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing) · [rate card](https://docs.gallabox.com/pricing-and-billing-modules/new-per-message-pricing) · [360dialog](https://360dialog.com/pricing) · [opt-in rules](https://www.infobip.com/blog/how-to-collect-whatsapp-business-opt-ins)

### Billing & reconciliation

- Model: term invoices per class with per-student optional items (transport, feeding), discounts/waivers/scholarships/sibling discounts with reason notes, installment plans, partial payments, arrears carry-forward into next term's invoice, branded PDF receipts (with student photo) via WhatsApp/SMS.
- **Reconciliation core practice: a unique payment reference per invoice/installment carried across every channel** (MoMo prompt, bank transfer, cash) + gateway webhooks + status re-query for missed callbacks + 3-way match (gateway settlement ↔ ledger ↔ bank statement) + exception queue for unmatched payments. Design for gross-vs-net fee deductions.
- Sources: [TransferMate](https://www.transfermate.com/post/4-ways-to-make-reconciliation-easier-when-processing-student-fees) · [Hubtel fees](https://explore.hubtel.com/legal/service-fees/) · [Paystack](https://paystack.com/gh/pricing) · [Flutterwave GH](https://flutterwave.com/gh/pricing) · [MTN MoMo API](https://momodeveloper.mtn.com/)

### Offline-first & vendor-controlled licensing

- Sync engines: **PowerSync** (bidirectional SQLite↔Postgres, server-authoritative writes, self-hostable Open Edition) best for per-device offline; **CouchDB replication** best for whole-school-server ↔ cloud sync; ElectricSQL is read-path only; CRDTs unsuitable for financial ledgers. **Ledger data must be server-authoritative replay, never last-write-wins.**
- DHIS2 (the dominant African MIS) precedent: prefer online-first; per-site local servers work but demand **remote-automated updates, backups, monitoring** because schools have no sysadmin.
- Vendor-locked tiers offline: **cryptographically signed license files** (Ed25519) embedding entitlements, expiry, grace period, machine fingerprint — verified locally with an embedded public key, so only the vendor can mint or change a tier even air-gapped. GitLab/Keygen pattern; single codebase, runtime entitlement checks, not separate builds.
- Sources: [sync comparison](https://queryplane.com/blog/electricsql-vs-powersync-vs-replicache/) · [PowerSync Open Edition](https://powersync.com/blog/powersync-open-edition-release) · [DHIS2 offline](https://docs.dhis2.org/en/implement/maintenance-and-use/guidelines-for-offline-data-entry-using-dhis2.html) · [Keygen offline licenses](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/)

## 6. Gaps we exploit (positioning)

1. **Offline-first full SMS** — nobody in the market truly owns it (partial: Zeraki, SmartSapp scanner, SSA top tier).
2. **Safety + admin in one product** — SmartSapp owns safety but is thin on academics; academic products ignore safety.
3. **AI across the admin workflow** — AI report remarks, script OCR, default-risk prediction, guardian chatbot; regional AI is concentrated in pedagogy (Edves) or marketing claims.
4. **WhatsApp self-service** — reminders exist (SchoolFlow); a real guardian chatbot (balance, results, absence reporting, dismissal changes) does not.
5. **Transparent tiered pricing with a genuinely free plan** — the local norm is quote-based opacity; free tier + published per-term pricing wins trust.
6. **Vendor-licensed standalone** — schools that insist on owning their deployment have almost no modern option; signed-license entitlements make it commercially safe.
