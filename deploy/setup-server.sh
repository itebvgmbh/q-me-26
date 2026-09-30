#!/bin/bash
# One-time setup of a fresh Hetzner Cloud server (Ubuntu 24.04), run as root.
set -euo pipefail

APP_DIR=/opt/q-me

apt-get update
apt-get install -y ca-certificates curl rsync ufw

# Docker Engine + Compose plugin from Docker's official repository
if ! command -v docker >/dev/null; then
	curl -fsSL https://get.docker.com | sh
fi

# Only SSH and HTTP(S) are reachable from outside
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

mkdir -p "$APP_DIR/secrets"
chmod 700 "$APP_DIR/secrets"

echo "Done. Next: put .env and secrets/firebase-service-account.json into $APP_DIR"
