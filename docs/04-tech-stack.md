# 04 — Recommended Tech Stack

## 4.1 Recommendation summary

**TypeScript end-to-end**, chosen for: one language across API/web/mobile/bot (small team leverage), the strongest offline-sync ecosystem (PowerSync/SQLite tooling is TS-first), first-class AI SDKs, and easy Docker packaging for standalone installs.

| Layer                      | Choice                                                                              | Why                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API                        | **NestJS (Node 22 LTS, TypeScript)**                                                | Opinionated modular structure fits the modulith; DI, guards, and module boundaries map to our domain modules; huge hiring pool |
| Database                   | **PostgreSQL 16+**                                                                  | RLS for multi-tenancy, battle-tested, runs identically on a LAN mini-PC and in cloud                                           |
| ORM/migrations             | **Prisma** (or Drizzle if raw-SQL control preferred)                                | Declarative schema, deterministic migration files, `migrate deploy` for clean staging/prod runs                                |
| Queue/cache                | **BullMQ + Redis**                                                                  | Invoicing runs, notification fan-out, webhook retries, sync jobs                                                               |
| Web (staff portal)         | **Next.js + React + TypeScript**                                                    | SSR for slow connections, PWA-capable, mature ecosystem                                                                        |
| UI foundation              | **Tailwind CSS + Radix primitives** + custom design system                          | Full control to build a unique, non-template look (see [07-ux-guidelines.md](07-ux-guidelines.md))                             |
| Guardian portal + gate screen | **Next.js PWA (no native app)**                                                  | Struck React Native — see [03-architecture.md](03-architecture.md) §3.9. Guardians reach the school over WhatsApp and a pinnable web page; the gate scans QR through the browser's `BarcodeDetector`. Nothing to install, nothing in an app store, one language in the stack |
| Offline sync               | **PowerSync Open Edition** (per-device) + custom op-log agent (school-server↔cloud) | Server-authoritative replay; self-hostable; FSL-licensed                                                                       |
| WhatsApp                   | **WhatsApp Cloud API via 360dialog** (ISV partner tier)                             | No per-message markup; one number per school; official BSP                                                                     |
| SMS                        | Arkesel / Hubtel SMS adapters                                                       | Ghana-local rates, sender-ID support                                                                                           |
| Payments                   | Hubtel + Paystack adapters                                                          | See [03-architecture.md](03-architecture.md) §3.7                                                                              |
| AI                         | Provider-agnostic gateway (Claude/OpenAI APIs; OCR: cloud vision APIs)              | Swappable providers, usage metering per tenant                                                                                 |
| Packaging                  | **Docker Compose** (standalone), managed cloud (SaaS)                               | Same images everywhere; LAN box = Compose + watchtower-style controlled updates                                                |
| Observability              | Sentry + OpenTelemetry + Grafana/Loki (cloud); health-beacon for LAN boxes          | See [06-engineering-practices.md](06-engineering-practices.md)                                                                 |

## 4.2 Why not the alternatives

- **Laravel/PHP** — biggest hiring pool in West Africa and fine for a cloud-only CRUD product, but offline-first (client SQLite sync, op-log replay) and a long-running bot/queue layer fight the framework. (The old "two languages once mobile arrives" objection no longer applies — there is no mobile app — but the offline and queue arguments stand on their own.)
- **Django/Python** — excellent admin/reporting, but same offline-ecosystem gap; Python stays in our stack anyway inside the AI service if needed.
- **Microservices from day one** — operational overkill for a small team and impossible to ship as a simple standalone box. The modulith + Docker Compose gives us the standalone story for free.

## 4.3 Non-negotiable engineering constraints

1. **Identical migration chain in every environment** (dev/staging/prod/standalone). A fresh `migrate deploy` on an empty database must always produce a complete, working schema. No manual SQL drift, ever. (Project requirement — enforced in CI; see 06.)
2. **Entitlement checks, not tier checks**, throughout the codebase.
3. **Ledger immutability** — corrections are reversal events.
4. **Every integration behind an interface** (payments, SMS, WhatsApp, AI) — country packs swap adapters, tests use fakes.
5. **Seed data as code** — GES grading schemes, Ghana term calendar, report templates ship as versioned seeds so a standalone install is usable out of the box.
