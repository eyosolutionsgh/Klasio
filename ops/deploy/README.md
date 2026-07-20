# Pre-live deployment (Hetzner)

One CX23 running both the school stack and the vendor licensing portal, deployed by a self-hosted
GitHub Actions runner on the box itself.

> **This is a pre-live/demo host, not a school's production server.** `docs/03-architecture.md`
> keeps the vendor portal off any school's box, and co-tenanting them here is a deliberate
> exception for a demo environment. The parts of that separation that cost nothing are kept: two
> Postgres containers, two volumes, two credentials, two networks — the school stack has no route
> to the licence database. Do not copy this layout onto a real school's server.

## Shape

```
                       ┌─ Caddy :80/:443 ─────── the only published ports
                       │
   school network      │      vendor network
   ├─ web    :3000 ◄───┤      ├─ vendor   :3200 ◄─┐
   ├─ api    :4000 ◄───┘      └─ vendordb :5432   │ holds the signing key
   ├─ db     :5432                                │
   └─ redis  :6379                                ┘
```

On the server:

```
/opt/klasio/
  docker-compose.yml   copied from repo/ops/deploy/ by the deploy workflow
  Caddyfile            copied from repo/ops/deploy/ by the deploy workflow
  .env                 secrets, written by hand, never committed, never overwritten
  repo/                the monorepo, rsync'd by the deploy workflow
  licence/             the school's own licence file (klasio.licence)
  vendor-keys/         signing-key.pem — the private half. chmod 400.
```

## First-time setup

### 1. Create the server

Needs an hcloud context for the Klasio project. The token comes from the Hetzner Console
(Security → API Tokens → Generate, **Read & Write**):

```bash
hcloud context create klasio        # paste the token at the prompt
hcloud ssh-key create --name aaodoom --public-key-from-file ~/.ssh/id_ed25519.pub
hcloud server create \
  --name klasio-prelive \
  --type cx23 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key aaodoom
```

### 2. Bootstrap the box

Installs Docker, 4 GB of swap, log rotation, a firewall, and the `deploy` user:

```bash
scp ops/deploy/bootstrap.sh root@<ip>:/tmp/
ssh root@<ip> bash /tmp/bootstrap.sh
```

### 3. DNS

Point `WEB_DOMAIN`, `API_DOMAIN` and `VENDOR_DOMAIN` at the server's IP **before** the first
deploy. Caddy solves an HTTP-01 challenge on :80; a name that does not resolve yet fails issuance
and then backs off, which looks like broken TLS for much longer than the DNS actually took.

### 4. Secrets

```bash
ssh deploy@<ip>
cp /opt/klasio/repo/ops/deploy/.env.example /opt/klasio/.env   # after the first deploy syncs repo/
$EDITOR /opt/klasio/.env                                       # generate each with: openssl rand -hex 32
```

### 5. The signing key

Everything a Klasio server will ever trust is signed with this key. Generate it **off the box**,
keep the private half in a password manager, and treat losing it as losing the product.

```bash
pnpm --filter @eyo/api licence:new-key       # prints a keypair
```

- The **private** half → `/opt/klasio/vendor-keys/signing-key.pem`, `chmod 400`, owned by `deploy`.
- The **public** half → `LICENCE_PUBLIC_KEY` in `/opt/klasio/.env`, so the school stack on this
  same box verifies against it.

Never use the committed development pair in `ops/licence/` here. Neither image ships it — both
Dockerfiles refuse to build if key material lands in the output — and that absence is the guard.

### 6. The runner

As the `deploy` user. Get a registration token from
`github.com/eyosolutionsgh/Klasio` → Settings → Actions → Runners → New self-hosted runner:

```bash
ssh deploy@<ip>
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz
tar xzf runner.tar.gz
./config.sh --url https://github.com/eyosolutionsgh/Klasio \
            --token <REGISTRATION_TOKEN> \
            --labels self-hosted,klasio-prelive \
            --unattended
sudo ./svc.sh install deploy && sudo ./svc.sh start
```

The labels must match `runs-on: [self-hosted, klasio-prelive]` in the workflow.

> **Repository visibility matters.** A self-hosted runner executing pull-request code is only
> safe on a private repository. `deploy-prelive.yml` refuses PR runs from forks for exactly this
> reason — the runner sits next to the signing key, which is a file on disk rather than a
> repository secret, so GitHub's own secret-withholding does not protect it. If Klasio is ever
> made public, take the `pull_request` trigger off this workflow.

### 7. Deploy

Push to `main` and the deploy starts **once CI goes green** — it triggers on CI completing, not on
the push, because two workflows listening to the same push would otherwise race and ship a commit
whose tests were still running. To force a deploy past that gate, run **Deploy pre-live (Hetzner)**
from the Actions tab.

## How a deploy runs

`.github/workflows/deploy-prelive.yml`:

1. `rsync --delete` the checkout into `/opt/klasio/repo` (`.env*` excluded, always).
2. Copy `docker-compose.yml` and `Caddyfile` into place.
3. Record the running images so a failure can be undone.
4. Build `api`, `web`, `vendor` — **one at a time**. Concurrent Next.js builds OOM a 4 GB box.
5. `docker compose up -d --no-build`. Migrations apply on container start, for both databases.
6. Probe all three from inside the compose networks; on failure, re-tag the last-good images,
   bring them back up, and fail the run.

The API probe is `GET /public/setup/state` — `@Public`, and it counts schools, so a 200 proves the
app booted _and_ the database is reachable through the `eyo_app` role. A port check would pass on
a server answering every request with a 500.

## Operating it

```bash
ssh deploy@<ip> && cd /opt/klasio

docker compose ps
docker compose logs -f api
docker compose logs --tail=100 vendor

# Seed the demo school (first deploy only — a fresh box otherwise lands on /setup)
docker compose exec api pnpm db:seed
```

**Backups are not configured.** Two volumes hold everything that matters, `dbdata` and
`vendordbdata`, and nothing currently copies them anywhere. Before this box holds anything real,
add a `pg_dump` to object storage on a timer — the licence database in particular has no other
copy, and a Hetzner snapshot restores the whole VM rather than one database.
