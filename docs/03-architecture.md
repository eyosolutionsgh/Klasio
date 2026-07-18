# 03 — Architecture & Deployment

One codebase, three deployment shapes, tier decided by entitlements.

## 3.1 Deployment shapes

```
┌─────────────────────────────────────────────────────────────────────┐
│  SHAPE 1 — SaaS (multi-tenant cloud)                                │
│  cloud API + Postgres (tenant-per-school via school_id + RLS)       │
│  Web portal · guardian PWA · teacher mobile · WhatsApp bot          │
│  Billing: subscription (Free/Medium/Advanced) via MoMo/card         │
├─────────────────────────────────────────────────────────────────────┤
│  SHAPE 2 — Standalone ONLINE (single-tenant, vendor- or self-hosted)│
│  Same Docker images, single-school database                         │
│  Tier locked by vendor-signed license file                          │
├─────────────────────────────────────────────────────────────────────┤
│  SHAPE 3 — Standalone OFFLINE (school LAN server)                   │
│  Mini-PC/NUC running Docker Compose: app + Postgres + sync agent    │
│  Staff devices use it over Wi-Fi; syncs to cloud when internet      │
│  returns (or runs fully air-gapped)                                 │
│  Tier locked by vendor-signed license file (offline-verifiable)     │
└─────────────────────────────────────────────────────────────────────┘
```

## 3.2 High-level components

- **Core API** (modular monolith to start — modules: sis, attendance, assessment, billing, payments, safety, comms, resources, hr, platform). Modulith boundaries let us extract services later without a premature microservice tax.
- **Postgres** — single source of truth. Multi-tenant SaaS: shared DB, `school_id` on every row + Postgres Row-Level Security; standalone: same schema, single tenant. Identical migrations everywhere (see [06-engineering-practices.md](06-engineering-practices.md)).
- **Web app** — staff/admin portal (responsive; teachers use it on phones).
- **Guardian PWA + branded mobile app** — read portal, payments, pickup management.
- **Scanner app** — gate staff pickup/drop-off verification; offline-first by design.
- **Worker/queue** — invoices, notifications, report generation, webhook processing, sync.
- **Integration adapters** — payment gateways (Hubtel, Paystack, Flutterwave), SMS (Arkesel/Hubtel), WhatsApp Cloud API (via 360dialog as BSP partner, one WABA number per school or shared vendor number), USSD aggregator.
- **AI service** — a thin internal gateway that wraps LLM/OCR providers; all AI calls flow through it (prompt templates, tenant data grounding, PII redaction, usage metering, human-approval workflow). Cloud-only feature: offline installs queue AI jobs for when connectivity returns (AI never blocks core workflows).

## 3.3 Multi-tenancy & data isolation

- Tenant = school (Advanced supports school groups/multi-campus: `organization → school → campus`).
- Every table carries `school_id`; RLS policies enforce isolation at the DB layer; app-layer guards enforce it at the API layer (defense in depth).
- Per-tenant encryption of sensitive columns (guardian phone numbers, medical notes). Child-data protection by design: least-privilege roles, custody flags gate who sees/collects a child, full audit log. Ghana Data Protection Act, 2012 (Act 843) registration and NaSIA expectations tracked as compliance items.
- Backups: per-tenant logical export (SaaS nightly; standalone local + optional encrypted cloud copy).

## 3.4 Offline strategy

Two complementary layers, per research (DHIS2 precedent, PowerSync/CouchDB patterns):

1. **Per-device offline (all shapes):** teacher marks entry, attendance, and the gate scanner keep a local queue (SQLite/IndexedDB) and replay when online. Server-authoritative writes — the API validates and applies; conflicts resolved by domain rules (e.g., attendance last-marker-wins with audit; marks entry per-cell versioning).
2. **School-server offline (Shape 3):** the LAN box is the school's authoritative server. A sync agent replicates changes bidirectionally with the cloud (append-only op-log with idempotent, server-authoritative replay — **never** last-write-wins for the financial ledger; money movements are immutable events, corrections are reversals).

Design rules:

