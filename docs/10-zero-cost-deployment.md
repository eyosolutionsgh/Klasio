# The demo deployment (Neon + Vercel)

**This is live.** Klasio's own shareable demo and evaluation instance runs on the stack below, on
Vercel-assigned URLs. It replaced a Hetzner box (`klasio-prelive`, CPX22, Caddy, self-hosted
GitHub Actions runner), which was decommissioned on 21 Jul 2026.

It is still **not the product's deployment model** — see `03-architecture.md`, which remains
authoritative: a school gets "one school, one server", a cloud VM or on-prem box it controls, with
its tier from a signed licence file. Nothing here changes that. This is how *we* host a demo, at
$0 or as close to it as free tiers allow, without provisioning a VM.

The distinction matters when reading the rest of this document: several choices below (a hosted
queue, a hosted LLM, a hosted object store) would be unacceptable on a school's own box, and are
only tolerable because this instance is ours and holds no real school's data.

## Constraints this deployment works under

- No paid infrastructure — every service below has a free tier used within its limits.
- The database is allowed to sleep/autosuspend on inactivity; the apps are not.
- No VM of any kind (Oracle/GCP free-tier VMs were considered and ruled out — see "Alternatives
  considered" below).
- **Additive, not replacing.** Every code change this plan requires must be an alternative path
  selected by configuration, alongside the existing on-prem/self-hosted path — never a
  replacement of it. On-prem installs and other cloud targets (e.g. a DigitalOcean droplet
  running its own Redis) must keep working exactly as they do today, unmodified, without setting
  any of the new env vars this plan introduces. See "Code changes and their blast radius" below.

## Services and where each piece runs

| Piece | Service | Tier |
| --- | --- | --- |
| `apps/web` | Vercel | Free (Hobby) |
| `apps/vendor` (the licensing portal) | Vercel | Free (Hobby) |
| `apps/api` | Vercel | Free (Hobby), via a serverless entrypoint |
| Database (school app) | Neon (Postgres 16) | Free |
| Database (vendor portal, if deployed) | Neon — separate project | Free |
| Payment sweep / fee reminder scheduling | Upstash QStash | Free |
| LLM | Google AI Studio (Gemini) | Free |
| Object storage (photos, documents, deposit proofs) | Cloudflare R2 | Free (10GB) |

### 1. Database — Neon

- One Neon project per app that needs a database: the school app, and a second, separate Neon
  project for `apps/vendor`. Per `vendor-licensing-portal`, the vendor
  portal's database must never be the same one a school's data lives in.
- Neon gives two connection strings per project:
  - **Direct** (non-pooled) — used for running migrations (`pnpm db:deploy`), seeding
    (`pnpm db:seed`), and creating the non-owner `eyo_app` role plus the tenant-isolation RLS
    policies the app depends on (see `03-architecture.md` and the row-level-security rules in
    `CLAUDE.md`).
  - **Pooled** (`-pooler` host) — used as `DATABASE_URL` / `APP_DATABASE_URL` by the *running*
    app. Required because Vercel Functions open a new Postgres connection on every cold start;
    without pooling this exhausts Neon's connection limit almost immediately.
- The free tier autosuspends the database after a period of inactivity and resumes transparently
  on the next query (a second or so of added latency) — acceptable because only the database is
  allowed to sleep here, not the apps.

### 2. apps/web — Vercel

- Deployed as its own Vercel project, root directory `apps/web`. It is a plain Next.js app, no
  code changes needed.
- Env: `API_URL` (or equivalent) pointing at the deployed api project's URL.

### 3. apps/vendor — Vercel

- Deployed, so the licence-minting flow is demoable live. (A licence can still be minted locally
  with `pnpm --filter @eyo/api licence:mint` and installed by hand — useful when the school app
  needs entitlements before the vendor portal is reachable.)
- **Deployed.** Its own Vercel project, root directory `apps/vendor`, pointed at its own Neon
  project — never the school app's database. This restores a separation the decommissioned
  Hetzner box had compromised by co-tenanting both stacks on one machine.

### 4. apps/api — Vercel

`apps/api` boots today as a long-running process (`NestFactory.create` + `app.listen()` in
`apps/api/src/main.ts`), which Vercel Functions cannot host directly — a Function is
request-scoped and does not stay alive to hold an open listener. To deploy it on Vercel:

- Add a serverless entrypoint (`api/index.ts`) that constructs the Nest app **once**, cached at
  module scope across invocations of the same warm Function instance (not rebuilt per-request),
  wrapped with `@codegenie/serverless-express` (the maintained fork of the now-abandoned
  `@vendia/serverless-express`).
- Add a `vercel.json` that rewrites all incoming paths to that one Function.
- Env vars needed on this project:
  - `DATABASE_URL` / `APP_DATABASE_URL` — the **pooled** Neon connection strings.
  - JWT signing secret(s) (`jwtSecret()` in `apps/api/src/common/auth.ts` refuses to start
    without one in production).
  - `GEMINI_API_KEY` — see LLM section below.
  - `LICENCE` — the raw signed licence text (not a file path). `LicenceService.resolveRaw()`
    (`apps/api/src/licence/licence.service.ts`) checks the database first, then `LICENCE_FILE`,
    then this env var — so setting `LICENCE` is enough to boot with entitlements until/unless it
    gets persisted into `system.licence` in the database.
  - `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` — see queue section.

### 5. Queue — Upstash QStash, added alongside BullMQ

`apps/api` currently runs two BullMQ `Worker`s — a long-running, always-listening process — for:

- the payment re-query sweep (`apps/api/src/payments/payments.module.ts`)
- scheduled fee reminders (`apps/api/src/fees/fees.module.ts`)

A BullMQ `Worker` cannot run on a serverless Function for the same reason the Nest bootstrap
can't: nothing stays alive to block on the Redis connection between invocations. But QStash is a
hosted Upstash cloud service — hard-replacing BullMQ with it would mean an on-prem or offline
school, or a self-managed DigitalOcean droplet already running its own Redis, would suddenly need
internet access to a third-party service just to process payments and reminders. That is a
regression against the product's own "no call home," offline-capable principles (`docs/README.md`
product principles 6 and 7), so QStash is added as a **second, config-selected trigger path**,
not a replacement:

