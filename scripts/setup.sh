#!/usr/bin/env bash
# One-time host setup for a fresh Ubuntu server (run as root or with sudo).
# Installs Docker + the Compose plugin and locks the firewall to 22/80/443.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

echo "[setup] Installing Docker Engine + Compose plugin…"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker --version
docker compose version

# Optional: let a non-root deploy user run docker without sudo.
if [ -n "${DEPLOY_USER:-}" ]; then
  usermod -aG docker "$DEPLOY_USER"
  echo "[setup] Added $DEPLOY_USER to the docker group (re-login required)."
fi

echo "[setup] Configuring UFW firewall (allow only 22/80/443)…"
if ! command -v ufw >/dev/null 2>&1; then
  apt-get update && apt-get install -y ufw
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "[setup] Done."
