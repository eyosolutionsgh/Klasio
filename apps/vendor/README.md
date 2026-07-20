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

## Licences

Sold by term — monthly, quarterly, annually, or bi-annually. **Bi-annually here means every two
years**, and every option on the form spells its duration out, because the word means the opposite
to about half the people who read it. Bespoke durations (a trial, a bridge between terms) come from
`pnpm --filter @eyo/api licence:mint --days 20`, which is the right amount of friction for an
exception.

The term is stored on the licence rather than inferred from its dates: calendar months are uneven,
and a licence cut from the CLI has a duration but no product.

**Withdrawing a licence does not reach the school.** Their server holds the signed file and checks
it locally — that is what lets a school with no reliable internet keep working — so nothing here
can take it back. Withdrawing makes this database true: the licence stops counting as the one in
force, the client reads as unlicensed, and the next renewal is priced against reality. To move a
school sooner, issue a shorter licence they will install, or wait for expiry. The row is kept and
marked rather than deleted, because what was sent to a school is the one thing support cannot
reconstruct from anywhere else.

## Starting up

The server refuses to start in production without the secrets it needs, and says all of them at
once — `VENDOR_ENCRYPTION_KEY` (32 bytes), `VENDOR_SESSION_SECRET`, `VENDOR_DATABASE_URL`. The check
runs in `src/instrumentation.ts`, before the first request is answered, and **exits non-zero**
rather than throwing: a thrown error leaves Next listening and answering 500 to everything, which
reads to an orchestrator as a server that started.

A signing key is deliberately not required — tracking licences without issuing them is a supported
way to run.

Development requires nothing: every one of these has a documented fallback, and `next build` needs
none of them, so CI does not hold production secrets.

## Signing in

Two factors, required for everyone. This portal can mint a licence for any school, so a password on
its own was the whole of its security.

A correct password buys a **pending** session and nothing else — a separate cookie that no page or
action will accept, so there is no shape of bug where a half-authenticated token is mistaken for a
finished one. It is exchanged for a real session by one of:

- **an authenticator app** (TOTP, RFC 6238) — always available, needs no network and no mail
  provider, which is why it leads;
- **an emailed code** — offered only when a mail provider is configured, so nobody clicks an option
  that was never going to arrive;
- **a recovery code** — ten, issued once at enrolment, each usable once.

Five wrong codes locks the account for fifteen minutes, whichever kind of code was wrong.

Recovery codes are shown exactly once and stored hashed: the portal cannot show them again because
it cannot read them. Somebody who loses both their phone and their codes needs another member of
staff to clear `totpConfirmedAt` on their row, which re-runs enrolment on their next sign-in.
