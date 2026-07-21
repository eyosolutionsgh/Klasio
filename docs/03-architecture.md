# 03 — Architecture & Deployment

One codebase, three deployment shapes, tier decided by entitlements.

## 3.1 Deployment shapes

**One product, one school per server.** The multi-tenant SaaS shape was removed in July 2026: a
school's records now live on the school's own machine, and there is no hosted estate and no vendor
console. What remains is one deployment, in two topologies that differ only in where the box sits.

```
┌─────────────────────────────────────────────────────────────────────┐
│  INTERNET-FACING — the school's own cloud VM                        │
│  Docker Compose: Postgres + Redis + API + web, one school           │
│  Reachable by guardians, by Meta (for social publishing), by MoMo   │
│  Tier from the vendor-signed licence file                           │
├─────────────────────────────────────────────────────────────────────┤
│  LAN / OFFLINE — a mini-PC in the school office                     │
│  Identical images and database, staff devices over Wi-Fi            │
│  Runs fully air-gapped: the licence verifies with no call home      │
│  Connectivity-dependent features simply never fire — online         │
│  payments, and Instagram publishing, which needs Meta to reach the  │
│  image. Everything else is unaffected.                              │
└─────────────────────────────────────────────────────────────────────┘
```

A school is created by the first-run wizard at `/setup`, guarded on "no school row exists" rather
than a token — a token has to be generated, shown and stored, and each of those can leak, whereas
a row count closes permanently after one use.

## 3.2 High-level components

- **Core API** (modular monolith to start — modules: sis, attendance, assessment, billing, payments, safety, comms, resources, hr, platform). Modulith boundaries let us extract services later without a premature microservice tax.
- **Postgres** — single source of truth. Multi-tenant SaaS: shared DB, `school_id` on every row + Postgres Row-Level Security; standalone: same schema, single tenant. Identical migrations everywhere (see [06-engineering-practices.md](06-engineering-practices.md)).
- **Web app** — staff/admin portal (responsive; teachers use it on phones).
- **Guardian portal (PWA)** — read portal, payments, dismissal requests. Installable to a home screen, but never an app-store download; see §3.9.
- **Gate screen** — pickup/drop-off verification, inside the staff web app. Offline-first, and it scans QR codes with the browser's own barcode API rather than a bundled decoder, so a cheap Android handset on school wifi is the whole hardware requirement.
- **Worker/queue** — invoices, notifications, report generation, webhook processing, sync.
- **Integration adapters** — payment gateways (Hubtel, Paystack, Flutterwave), SMS (Arkesel/Hubtel), WhatsApp Cloud API (via 360dialog as BSP partner, one WABA number per school or shared vendor number), USSD aggregator.
- **AI service** — a thin internal gateway that wraps LLM/OCR providers; all AI calls flow through it (prompt templates, tenant data grounding, PII redaction, usage metering, human-approval workflow). Cloud-only feature: offline installs queue AI jobs for when connectivity returns (AI never blocks core workflows).

## 3.3 Data isolation

- One school per deployment. Every tenant-owned table still carries `school_id` and still has an
  RLS policy, and both stay: with a single school, RLS stops being a tenancy mechanism and becomes
  a **forgotten-where-clause detector** — a query that loses its filter returns nothing instead of
  everything. (Advanced supports campuses within the one school: `school → campus`.)
- Two things are needed for a new tenant table, and only one of them fails loudly: a
  `tenant_isolation` policy **and** a `GRANT` to `eyo_app`. A missing grant fails closed with
  "permission denied"; a missing policy fails **open, and silently**.
- The policies only apply if the API connects as `APP_DATABASE_URL` (the non-owner `eyo_app`
  role). Connecting as the owner bypasses every one of them — which shipped, undetected, for
  months, because the boot warning went into container logs nobody read. `e2e/rls.spec.ts` exists
  to catch precisely that.
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

Implemented in `apps/api/src/licence/`.

- Features check entitlement **codes** — `@RequireEntitlement('safety.carline')` — never
  `if (tier === 'ADVANCED')`. Tiers are bundles, so a bundle can be regraded without a code change.
- Entitlements come from a **vendor-signed licence file** (Ed25519, `node:crypto`). It carries
  school identity (bound to the slug, since the vendor mints it before the box exists), tier,
  expiry, grace period, and `extraEntitlements` — individual codes granted on top of
  the bundle, so one Advanced feature can be sold to a Medium school without cutting a release.
- Format is `<base64url(payload)>.<base64url(signature)>`, JWS-shaped and deliberately not JWS:
  one algorithm, no header, so there is no algorithm confusion to get wrong. Verification is over
  the received bytes rather than a re-serialisation, which removes canonical-JSON drift entirely.
- The app verifies with an embedded public key and works fully air-gapped. Only the vendor can
  mint one. `LICENCE_PUBLIC_KEY` must be set in production; the API refuses to validate against
  the committed development key when `NODE_ENV=production`, because that private half is public.
