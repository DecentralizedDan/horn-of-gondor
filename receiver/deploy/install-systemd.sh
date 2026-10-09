#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="horn-of-gondor-receiver"
ENVIRONMENT_DIRECTORY="/etc/horn-of-gondor"
ENVIRONMENT_FILE="${ENVIRONMENT_DIRECTORY}/receiver.env"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

SERVICE_USER="${SUDO_USER:-}"
if [[ -z "${SERVICE_USER}" || "${SERVICE_USER}" == "root" ]]; then
  echo "Run this installer as the account that owns the receiver, using sudo." >&2
  exit 1
fi
SERVICE_GROUP="$(id -gn "${SERVICE_USER}")"

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RECEIVER_DIRECTORY="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
CONFIG_FILE="${RECEIVER_DIRECTORY}/config.json"
DATA_DIRECTORY="${RECEIVER_DIRECTORY}/data"
NODE_EXECUTABLE="$(command -v node || true)"

if [[ -z "${NODE_EXECUTABLE}" ]]; then
  echo "Node.js is not installed or is not available in PATH." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing receiver configuration: ${CONFIG_FILE}" >&2
  exit 1
fi

if [[ ! -d "${RECEIVER_DIRECTORY}/node_modules" ]]; then
  echo "Missing node_modules. Run npm ci in ${RECEIVER_DIRECTORY} first." >&2
  exit 1
fi

install -d -m 0700 "${ENVIRONMENT_DIRECTORY}"

if [[ ! -f "${ENVIRONMENT_FILE}" ]]; then
  read -r -s -p "Cloud upload token: " UPLOAD_TOKEN
  echo

  if [[ ! "${UPLOAD_TOKEN}" =~ ^[A-Za-z0-9._~-]{32,}$ ]]; then
    echo "The token must be at least 32 characters and contain no spaces." >&2
    exit 1
  fi

  printf 'HORN_OF_GONDOR_UPLOAD_TOKEN=%s\n' "${UPLOAD_TOKEN}" \
    > "${ENVIRONMENT_FILE}"
fi

chown root:root "${ENVIRONMENT_FILE}"
chmod 0600 "${ENVIRONMENT_FILE}"

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0700 \
  "${DATA_DIRECTORY}"

cat > "${UNIT_FILE}" <<EOF
[Unit]
Description=Horn of Gondor RTL-SDR receiver
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${RECEIVER_DIRECTORY}
Environment=NODE_ENV=production
EnvironmentFile=${ENVIRONMENT_FILE}
ExecStart=${NODE_EXECUTABLE} ${RECEIVER_DIRECTORY}/src/cli.js --config ${CONFIG_FILE}
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 "${UNIT_FILE}"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl --no-pager --full status "${SERVICE_NAME}.service"
