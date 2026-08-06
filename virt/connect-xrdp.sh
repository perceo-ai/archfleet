#!/usr/bin/env bash
#
# connect-xrdp.sh — open an RDP session to a fleet VM for human takeover.
# Uses xfreerdp (install: apt/pacman "freerdp"/"freerdp2-x11").
#
#   AGENT_PASSWORD='...' ./virt/connect-xrdp.sh                 # defaults to the golden VM
#   HOST=127.0.0.1 PORT=13389 USER=agent ./virt/connect-xrdp.sh

set -euo pipefail
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-13389}"
USER="${USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-}"

command -v xfreerdp >/dev/null 2>&1 || { echo "xfreerdp not found — install freerdp" >&2; exit 1; }

echo "[xrdp] connecting to ${HOST}:${PORT} as ${USER}"
exec xfreerdp /v:"${HOST}:${PORT}" /u:"${USER}" \
  ${AGENT_PASSWORD:+/p:"${AGENT_PASSWORD}"} \
  /cert:ignore /dynamic-resolution +clipboard