- `QSTASH_TOKEN` set (this deployment) → two QStash **schedules** (cron-style, minute-level
  granularity — unlike Vercel Hobby cron, which is capped at once per day) POST to two new signed
  callback routes on the api deployment: one draining the payment sweep, one ticking fee
  reminders. Each route verifies the QStash signature (`@upstash/qstash`'s `Receiver`) before
  processing.
- `REDIS_URL` set and no `QSTASH_TOKEN` (on-prem, DigitalOcean, any self-hosted deployment with
  its own Redis) → the existing BullMQ `Worker` path runs exactly as it does on `main` today.
  Nothing about `payments.module.ts` or `fees.module.ts`'s existing behaviour changes for these
  deployments.
- Neither set → both features degrade exactly as they already do today (sweep/reminders disabled,
  logged, payments still settle via webhooks) — this is existing, supported behaviour, not new.

The two BullMQ modules gain new code (the QStash schedule registration and the signed callback
routes) but keep their existing Redis/BullMQ code path untouched, selected by which env var is
present.

### 6. LLM — Google AI Studio (Gemini)

`apps/api/src/common/llm.ts` already supports Gemini as a provider (`GEMINI_API_KEY`), alongside
Anthropic and a local Ollama fallback. For this deployment:

- Generate a free API key at Google AI Studio.
- Set `GEMINI_API_KEY` on the api Vercel project. No code change needed — `callLlm()` tries
  Anthropic first only if `ANTHROPIC_API_KEY` is set, so leaving that unset makes Gemini the sole
  active provider.
- Google AI Studio's free tier is rate-limited (requests per minute), which is fine for demo
  traffic but would need upgrading for real usage.

### 7. Object storage — Cloudflare R2

`apps/api/src/common/storage.ts` stores student photos, student documents and bank-deposit proofs
via a `StorageProvider` interface with two adapters: S3 (also speaking any S3-compatible endpoint,
which is how the codebase already supports self-hosted MinIO) and local disk, used automatically
when no bucket is configured (`storage()` at `common/storage.ts:153`).

Local disk is the wrong choice for Vercel: its filesystem is read-only except `/tmp`, and `/tmp`
is neither shared across Function instances nor persisted between invocations — uploads would
fail to write, or silently disappear. This needs a real bucket, but **no code change**, since the
existing `S3Provider` already takes a custom endpoint. Cloudflare R2 is S3-compatible, free up to
10GB with no egress fees, and needs only configuration on the api Vercel project:

- `STORAGE_S3_BUCKET`
- `STORAGE_S3_ENDPOINT` — R2's account-scoped S3 endpoint
- `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY`
- `STORAGE_S3_REGION` — R2 accepts `auto`

On-prem and DigitalOcean deployments are unaffected: leaving these env vars unset keeps them on
local disk (or their own MinIO), exactly as today.

## Code changes and their blast radius

Two things in this plan require actual code changes. Both are additive — a new path selected by
configuration — and leave every existing deployment target unmodified:

| Change | What's added | What existing deployments keep doing |
| --- | --- | --- |
| Serverless entrypoint for `apps/api` | New `api/index.ts` + `vercel.json`, wrapping the existing Nest app for a Vercel Function | `apps/api/src/main.ts` is untouched — on-prem, DigitalOcean, or any VM still runs `node dist/main.js` as a normal long-running process |
| QStash trigger path for the payment sweep / fee reminders | New schedule registration + two signed callback routes in `payments.module.ts` / `fees.module.ts`, selected when `QSTASH_TOKEN` is set | The existing BullMQ `Worker` + `REDIS_URL` path is untouched and keeps running for any deployment that sets `REDIS_URL` instead |

Everything else in this plan (Neon's pooled vs. direct connection string, `GEMINI_API_KEY`,
`LICENCE`) is pure configuration — no code changes, and no interaction with how on-prem or
DigitalOcean deployments are set up.

## Alternatives considered and ruled out

- **Oracle Cloud / Google Cloud Always-Free VM** running everything (Postgres, api, web) via
  docker-compose — genuinely $0 and matches the product's real "one school, one server" model
  most closely, but was ruled out per explicit direction to avoid a VM for this deployment.
- **Render / Railway / Fly.io free tiers** for the api — ruled out because none currently offer a
  truly free, always-on tier: Render's free web services sleep after ~15 minutes of inactivity,
  and Fly/Railway require a paid plan or an expiring trial credit to stay always-on. The apps
  (as opposed to the database) must not sleep for this deployment.
- **Vercel Cron instead of Upstash QStash** for the payment sweep / fee reminders — same free-$0
  cost, less code to change (no new callback routes), but Vercel Hobby cron is capped at once a
  day per schedule. Considered too degraded for a demo of money-settlement and reminder flows,
  where a day of lag is materially misleading.

## Known limitations of this deployment

- The database autosuspending adds cold-start latency to the first request after idle.
- The LLM and QStash free tiers are rate/volume-limited — fine for demo traffic, not for real
  school usage.
- This is not how a real school's instance should be run — see `03-architecture.md` for the
  supported "one school, one server" model. Nothing about this deployment (Vercel, Neon, Upstash)
  should be treated as the reference architecture for an actual customer install.
