#!/usr/bin/env bash
#
# check.sh — probe a UI-TARS grounding endpoint. Exit 0 if the served model is up.
#   ./check.sh                       # checks http://127.0.0.1:8080
#   BASE_URL=http://gpu-host:8080 ./check.sh

set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

echo "[ui-tars] GET ${BASE_URL}/v1/models"
if curl -fsS --max-time 5 "${BASE_URL}/v1/models"; then
  echo
  echo "[ui-tars] OK"
else
  echo "[ui-tars] UNREACHABLE at ${BASE_URL}" >&2
  exit 1
fi
