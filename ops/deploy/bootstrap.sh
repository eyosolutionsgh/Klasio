#!/usr/bin/env bash
# Prepare a fresh Hetzner (Ubuntu 24.04) box to host the Klasio pre-live stack.
#
# Run once, as root, on the new server:
#   scp ops/deploy/bootstrap.sh root@<ip>:/tmp/ && ssh root@<ip> bash /tmp/bootstrap.sh
#
# Idempotent — safe to re-run. It does NOT register the GitHub Actions runner (that needs a
# short-lived token from the repository) and does NOT write .env or any key material. Those steps
# are in ops/deploy/README.md and are deliberately manual.
set -euo pipefail

DEPLOY_USER=deploy
DEPLOY_DIR=/opt/klasio

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

log "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync ufw unattended-upgrades

log "Swap"
# A CX23 is 4 GB and this box builds two Next.js apps. The deploy workflow already builds
# sequentially so the peak fits, but swap is the backstop that turns a bad day into a slow
# build rather than an OOM-killed container mid-deploy.
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer RAM; swap is for build peaks, not steady state.
  sysctl -qw vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  echo "swapfile already present"
fi

log "Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "docker already installed"
fi
systemctl enable --now docker

log "Docker log rotation"
# Without this a chatty container fills the 40 GB disk with JSON logs and takes the database
# down with it — the classic way a small box dies.
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi

log "Deploy user"
# The GitHub Actions runner refuses to run as root, and should not. It gets docker group
# membership, which is root-equivalent on this box — acceptable because the runner's whole job is
# to build and restart containers, and the fork guard in the workflow is what keeps untrusted
# code away from it.
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

# Give it the same keys root was reached with. Without this the account exists but nothing can
# log into it — the password is disabled by design — and every `ssh deploy@<ip>` step in the
# README fails at a point where the only way back in is as root.
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
    /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
else
  echo "WARNING: /root/.ssh/authorized_keys is absent — $DEPLOY_USER will have no way in." >&2
fi

log "Deploy directories"
mkdir -p "$DEPLOY_DIR"/{repo,licence,vendor-keys}
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_DIR"
# The signing key lives here. Only the deploy user reads it, and it is never group- or
# world-readable — the compose mount is :ro but the file permission is the real control.
chmod 700 "$DEPLOY_DIR/vendor-keys"

log "Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
# Postgres, Redis and all three apps are deliberately absent: nothing but Caddy is published to
# the host, so there is no port to open.

log "Unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

cat <<EOF

Done. Still to do by hand — see ops/deploy/README.md:
  1. Point WEB/API/VENDOR domains at this server's IP (A records).
  2. Write $DEPLOY_DIR/.env      (from ops/deploy/.env.example)
  3. Place $DEPLOY_DIR/vendor-keys/signing-key.pem, chmod 400, owned by $DEPLOY_USER
  4. Install the GitHub Actions runner as $DEPLOY_USER with labels: self-hosted,klasio-prelive
  5. Push to main (or run the workflow by hand) to deploy.
EOF
