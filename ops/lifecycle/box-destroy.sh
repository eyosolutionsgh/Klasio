#!/usr/bin/env bash
# Snapshot the running Klasio pre-live box, verify the snapshot, prune older ones,
# KEEP the reserved IPs, then delete the server. Drops idle cost to a snapshot
# plus two reserved IPs. Pair with box-restore.sh to bring it back.
#
# Safety: refuses to delete unless a fresh snapshot is confirmed available AND the
# primary IPs are reserved.
#
# Usage: ./box-destroy.sh [-y]
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ops/lifecycle/config.sh
source ./config.sh

ASSUME_YES=0
[[ "${1:-}" == "-y" || "${1:-}" == "--yes" ]] && ASSUME_YES=1

hc server describe "$SERVER_NAME" >/dev/null 2>&1 || {
  echo "Server '$SERVER_NAME' not found — nothing to destroy."; exit 0; }

# The check that makes this reversible. A primary IP with auto_delete=true is
# destroyed with the server, so the box would come back on a different address
# and every *.klasio.ecfatumes.com record would point at nothing. Better to
# refuse than to discover it after the server is already gone.
echo "Checking the primary IPs are reserved…"
doomed="$(hc primary-ip list -o json \
  | jq -r --arg s "$SERVER_NAME" '.[] | select(.auto_delete == true) | .name')"
if [[ -n "$doomed" ]]; then
  echo "ERROR: these primary IPs would be deleted with the server:" >&2
  echo "$doomed" | sed 's/^/  - /' >&2
  echo "Reserve them first:  hcloud primary-ip update <name> --auto-delete=false" >&2
  exit 1
fi
echo "Primary IPs are reserved — the address survives the delete."

SNAP_DESC="${SNAPSHOT_PREFIX}-snapshot"

echo
echo "About to snapshot then DELETE server '$SERVER_NAME' (IPs are kept)."
echo "Everything not in the snapshot is lost — including /opt/klasio/.env, the"
echo "licence signing key, and both database volumes."
if [[ $ASSUME_YES -ne 1 ]]; then
  read -r -p "Proceed? [y/N] " ans; [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

echo "Creating snapshot '$SNAP_DESC' (this can take several minutes)…"
hc server create-image --type snapshot \
  --description "$SNAP_DESC" \
  --label "$SNAPSHOT_LABEL_KEY=$SNAPSHOT_LABEL_VALUE" \
  "$SERVER_NAME"

# Verify a matching snapshot now exists and is available. `create-image` returning
# 0 is not the same as a restorable image existing.
echo "Verifying snapshot…"
latest="$(hc image list --type snapshot --selector "$SNAPSHOT_LABEL_KEY=$SNAPSHOT_LABEL_VALUE" \
  -o json | jq -r 'sort_by(.created) | last')"
latest_id="$(jq -r '.id // empty' <<<"$latest")"
latest_status="$(jq -r '.status // empty' <<<"$latest")"
[[ -n "$latest_id" ]] || { echo "ERROR: no snapshot found after create — NOT deleting server." >&2; exit 1; }
[[ "$latest_status" == "available" ]] || {
  echo "ERROR: snapshot $latest_id is '$latest_status', not 'available' — NOT deleting server." >&2
  exit 1; }
echo "Snapshot id=$latest_id confirmed available."

# Prune all but the newest snapshot to control storage cost.
echo "Pruning older snapshots…"
hc image list --type snapshot --selector "$SNAPSHOT_LABEL_KEY=$SNAPSHOT_LABEL_VALUE" -o json \
  | jq -r 'sort_by(.created) | reverse | .[1:] | .[].id' \
  | while read -r old; do [[ -n "$old" ]] && hc image delete "$old"; done

echo "Deleting server '$SERVER_NAME' (reserved IPs are retained)…"
hc server delete "$SERVER_NAME"

echo
echo "Done. The IPs below are still reserved and still cost a little while idle:"
hc primary-ip list -o columns=name,ip,auto_delete
echo "Restore with ./box-restore.sh"
