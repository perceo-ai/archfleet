#!/usr/bin/env bash
#
# profile-next.sh — print the next operational commands for a task profile.

set -euo pipefail

PROFILE=""
CLONES="${CLONES:-2}"
STATE_DIR="${STATE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.state}"

usage() {
  cat <<'EOF'
Usage:
  ./virt/profile-next.sh --profile bank [--clones 2]

Prints the prepare/update/recover/deploy commands for a task profile.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --clones) CLONES="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "[profile-next] ERROR: unknown arg: $1" >&2; exit 1;;
  esac
done

[ -n "${PROFILE}" ] || { usage; exit 1; }

cat <<EOF
Task profile: ${PROFILE}

1. Create or refresh the setup workflow in the app:
   POST /api/profile-setup {"profile":"${PROFILE}","task":"<describe task>","save":true}

2. First-time capture and clone:
   AGENT_PASSWORD='...' npm run vm:prepare-profile -- --profile ${PROFILE} --clones ${CLONES}

3. Verify recovery readiness:
   AGENT_PASSWORD='...' npm run vm:recover-profile -- --profile ${PROFILE}

4. When login/app/site state expires, update from the task golden:
   AGENT_PASSWORD='...' npm run vm:update-profile -- --profile ${PROFILE} --clones ${CLONES}
   AGENT_PASSWORD='...' npm run vm:recover-profile -- --profile ${PROFILE}

5. Docker .env.local path:
   CUF_FLEET_JSON_FILE=/keys/${PROFILE}.fleet.json

6. Host path written by profile scripts:
   ${STATE_DIR}/${PROFILE}.fleet.json
EOF
