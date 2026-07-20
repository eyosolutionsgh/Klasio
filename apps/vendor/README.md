# Klasio Licensing

The vendor's back office: who the clients are, what was sold to them, and what their servers report.

**This is not part of a school's deployment.** It runs on the vendor's own infrastructure, against
its own database, and no school's box can reach it — a school POSTs a heartbeat and forgets about
it. `apps/api/Dockerfile` and `apps/web/Dockerfile` copy only their own app, and `docker-compose.yml`
(the school stack) has no vendor service in it.

## Running it

```bash
createdb eyo_vendor
cp .env.example .env          # set VENDOR_DATABASE_URL
pnpm --filter @eyo/vendor exec prisma migrate deploy
pnpm --filter @eyo/vendor seed        # first staff login
pnpm --filter @eyo/vendor dev         # :3200
```

## Configuration

| Variable                                         | Meaning                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VENDOR_DATABASE_URL`                            | The vendor's own Postgres. Never a school's.                                                                                                                                                                                                   |
| `VENDOR_SIGNING_KEY` / `VENDOR_SIGNING_KEY_PATH` | The Ed25519 private key licences are signed with. In development, leaving both unset falls back to the committed `ops/licence/dev-signing-key.pem`; in production the fallback is refused and the portal tracks licences without issuing them. |
| `VENDOR_SESSION_SECRET`                          | Signs staff sessions. Required in production.                                                                                                                                                                                                  |

The signing key is the most sensitive thing in the product: whoever holds it can mint a licence for
any school, for any package, forever. It is never written to the database, never logged, and there
is deliberately no way to read it back through the portal.

## What a school sends

`POST /api/heartbeat`, once a day, when the school has set `LICENCE_HEARTBEAT_URL`. Unauthenticated
on purpose — see the route for why — and it can only ever record an observation. Reports for a slug
no client owns are kept and surfaced rather than dropped: a deployment nobody sold is the most
interesting thing on the dashboard.

## What it flags, in priority order

1. **Attention** — reporting `verifiedWith` other than `vendor` (the box can mint itself anything),
   or a roll above the cap that was sold.
2. **Expired** — the licence lapsed.
3. **Silent** — no report for three days.
4. **Expiring** — inside thirty days.
5. **No licence** — a client nothing has been issued to.

The order matters more than the labels: a school flagged for the less useful of two true facts is
worse than one not flagged at all, because it trains people to skim the column. `health.spec.ts`
pins it.

## The CLI still works

`pnpm --filter @eyo/api licence:mint` is unchanged and is still right on a laptop that has the key
and no network. What the portal adds is a record: who was sold what, when, by whom, and the signed
text kept so it can be re-sent when a school loses the email.
