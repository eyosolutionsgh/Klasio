#!/usr/bin/env bash
# Shared config for the Klasio pre-live box lifecycle scripts (destroy/restore).
# Every value is overridable from the environment so the scripts stay portable
# across Hetzner projects. Requires the `hcloud` CLI + `jq`.
#
#   brew install hcloud jq
#   HCLOUD_TOKEN=<token> hcloud context create klasio --token-from-env
#
# The pattern keeps the reserved IPs + one snapshot between demos, so the idle
# cost is a snapshot and two IPs rather than a running server, and a restore
# brings the box back on the SAME IP — no DNS change, no re-seed, no re-migrate.

# hcloud context (local alias for the Hetzner project)
HCLOUD_CONTEXT="${HCLOUD_CONTEXT:-klasio}"

# Server
SERVER_NAME="${SERVER_NAME:-klasio-prelive}"
SERVER_TYPE="${SERVER_TYPE:-cpx22}"           # 2 vCPU / 4 GB / 80 GB
SERVER_LOCATION="${SERVER_LOCATION:-nbg1}"    # Nuremberg
SSH_KEY_NAME="${SSH_KEY_NAME:-aaodoom}"

# Reserved primary IPs. These MUST have auto_delete=false or they are destroyed
# with the server and the box comes back on a new address — which silently
# breaks the *.klasio.ecfatumes.com wildcard. box-destroy.sh asserts this before
# it deletes anything.
PRIMARY_IP_NAME="${PRIMARY_IP_NAME:-klasio-ipv4}"
PRIMARY_IPV6_NAME="${PRIMARY_IPV6_NAME:-klasio-ipv6}"

# Snapshots
SNAPSHOT_PREFIX="${SNAPSHOT_PREFIX:-klasio}"
SNAPSHOT_LABEL_KEY="${SNAPSHOT_LABEL_KEY:-klasio-lifecycle}"
SNAPSHOT_LABEL_VALUE="${SNAPSHOT_LABEL_VALUE:-true}"

# Remote box. Unlike the other projects there is no git checkout on this box —
# the deploy workflow rsyncs the tree in — so "converge to main" means asking
# GitHub to run a deploy, not `git pull`. See box-restore.sh --sync.
SSH_USER="${SSH_USER:-root}"
REMOTE_DEPLOY_DIR="${REMOTE_DEPLOY_DIR:-/opt/klasio}"
DEPLOY_WORKFLOW="${DEPLOY_WORKFLOW:-deploy-prelive.yml}"
GITHUB_REPO="${GITHUB_REPO:-eyosolutionsgh/Klasio}"
SMOKE_URL="${SMOKE_URL:-https://app.klasio.ecfatumes.com/login}"

# Timeouts (seconds)
SSH_WAIT_TIMEOUT="${SSH_WAIT_TIMEOUT:-240}"
STACK_WAIT_TIMEOUT="${STACK_WAIT_TIMEOUT:-420}"

# Ensure the right hcloud context is active for every lifecycle command, whoever
# ran `hcloud context use` last.
hc() { hcloud --context "$HCLOUD_CONTEXT" "$@"; }

for tool in hcloud jq; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "ERROR: '$tool' is required (brew install hcloud jq)." >&2
    exit 1
  }
done
