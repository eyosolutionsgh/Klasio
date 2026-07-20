# Box lifecycle — shutting the pre-live box down and bringing it back

Same pattern as the VECIP, TholaLink, TsengaNow, VikelaID and TfolaDriver boxes:
snapshot and delete the server between demos, keep the reserved IPs, and restore
onto the **same address** so DNS never changes.

```bash
./box-destroy.sh          # snapshot → verify → prune → delete   (asks first; -y to skip)
./box-restore.sh          # latest snapshot → same IP → stack up → smoke test
./box-restore.sh --sync   # …then trigger a deploy to converge to latest main
```

## Why the reserved IPs matter

A primary IP created automatically with a server has `auto_delete=true` and is
**destroyed with it**. The box would come back on a new address and every
`*.klasio.ecfatumes.com` record would point at nothing. Both IPs on this project
have been reserved:

```
klasio-ipv4  178.105.181.225           auto_delete=false
klasio-ipv6  2a01:4f8:1c16:2be7::/64   auto_delete=false
```

`box-destroy.sh` refuses to delete anything while any primary IP still has
`auto_delete=true`, because discovering it afterwards is unrecoverable.

## What restore does differently here

The other projects keep a git checkout on the box and converge with `git pull`.
This box has none — the deploy workflow rsyncs the tree in from a self-hosted
runner. So:

- **Default**: boots exactly what was snapshotted (`docker compose up -d --no-build`).
  Fast, and right for a box that was down for a few days.
- **`--sync`**: additionally dispatches the deploy workflow, which is how a box
  restored weeks later picks up what it missed. The runner is inside the snapshot
  and reconnects on boot; the script waits for it to report `online` first.

A dispatched deploy **skips the CI gate** by design — see the workflow header.

## Before you destroy

The snapshot is the only copy of everything on the box: `/opt/klasio/.env`, both
database volumes, and the **licence signing key**. Losing that key means no new
licence will ever verify on an already-deployed school server.

There is a verified off-box backup at `~/klasio-prelive-backup/` (signing key,
public key, `.env`, owner credentials, vendor enrolment). Keep it current, and
keep the signing key in a password manager as well.

## Cost

Idle cost after a destroy is the snapshot (a few cents per GB per month) plus the
two reserved IPs — versus $22.99/month for a running CPX22.

## Requirements

```bash
brew install hcloud jq
HCLOUD_TOKEN=<token> hcloud context create klasio --token-from-env
```
