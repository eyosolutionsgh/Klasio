# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Klasio — school management for African private schools (Ghana-first, pre-school→SHS). **One school, one server**: every school is deployed on its own cloud VM or on-prem box, online or offline. There is no multi-tenant hosted estate and no vendor console — what a school is entitled to comes from a vendor-signed licence file it installs (`apps/api/src/licence/`). The product plan lives in [`docs/`](docs/README.md); `docs/03-architecture.md` and `docs/04-tech-stack.md` are the authoritative references for the rules below.

Monorepo (pnpm workspaces): `apps/api` (NestJS), `apps/web` (Next.js), `apps/vendor` (the licensing portal, Next.js — vendor infrastructure, never part of a school's box), `packages/shared` (the licence byte layout and the entitlement catalogue). `packages/shared` is raw TypeScript — `main` points at `src/index.ts` and there is no build step — and `apps/vendor` is the only app that imports it, so anything packaging the vendor app must bring the source along. Requires Node 22+, pnpm 10, PostgreSQL 16.

## Commands

```bash
pnpm install
pnpm dev                 # api :4000 + web :3000 in parallel
pnpm build               # -r build across workspaces
pnpm lint                # eslint (all workspaces)
pnpm typecheck           # tsc --noEmit (all workspaces)
pnpm test                # unit tests (vitest, --passWithNoTests) — no database
pnpm test:integration    # API against a live Postgres as the eyo_app role (see below)
pnpm test:e2e            # Playwright — needs both apps running + seeded db

# database (from repo root)
cp .env.example apps/api/.env
pnpm db:deploy           # apply migration chain (must run clean on any empty DB)
pnpm db:seed             # demo school "Brighton Academy"
pnpm --filter @eyo/api licence:mint -- --school "X" --slug x --tier MEDIUM   # a dev licence
pnpm db:migrate          # prisma migrate dev — creates a new migration
pnpm --filter @eyo/api db:drift-check   # assert migrations == schema.prisma

# run a single unit test
pnpm --filter @eyo/api exec vitest run src/common/entitlements.spec.ts
pnpm --filter @eyo/api exec vitest run -t "entitlement"   # by test name

# run one integration spec (needs DATABASE_URL exported)
pnpm --filter @eyo/api exec vitest run --config vitest.integration.config.ts test/guardians.int-spec.ts

# run one E2E spec
pnpm --filter @eyo/web exec playwright test e2e/portal.spec.ts
```

Demo logins (password `Password1!`): `klasio-owner@ · klasio-head@ · klasio-bursar@ · klasio-teacher@` `mailinator.com`.

A **fresh** install has no school at all: the first visit lands on `/setup`, which creates the
school and its owner and then closes permanently (guarded on `school.count() === 0`, not a token).

## Architecture

**API is a NestJS modulith.** Each domain (`auth`, `schools`, `students`, `attendance`, `assessment`, `fees`, `dashboard`, `broadcasts`) is a single `*.module.ts` file that co-locates the Controller, Service, DTOs (class-validator), and `@Module` — there are no separate `.controller.ts`/`.service.ts`/`.dto.ts` files. Follow that one-file-per-module convention when adding features. Two modules deviate, `licence` and `social`, and say why in their own headers: the auth guard imports both services, and the guard cannot be imported by a file that imports the guard. Modules are wired in `apps/api/src/app.module.ts`.

**Auth & authorization are enforced by one global guard** (`apps/api/src/common/auth.ts`, registered as `APP_GUARD`). Every route is protected unless decorated `@Public()`. The guard verifies the JWT, attaches `AuthUser` (`{ sub, schoolId, role, tier, name }`), then checks decorators layered on the handler:

- `@Roles(...)` — RBAC (OWNER/HEAD/BURSAR/TEACHER/FRONT_DESK/GUARDIAN).
- `@RequireEntitlement(code)` — feature gating.
- `@CurrentUser()` param decorator injects the `AuthUser`.

**Web is server-rendered.** Portal pages under `apps/web/src/app/(portal)/` are async Server Components that fetch through `apps/web/src/lib/api.ts`. That `api()` helper reads the `eyo_token` cookie, calls the NestJS API, and `redirect('/login')`s on 401 — there is no client-side data layer.

## Next.js devtools MCP

`apps/web` runs Next.js 16, which serves an MCP endpoint from the dev server. Prefer it over guessing at the running app:

- `nextjs_index` — discover the running dev servers and their tools. Do this first; the port is not always :3000 (a second server often sits on :3100).
- `nextjs_call` with `port` + `toolName` — the useful ones are `get_errors` (build + runtime errors with source-mapped stacks), `get_routes` (every app-router entry point), `get_logs` (path to the dev log), `get_page_metadata`, and `get_server_action_by_id`.
- `nextjs_docs` — points at the version-matched docs shipped inside `node_modules/next/dist/docs/`. Read those for Next.js questions instead of Context7 or memory; they match the exact installed version.

Reach for `get_errors` before reading files when a page is broken, and `get_routes` before adding or moving a route.

## Non-negotiable rules (CI enforces these)

1. **Migrations roll forward only.** Never edit an applied migration in `apps/api/prisma/migrations/`. `pnpm db:deploy` on an empty database must always produce the complete schema; `db:drift-check` (a CI gate) fails the build if the migration chain and `schema.prisma` diverge. After changing `schema.prisma`, generate a migration with `db:migrate`.

2. **The fee ledger is append-only.** `LedgerEntry` rows are never updated or deleted. Corrections are new `REVERSAL` entries pointing at `reversedId`. All money math derives from summing ledger entries (see `FeesService.overview`). Amounts are stored positive; `type` determines direction (INVOICE increases balance owed, PAYMENT/DISCOUNT/WAIVER decrease it).

3. **Feature code checks entitlement codes, never tier names.** Tiers (BASIC/MEDIUM/ADVANCED) are bundles of entitlements defined in `apps/api/src/common/entitlements.ts`. The bundle in force comes from the vendor-signed licence; `LicenceService` is the only writer of `School.tier`. Gate with `@RequireEntitlement('some.code')` — never branch on `tier === 'ADVANCED'`, and never call `hasEntitlement(tier, code)` on a request path, because it misses the individual codes a licence can grant on top of its bundle.

4. **Every tenant-owned table carries `schoolId`,** and every query must filter by `auth.schoolId`. There is no automatic tenant scoping — it is manual in each query. Row-level security stays switched on even though there is one school per box: it turns a forgotten `where` from "returns everything" into "returns nothing". That depends on `APP_DATABASE_URL` pointing at the non-owner `eyo_app` role. A new tenant table needs **both** a `tenant_isolation` policy and a `GRANT` to `eyo_app` — the missing policy fails open and silently, the missing grant fails closed and loudly.

5. **No AI attribution in commits.** The husky `commit-msg` hook (commitlint + custom policy) rejects `Co-Authored-By` / "Generated with" trails. Commits follow Conventional Commits.

6. **Write paths are proved against a live database, not just typechecked.** `pnpm test:integration` (`apps/api/test/*.int-spec.ts`) boots the real API against PostgreSQL as the **non-owner `eyo_app` role**, so row-level security actually applies. It provisions its own database and role from `DATABASE_URL` — no extra configuration. Two RLS bugs shipped past lint, typecheck and the unit suite because none of them can see a policy: gateway webhooks that could never settle a payment, and six write paths refused outright by a nested `$transaction`. Add a spec here when you touch a tenant-scoped **write** or add a `@Public()` route that reads tenant data.

   The suite's negative half (`test/tenancy.int-spec.ts`) is not optional decoration: every other spec asserts a write _succeeds_, and would pass just as well with RLS switched off. Keep it.

   Its setup also installs a dev-signed ADVANCED licence, because entitlements are read from the licence and a box with none runs on BASIC — without it every `@RequireEntitlement` route answers 403 and the tenancy assertions underneath never run at all. The same setup deletes the previous run's second school before re-seeding: the seed recreates the demo school with a fresh `createdAt`, and a leftover second school would otherwise become "the oldest school" that the licence check identifies the box by.

## Domain specifics

- **GES terminal reports** (`assessment.module.ts`): SBA (continuous assessment) is weighted to 30, exam to 70; grades come from a `GradingScheme.bands` JSON; positions use standard competition ranking (ties share a position). Computed reports are persisted as `TermReport` with `lines` JSON, then rendered print-faithfully in the web portal.
- **Academic calendar** is the 3-term Ghana Education Service structure: `AcademicYear` → `Term`, with `isCurrent` flags.
- **Mutations should write an audit row** via `PrismaService.audit(...)` (`prisma.service.ts`).

## Per-user global standing instructions (apply here too)

- Before writing/modifying code that uses any library/framework/SDK/API/CLI, fetch current docs via the **Context7 MCP** (`resolve-library-id` → `query-docs`) rather than relying on memory. Exception: for Next.js itself, use `nextjs_docs` (above) — it resolves to the docs for the exact installed version.
- Update project memory with non-obvious learnings **in the same pass as the commit**, before committing.