- **The fee ledger is an event log.** Invoices, payments, reversals are append-only; balances are projections. This makes sync-safe accounting tractable and reconciliation auditable.
- Sync conflicts surface in an admin exception queue, never silently dropped.
- Remote fleet management for LAN boxes: automated updates, health monitoring, encrypted backup shipping — schools have no sysadmin (DHIS2's hard-won lesson).
- **LAN-box physical security:** full-disk encryption (LUKS) with escrowed keys, locked enclosure guidance in the install checklist, remote-wipe on next boot for stolen boxes, and a theft-response runbook — the box holds a school's child, custody, and financial data.
- **Connectivity-dependent features degrade honestly:** WhatsApp, online payments, USSD, live GPS, and AI require internet by nature. A fully air-gapped Advanced install retains all local features (SIS, assessment, reports, ledger, pickup verification, LAN portal) and clearly marks the rest "requires connectivity" — documented per feature in the sales sheet so standalone buyers know exactly what they get, with pricing adjusted accordingly.
- Evaluate **PowerSync** (self-hostable Open Edition) for the per-device layer before building custom; custom op-log sync for the school-server layer.

## 3.5 Licensing & entitlements (vendor-controlled tiers)

- Single entitlement model for SaaS and standalone: features check `entitlements.has('safety.carline')`, never `if (plan === 'advanced')` — tiers are bundles of entitlements, letting us regrade bundles without code changes.
- **SaaS:** entitlements come from the subscription record; upgrades/downgrades apply instantly; Free tier is a first-class subscription (no card required).
- **Standalone:** entitlements come from a **vendor-signed license file** (Ed25519). Contains: school identity, tier entitlements, student-count cap, expiry + grace period, max offline duration, machine fingerprint (optional). App verifies with an embedded public key — works fully air-gapped; **only the vendor can mint or change a tier** (Keygen/GitLab pattern). Renewal = new file by email/USB, or auto-fetch when online.
- Anti-tamper posture: signed licenses + periodic re-validation + fingerprinting is commercially sufficient; we do not chase perfect DRM.
- **Lapse & churn policy (no data hostage-taking):** SaaS non-payment → grace period → read-only mode → 90-day export window before deletion; free-cap overflow blocks _new_ enrollments only; expired standalone license → read-only with export always available. Data export is a right at every tier.

## 3.6 WhatsApp chatbot architecture (Advanced)

```
Guardian WhatsApp ──► BSP (360dialog) webhook ──► Bot service
  ├─ identify guardian by phone (verified at enrollment, OTP re-check)
  ├─ scope: only their linked wards, only their school's data
  ├─ intents: BALANCE · STATEMENT · RESULTS · ATTENDANCE ·
  │           REPORT ABSENCE · CHANGE PICKUP · NOTICES · HELP/handoff
  ├─ structured flows first (buttons/lists); AI NLU fallback (Advanced)
  └─ replies inside 24h service window = free; pushes = utility templates
```

- Opt-in captured on the enrollment form (paper + digital), per Meta policy.
- Cost model: parent-initiated ≈ $0; school pushes ~ $0.0046/delivered (utility, Rest-of-Africa rate). Ghana bulk SMS (~GHS 0.03–0.05 ≈ $0.002–0.003) is usually _cheaper_ per message — WhatsApp wins on richness (PDFs, buttons, free replies), not raw price. SMS remains the fallback for non-WhatsApp guardians.
- **Number strategy (decision):** default is a shared vendor WABA number (school identified in the template body) — a dedicated €49/mo 360dialog number per school would exceed many schools' entire software budget. Dedicated branded numbers are an Advanced add-on priced to cover their cost.
- Security: never expose another child's data; OTP re-verification for sensitive requests (pickup changes); rate limiting; full conversation audit.

## 3.7 Payments architecture (Medium+)

- Gateway-agnostic `PaymentProvider` interface; launch adapters: **Hubtel** (MoMo+cards+USSD, Ghana-first) and **Paystack** (Ghana + Nigeria expansion); Flutterwave later for diaspora tuition.
- Every invoice/installment gets a **unique payment reference**; hosted checkout + MoMo push (request-to-pay); webhooks with signature verification + scheduled status re-query for missed callbacks; idempotent payment application.
- Reconciliation: nightly settlement-file import → auto-match (reference+amount, net-of-fees tolerance) → exception queue → 3-way match reports.
- Cash/bank-proof flows are first-class (record → proof upload → bursar confirmation → receipt), because they dominate large tuition payments.

## 3.8 Cross-country readiness

- Ghana first, architected for: multi-currency (GHS/NGN/KES/XOF/USD), country packs (grading schemes, statutory payroll, report formats, gateways, SMS providers) as pluggable configuration, i18n scaffolding (English now; French for francophone West Africa on the roadmap), timezone/term-calendar flexibility.
- **Data residency:** SaaS hosted in-region (AWS af-south-1 Cape Town or equivalent) for latency and Act 843 posture; residency documented per country pack as expansion requires.
