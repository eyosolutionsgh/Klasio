# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

EYO SMS — school management for African private schools (Ghana-first, pre-school→SHS). One codebase ships two ways: multi-tenant **SaaS** and per-school **standalone** (Docker, online or offline). The product plan lives in [`docs/`](docs/README.md); `docs/03-architecture.md` and `docs/04-tech-stack.md` are the authoritative references for the rules below.

Monorepo (pnpm workspaces): `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared` (currently empty scaffold). Requires Node 22+, pnpm 10, PostgreSQL 16.

## Commands

```bash
pnpm install
pnpm dev                 # api :4000 + web :3000 in parallel
pnpm build               # -r build across workspaces
pnpm lint                # eslint (all workspaces)
pnpm typecheck           # tsc --noEmit (all workspaces)
pnpm test                # unit tests (vitest, --passWithNoTests)
pnpm test:e2e            # Playwright — needs both apps running + seeded db

# database (from repo root)
cp .env.example apps/api/.env
pnpm db:deploy           # apply migration chain (must run clean on any empty DB)
pnpm db:seed             # demo school "Brighton Academy"
pnpm db:migrate          # prisma migrate dev — creates a new migration
pnpm --filter @eyo/api db:drift-check   # assert migrations == schema.prisma

# run a single unit test
pnpm --filter @eyo/api exec vitest run src/common/entitlements.spec.ts
pnpm --filter @eyo/api exec vitest run -t "entitlement"   # by test name

# run one E2E spec
pnpm --filter @eyo/web exec playwright test e2e/portal.spec.ts
```

Demo logins (password `Password1!`): `owner@ · head@ · bursar@ · teacher@` `demo.school`.

## Architecture

**API is a NestJS modulith.** Each domain (`auth`, `schools`, `students`, `attendance`, `assessment`, `fees`, `dashboard`, `announcements`) is a single `*.module.ts` file that co-locates the Controller, Service, DTOs (class-validator), and `@Module` — there are no separate `.controller.ts`/`.service.ts`/`.dto.ts` files. Follow that one-file-per-module convention when adding features. Modules are wired in `apps/api/src/app.module.ts`.

**Auth & authorization are enforced by one global guard** (`apps/api/src/common/auth.ts`, registered as `APP_GUARD`). Every route is protected unless decorated `@Public()`. The guard verifies the JWT, attaches `AuthUser` (`{ sub, schoolId, role, tier, name }`), then checks decorators layered on the handler:
- `@Roles(...)` — RBAC (OWNER/HEAD/BURSAR/TEACHER/FRONT_DESK/GUARDIAN).
- `@RequireEntitlement(code)` — feature gating.
- `@CurrentUser()` param decorator injects the `AuthUser`.

**Web is server-rendered.** Portal pages under `apps/web/src/app/(portal)/` are async Server Components that fetch through `apps/web/src/lib/api.ts`. That `api()` helper reads the `eyo_token` cookie, calls the NestJS API, and `redirect('/login')`s on 401 — there is no client-side data layer.

## Non-negotiable rules (CI enforces these)

1. **Migrations roll forward only.** Never edit an applied migration in `apps/api/prisma/migrations/`. `pnpm db:deploy` on an empty database must always produce the complete schema; `db:drift-check` (a CI gate) fails the build if the migration chain and `schema.prisma` diverge. After changing `schema.prisma`, generate a migration with `db:migrate`.

2. **The fee ledger is append-only.** `LedgerEntry` rows are never updated or deleted. Corrections are new `REVERSAL` entries pointing at `reversedId`. All money math derives from summing ledger entries (see `FeesService.overview`). Amounts are stored positive; `type` determines direction (INVOICE increases balance owed, PAYMENT/DISCOUNT/WAIVER decrease it).

3. **Feature code checks entitlement codes, never tier names.** Tiers (BASIC/MEDIUM/ADVANCED) are bundles of entitlements defined in `apps/api/src/common/entitlements.ts`; standalone installs get the same set from a vendor-signed license. Gate with `@RequireEntitlement('some.code')` or `hasEntitlement(tier, code)` — never branch on `tier === 'ADVANCED'`.

4. **Multi-tenancy: every tenant-owned table carries `schoolId`,** and every query must filter by `auth.schoolId`. There is no automatic tenant scoping — it is manual in each query.

5. **No AI attribution in commits.** The husky `commit-msg` hook (commitlint + custom policy) rejects `Co-Authored-By` / "Generated with" trails. Commits follow Conventional Commits.

## Domain specifics

- **GES terminal reports** (`assessment.module.ts`): SBA (continuous assessment) is weighted to 30, exam to 70; grades come from a `GradingScheme.bands` JSON; positions use standard competition ranking (ties share a position). Computed reports are persisted as `TermReport` with `lines` JSON, then rendered print-faithfully in the web portal.
- **Academic calendar** is the 3-term Ghana Education Service structure: `AcademicYear` → `Term`, with `isCurrent` flags.
- **Mutations should write an audit row** via `PrismaService.audit(...)` (`prisma.service.ts`).

## Per-user global standing instructions (apply here too)

- Before writing/modifying code that uses any library/framework/SDK/API/CLI, fetch current docs via the **Context7 MCP** (`resolve-library-id` → `query-docs`) rather than relying on memory.
- Update project memory with non-obvious learnings **in the same pass as the commit**, before committing.
