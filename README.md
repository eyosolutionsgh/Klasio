# EYO School Management System

AI-powered school management for private schools in Ghana and across Africa — pre-school (creche/KG) through high school (SHS).

**One school, one server.** Every school runs its own deployment — a cloud VM it controls, or a box in the school office, online or offline. There is no shared multi-tenant estate: the school's data sits on the school's own machine. What the school has paid for is stated in a vendor-signed licence file it installs, checked locally with no call home, so a school on an intermittent line or a LAN with no internet at all keeps working.

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

Demo logins (password `Password1!`): `klasio-owner@mailinator.com` · `klasio-head@mailinator.com` · `klasio-bursar@mailinator.com` · `klasio-teacher@mailinator.com`

## Tests

```bash
pnpm test          # unit tests
pnpm test:e2e      # Playwright, both suites — see prerequisites below
pnpm lint && pnpm typecheck
pnpm --filter @eyo/api db:drift-check   # migration chain == schema, always
```

There are two E2E suites, one per application, each with its own fixtures.

```bash
# The school portal (:3000 + the API on :4000)
pnpm db:seed && pnpm --filter @eyo/api db:seed:second
NEXT_DIST_DIR=.next-e2e pnpm --filter @eyo/web build      # a production build, in its own
NEXT_DIST_DIR=.next-e2e pnpm --filter @eyo/web start      # dist dir — the dev server drops
pnpm --filter @eyo/web test:e2e                           # connections partway through a run

# The licensing portal (:3200)
pnpm --filter @eyo/vendor db:seed          # a member of staff to sign in as
pnpm --filter @eyo/vendor db:seed:e2e      # 26 client schools, replaced on every run
pnpm --filter @eyo/vendor dev
pnpm --filter @eyo/vendor test:e2e
```

## Deploying a school

```bash
JWT_SECRET=$(openssl rand -hex 32) \
APP_DB_PASSWORD=$(openssl rand -hex 16) \
APP_ENCRYPTION_KEY=$(openssl rand -hex 32) \
docker compose up -d
```

Boots Postgres + Redis + API (running `migrate deploy` first) + web, and creates the non-owner
`eyo_app` role the API connects as — without which row-level security is switched off.

Then open the box and go to **`/setup`**. It creates the school and its owner account, and closes
permanently once it has run. Do not expose the port to the internet before that: `/setup` is
guarded on "no school exists yet", so between first boot and first use, whoever reaches it first
claims the server.

`SETUP_SCHOOL_NAME` / `SETUP_OWNER_EMAIL` / `SETUP_OWNER_PASSWORD` do the same thing unattended.

### Licences

A licence sets the package. Install it at `/setup`, or later under
**Settings → Licence**, or mount it at `LICENCE_FILE`. Without one the school runs on the free
package; if one lapses it keeps working through a grace period and then falls back to the free
package — records are never locked away, and export always works.

Vendors mint licences with `pnpm --filter @eyo/api licence:mint`. Generate the signing key once
with `licence:new-key` and set the public half as `LICENCE_PUBLIC_KEY` on every deployment; the
API refuses to validate against the built-in development key when `NODE_ENV=production`.

## Repository layout

```
apps/api        NestJS API — modules: auth, setup, licence, schools, students, attendance, assessment, fees, broadcasts, social, dashboard
apps/web        Next.js staff portal
docs/           Product plan: research, feature catalog & tiers, architecture, roadmap, practices, UX
.github/        CI: lint → typecheck → unit → migration gates → build → E2E
```

## Engineering rules (enforced)

1. Never edit an applied migration; roll forward only. A fresh `migrate deploy` must always produce a complete schema.
2. The fee ledger is append-only; corrections are reversals.
3. Feature code checks entitlements, never tier names.
4. No AI attribution trails in commits (husky `commit-msg` hook rejects them).
