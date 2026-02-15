#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-chopsticks-auto-update}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  SUDO="sudo"
fi

$SUDO systemctl disable --now "${SERVICE_NAME}.timer" >/dev/null 2>&1 || true
$SUDO systemctl disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true

$SUDO rm -f \
  "$SYSTEMD_DIR/${SERVICE_NAME}.service" \
  "$SYSTEMD_DIR/${SERVICE_NAME}.timer"

$SUDO systemctl daemon-reload

echo "Removed ${SERVICE_NAME} systemd units"
