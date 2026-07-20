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

## Rehearsed 20 Jul 2026

A full destroy → restore cycle was run against the live box and verified:

|                       | Before                        | After           |
| --------------------- | ----------------------------- | --------------- |
| school / tier         | Klasio Demo School / ADVANCED | identical       |
| students              | 15                            | identical       |
| ledger entries / owed | 47 / GHS 17,840.00            | identical       |
| attendance records    | 225                           | identical       |
| licences              | 1                             | identical       |
| signing key           | present                       | present         |
| app / api / licensing | 200 / 200 / 200               | 200 / 200 / 200 |

Restore took **62 seconds** and came back on the same IP, so DNS never moved.

**The runner takes about a minute longer than the box.** GitHub holds the previous
session open, so the service logs `A session for this runner already exists` and
`Conflict. Retrying until reconnected` for ~60s before `Runner reconnected`. It is
enabled and starts on boot — nothing to do but wait, and `--sync` already waits up
to 150s for it. Do not re-register the runner because it looks offline right after
a restore.

`--sync` was rehearsed separately: restore in 50s, the runner came back inside the
wait, the dispatched deploy ran to success on the restored box, and all the counts
above were still intact afterwards — a rebuild does not touch the volumes.

What that run did **not** prove: the box was already at the commit it converged to,
so the deploy was a no-op convergence. It shows the mechanism works end to end —
dispatch, runner pickup, rebuild, health checks — not that a box restored from an
older snapshot picks up changes it slept through. Worth one deliberate test the
first time a restore follows a snapshot that is genuinely behind `main`.

## Cost

Idle cost after a destroy is the snapshot (a few cents per GB per month) plus the
two reserved IPs — versus $22.99/month for a running CPX22.

## Requirements

```bash
brew install hcloud jq
HCLOUD_TOKEN=<token> hcloud context create klasio --token-from-env
```
