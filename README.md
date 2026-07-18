# EYO School Management System

AI-powered school management for private schools in Ghana and across Africa — pre-school (creche/KG) through high school (SHS). Ships two ways from one codebase: **SaaS** (multi-tenant cloud, Free/Medium/Advanced packages) and **standalone** (deployed per school, online or offline, tier locked by a vendor-signed license).

Full product plan and research live in [`docs/`](docs/README.md).

## What's implemented (Phase 0 + Phase 1 slice)

- **SIS** — school structure (KG→JHS levels, classes, 3-term GES calendar), students, guardians with custody/pickup flags
- **Attendance** — daily register with per-child statuses, bulk "all present", term totals feeding report cards
- **Assessment & terminal reports** — SBA components with configurable max scores, GES 30/70 computation, grades (1–9 bands), subject positions, class positions, print-faithful GES report cards
- **Fees** — fee items, bulk term invoicing, **append-only ledger** (invoices/payments/reversals — corrections are reversal events, never edits), receipts, defaulter list, collection-by-method, manual payment recording (cash/MoMo/bank)
- **Announcements**, role-based access (owner/head/bursar/teacher/front-desk), audit log
- **Entitlement engine** — features check entitlement codes, never tier names (`docs/03 §3.5`)
- Distinctive UI ("school registry" design language: Fraunces + Libre Franklin, kente-stripe signature, tabular numerals, CSS tooltips, print styles)
- 9 Playwright E2E flows with screenshots, unit tests, ESLint/Prettier, husky hooks (incl. commit-message policy), CI with migration gates

## Stack

TypeScript end-to-end: NestJS (modulith) · PostgreSQL 16 + Prisma · Next.js 15 + Tailwind v4 · Playwright · pnpm workspaces. See [`docs/04-tech-stack.md`](docs/04-tech-stack.md).

## Getting started

```bash
# prerequisites: Node 22+, pnpm 10, PostgreSQL 16
pnpm install

# database (create role/db once, then:)
cp .env.example apps/api/.env         # adjust DATABASE_URL if needed
pnpm db:deploy                        # apply the migration chain (clean on any empty DB)
pnpm db:seed                          # demo school: Brighton Academy

# run both apps
pnpm dev                              # api :4000 · web :3000
```

Demo logins (password `Password1!`): `owner@demo.school` · `head@demo.school` · `bursar@demo.school` · `teacher@demo.school`

## Tests

```bash
pnpm test          # unit tests
pnpm test:e2e      # Playwright E2E (needs both apps running + seeded db)
pnpm lint && pnpm typecheck
pnpm --filter @eyo/api db:drift-check   # migration chain == schema, always
```

## Standalone deployment

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d
```

Boots Postgres + API (running `migrate deploy` first) + web. The vendor-signed license file mechanism (tier locking for standalone installs) is specified in `docs/03-architecture.md §3.5` and lands with the licensing service.

## Repository layout

```
apps/api        NestJS API — modules: auth, schools, students, attendance, assessment, fees, announcements, dashboard
apps/web        Next.js staff portal
docs/           Product plan: research, feature catalog & tiers, architecture, roadmap, practices, UX
.github/        CI: lint → typecheck → unit → migration gates → build → E2E
```

## Engineering rules (enforced)

1. Never edit an applied migration; roll forward only. A fresh `migrate deploy` must always produce a complete schema.
2. The fee ledger is append-only; corrections are reversals.
3. Feature code checks entitlements, never tier names.
4. No AI attribution trails in commits (husky `commit-msg` hook rejects them).
