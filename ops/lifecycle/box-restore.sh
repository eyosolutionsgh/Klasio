#!/usr/bin/env bash
# Recreate the Klasio pre-live box from the latest snapshot, reattach the reserved
# IPs, wait for SSH, bring the stack up, then smoke-test. Same IP, no re-seed.
#
# Unlike the other projects' boxes there is no git checkout here — the deploy
# workflow rsyncs the tree in from a self-hosted runner — so "converge to latest
# main" cannot be a `git pull`. By default this boots exactly what was snapshotted,
# which is correct and quick. `--sync` additionally asks GitHub to run a deploy,
# which is how a box restored weeks later picks up what it missed. The runner
# itself is inside the snapshot and reconnects on boot.
#
# Usage:
#   ./box-restore.sh            # boot the snapshot state (default)
#   ./box-restore.sh --sync     # then trigger a deploy to converge to main
set -euo pipefail
# Resolved BEFORE the cd, because `cd "$(dirname "$0")"` leaves a relative $0
# pointing nowhere — which silently broke --help, since it greps its own source.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"
# shellcheck source=ops/lifecycle/config.sh
source ./config.sh

SYNC=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sync) SYNC=1; shift ;;
    -h|--help) grep '^#' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if hc server describe "$SERVER_NAME" >/dev/null 2>&1; then
  echo "Server '$SERVER_NAME' already exists. Nothing to restore."
  exit 0
fi

echo "Finding latest snapshot…"
snap_id="$(hc image list --type snapshot --selector "$SNAPSHOT_LABEL_KEY=$SNAPSHOT_LABEL_VALUE" \
  -o json | jq -r 'sort_by(.created) | last | .id // empty')"
[[ -n "$snap_id" ]] || { echo "ERROR: no snapshot found to restore from." >&2; exit 1; }
echo "Using snapshot id=$snap_id"

create_args=(
  --name "$SERVER_NAME"
  --type "$SERVER_TYPE"
  --location "$SERVER_LOCATION"
  --image "$snap_id"
  --ssh-key "$SSH_KEY_NAME"
  --primary-ipv4 "$PRIMARY_IP_NAME"
)
# Omitting the flag entirely would let Hetzner attach a fresh auto IPv6 that
# changes on every restore, so ask for the reserved one — or for none.
if [[ -n "$PRIMARY_IPV6_NAME" ]]; then
  create_args+=(--primary-ipv6 "$PRIMARY_IPV6_NAME")
else
  create_args+=(--without-ipv6)
fi

echo "Creating server '$SERVER_NAME' from snapshot…"
hc server create "${create_args[@]}"

ipv4="$(hc server describe "$SERVER_NAME" -o json | jq -r '.public_net.ipv4.ip')"
echo "Server up at $ipv4. Waiting for SSH…"

# A box restored from a snapshot keeps the snapshot's host keys, but a box
# rebuilt from a fresh image would not — and either way the reserved IP is
# reused, so a stale pinned key makes `accept-new` reject the connection and the
# wait below loops until timeout on a perfectly healthy box. Drop the entry.
ssh-keygen -R "$ipv4" >/dev/null 2>&1 || true

deadline=$((SECONDS + SSH_WAIT_TIMEOUT))
until ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$SSH_USER@$ipv4" true 2>/dev/null; do
  [[ $SECONDS -lt $deadline ]] || { echo "ERROR: SSH did not come up in time." >&2; exit 1; }
  sleep 5
done
echo "SSH is up."

# `--no-build`: the images are already in the snapshot. Rebuilding here would
# take ~10 minutes on 2 vCPU and is exactly what --sync is for.
echo "Bringing the stack up…"
ssh "$SSH_USER@$ipv4" "cd '$REMOTE_DEPLOY_DIR' && docker compose up -d --no-build"

echo "Smoke testing $SMOKE_URL…"
deadline=$((SECONDS + STACK_WAIT_TIMEOUT))
until code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -L "$SMOKE_URL" 2>/dev/null)"; \
      [[ "$code" =~ ^(200|301|302|303|307|308)$ ]]; do
  [[ $SECONDS -lt $deadline ]] || { echo "WARN: smoke test not green yet (last=$code). Check logs." >&2; exit 1; }
  sleep 5
done
echo "Restore complete — $SMOKE_URL → HTTP $code"

if [[ $SYNC -eq 1 ]]; then
  echo
  echo "Triggering a deploy to converge to latest main…"
  command -v gh >/dev/null 2>&1 || { echo "WARN: gh not installed — skipping sync." >&2; exit 0; }
  # The self-hosted runner comes back with the snapshot, so it has to be online
  # before the job can be picked up. A dispatched run also skips the CI gate by
  # design — see the workflow header.
  for _ in $(seq 1 30); do
    status="$(gh api "repos/$GITHUB_REPO/actions/runners" -q '.runners[0].status' 2>/dev/null || true)"
    [[ "$status" == "online" ]] && break
    sleep 5
  done
  [[ "$status" == "online" ]] || echo "WARN: runner is '$status' — the deploy will queue until it returns."
  gh workflow run "$DEPLOY_WORKFLOW" --repo "$GITHUB_REPO" --ref main
  echo "Deploy dispatched. Watch it with: gh run watch --repo $GITHUB_REPO"
fi