- Re-validated hourly. Install at `/setup`, from **Settings → Licence**, or by mounting
  `LICENCE_FILE`. No machine fingerprint in v1: a fingerprint that breaks on a routine VM
  migration costs more support time than it saves in piracy.
- Anti-tamper posture: a signed licence plus periodic re-validation is commercially sufficient. We
  do not chase perfect DRM.

**Lapse policy (no data hostage-taking).** Valid → grace (full tier, banner) → **BASIC**. This
supersedes the earlier "expired licence → read-only": Basic is a genuinely usable product — roll,
attendance, terminal reports, manual fees, SMS — and a school whose licence lapsed over a holiday
must still be able to mark this morning's register. A missing or tampered licence lands on Basic
too; the box never refuses to boot. **Export works in every state**, and is a right at every tier.

**Packages limit features, never headcount.** There is no enrolment cap: a school may enrol as many
children as it has. A cap's only enforceable effect on the school's own box was to refuse a child
mid-term — a bad failure mode for a school product, and weak leverage besides, since the box is the
school's. The licence payload still carries a `studentCap` field, always minted as `null`, purely so
a server predating this change accepts a licence issued today; nothing reads it.

## 3.6 WhatsApp chatbot architecture (all tiers)

```
Guardian WhatsApp ──► BSP (360dialog) webhook ──► Bot service
  ├─ identify guardian by phone (verified at enrollment, OTP re-check)
  ├─ scope: only their linked wards, only their school's data
  ├─ intents: BALANCE · STATEMENT · RESULTS · ATTENDANCE ·
  │           REPORT ABSENCE · CHANGE PICKUP · NOTICES · HELP/handoff
  ├─ structured flows first (buttons/lists); AI NLU fallback (Advanced)
  └─ replies inside 24h service window = free; pushes = utility templates
```

**Tier (decision).** The structured flows are **Basic and above**. They were Advanced-only while a
branded parent app was also planned; with that app struck (§3.9), WhatsApp *is* the parent channel,
and gating it behind the top tier would leave a Basic school's parents with a web page and nothing
else — which fails principle 4 for exactly the schools least able to pay their way out of it. Only
the **AI free-text layer** stays Advanced: structured buttons answer the common questions at no
marginal cost, while natural-language answering carries a per-message inference bill that has to be
priced somewhere.

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

## 3.9 No native apps (decision)

**Decision: the product ships no mobile app — not for parents, not for gate staff.** Superseded the
earlier plan for a branded guardian app and a React Native scanner app; both are struck from
[02-feature-catalog.md](02-feature-catalog.md), [04-tech-stack.md](04-tech-stack.md) and
[05-roadmap.md](05-roadmap.md).

**For parents, an app is a tax we cannot ask them to pay.** The phone already holds their bank, their
network operator, their government, and whatever else demanded installation. A school app competes
for storage against those, and it puts an install between a parent and their child's fee balance —
where the parents most likely to abandon that install are exactly the ones a fee reminder is aimed
at. The channel is therefore **WhatsApp first** (§3.6), with the guardian PWA behind it for anything
that wants a bigger screen. Both work on a phone that will never see the Play Store.

**The frequency argument does not hold, and we should not lean on it.** An earlier draft of this
section claimed a school app would be opened a handful of times a term. That is wrong: pickup and
drop-off are daily, twice daily, every school day, and absence reporting is frequent enough to sit
alongside them. Daily use is the *strongest* case for a native app, and if the argument rested on
"nobody would open it" the decision would be indefensible. It rests on something else — **WhatsApp
already serves the daily interactions with no install at all.** A parent reports an absence at 7am
and changes a pickup arrangement at 2pm in the same thread where they checked a balance last week.
An app would have to beat that, not merely match it, to justify what it costs the parent.

**For gate staff, the app is simply redundant.** The gate screen already scans QR codes through the
browser's `BarcodeDetector`, queues releases offline, and runs on the cheap Android handset the
school already owns. A separate binary would add an install, an update channel and a second offline
queue to reason about, in exchange for nothing the browser is not already doing. Where
`BarcodeDetector` is missing (iOS Safari, older Android), typed-code entry is the path, and printed
pickup cards carry the code in text for exactly that reason.

**What this costs us, stated honestly:** no push notifications to a parent's lock screen — SMS and
WhatsApp carry that instead; no app-store presence as a credibility signal to schools that expect
one; and no home-screen icon unless the parent pins the PWA themselves. We accept all three. The
first is covered, the second is a sales conversation rather than a product gap, and the third
matters less than the install it avoids.

**Consequences.** The chatbot stops being an Advanced luxury and becomes the parent channel for
every tier (§3.6) — a Basic school whose parents have no self-service is a Basic school that fails
principle 4. The monorepo carries no `mobile` or `scanner` workspace. React Native leaves the stack,
which also removes the "two languages once mobile arrives" objection that shaped
[04-tech-stack.md](04-tech-stack.md) §4.2.

**Reversal condition:** if pilot data shows parents asking for an app unprompted, or a competitor's
app demonstrably wins deals we lose, revisit — but reversal means an app that earns its install, not
a wrapper around the PWA.
