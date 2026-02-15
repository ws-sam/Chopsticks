#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-chopsticks-auto-update}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
RUN_USER="${RUN_USER:-$(id -un)}"
RUN_GROUP="${RUN_GROUP:-$(id -gn)}"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-dashboard,monitoring,fun}"
UPDATE_INTERVAL="${UPDATE_INTERVAL:-15min}"

SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  SUDO="sudo"
fi

service_unit="$SYSTEMD_DIR/${SERVICE_NAME}.service"
timer_unit="$SYSTEMD_DIR/${SERVICE_NAME}.timer"

echo "[install] writing $service_unit"
$SUDO tee "$service_unit" >/dev/null <<UNIT
[Unit]
Description=Chopsticks auto-update runner
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$ROOT_DIR
Environment=COMPOSE_PROFILES=$COMPOSE_PROFILES
Environment=AUTO_UPDATE_REMOTE=private
Environment=AUTO_UPDATE_BRANCH=main
Environment=AUTO_UPDATE_RUN_GATES=true
ExecStart=/usr/bin/env bash -lc 'cd $ROOT_DIR && ./scripts/ops/chopsticks-auto-update.sh'
UNIT

echo "[install] writing $timer_unit"
$SUDO tee "$timer_unit" >/dev/null <<UNIT
[Unit]
Description=Run Chopsticks auto-update on schedule

[Timer]
OnBootSec=5min
OnUnitActiveSec=$UPDATE_INTERVAL
AccuracySec=1min
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
UNIT

echo "[install] reloading systemd"
$SUDO systemctl daemon-reload

echo "[install] enabling ${SERVICE_NAME}.timer"
$SUDO systemctl enable --now "${SERVICE_NAME}.timer"

echo "[install] complete"
echo "[install] timer status: systemctl status ${SERVICE_NAME}.timer --no-pager"
echo "[install] service logs: journalctl -u ${SERVICE_NAME}.service -n 100 --no-pager"
