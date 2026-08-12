#!/usr/bin/env bash
#
# update-profile.sh — regenerate a task profile fleet from its source golden VM.
#
# Use after you change the source profile VM: log in again, update Firefox/apps/
# site state, then run this wrapper. It intentionally passes --replace so existing
# clone domains/disks are rebuilt from the updated task golden.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  AGENT_PASSWORD='...' ./virt/update-profile.sh --profile bank --clones 2

This is a thin safe wrapper around prepare-profile.sh:
  - prompts you to update the source task golden over XRDP
  - captures the updated source state
  - replaces existing clone domains/disks
  - rewrites virt/.state/PROFILE.fleet.json and PROFILE.env

All prepare-profile.sh options are accepted.
EOF
}

for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0;;
  esac
done

exec "${SCRIPT_DIR}/prepare-profile.sh" --replace "$@"
