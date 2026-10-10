#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="horn-of-gondor-receiver.service"

if [[ "${EUID}" -eq 0 ]]; then
  SYSTEMCTL=(systemctl)
else
  SYSTEMCTL=(sudo systemctl)
fi

if ! "${SYSTEMCTL[@]}" cat "${SERVICE_NAME}" >/dev/null 2>&1; then
  echo "${SERVICE_NAME} is not installed." >&2
  echo "Run sudo bash deploy/install-systemd.sh first." >&2
  exit 1
fi

echo "Restarting ${SERVICE_NAME}..."
if ! "${SYSTEMCTL[@]}" restart "${SERVICE_NAME}"; then
  "${SYSTEMCTL[@]}" --no-pager --full status "${SERVICE_NAME}" || true
  exit 1
fi

"${SYSTEMCTL[@]}" --no-pager --full status "${SERVICE_NAME}"
