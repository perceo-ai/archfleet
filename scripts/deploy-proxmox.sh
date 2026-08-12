#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV="$ROOT_DIR/.context/proxmox.env"

if [[ -f "$LOCAL_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$LOCAL_ENV"
fi

PROXMOX_HOST="${PROXMOX_HOST:-jigserver}"
PROXMOX_USER="${PROXMOX_USER:-root}"
PROXMOX_VMID="${PROXMOX_VMID:-104}"
REMOTE_DIR="${REMOTE_DIR:-/opt/perceo/archfleet}"
PUBLIC_HOST="${PUBLIC_HOST:-archfleet.madebypranav.dev}"
DEPLOY_PUSH="${DEPLOY_PUSH:-1}"
KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-archfleet-proxmox}"
KEYCHAIN_ACCOUNT="${KEYCHAIN_ACCOUNT:-$PROXMOX_USER@$PROXMOX_HOST}"

if [[ -z "${PROXMOX_PASSWORD:-}" ]] && command -v security >/dev/null 2>&1; then
  PROXMOX_PASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
fi

if [[ -z "${PROXMOX_PASSWORD:-}" ]]; then
  cat >&2 <<MSG
Missing PROXMOX_PASSWORD.

Set it in the environment, create this local gitignored file:
  $LOCAL_ENV

Example:
  PROXMOX_PASSWORD=...

Or seed the macOS Keychain once:
  security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w '...'
MSG
  exit 2
fi

if ! command -v expect >/dev/null 2>&1; then
  echo "Missing 'expect'. Install it or run this script from the Mac where expect is available." >&2
  exit 2
fi

cd "$ROOT_DIR"

BRANCH="${DEPLOY_BRANCH:-$(git branch --show-current)}"
COMMIT="$(git rev-parse --short HEAD)"

hr() {
  printf '\n== %s ==\n' "$1"
}

info() {
  printf '[info] %s\n' "$1"
}

ok() {
  printf '[ok] %s\n' "$1"
}

fail() {
  printf '[fail] %s\n' "$1" >&2
}

if [[ -z "$BRANCH" ]]; then
  fail "Could not determine the current branch. Set DEPLOY_BRANCH explicitly."
  exit 2
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Working tree has uncommitted changes. Commit or stash before deploying."
  git status --short >&2
  exit 2
fi

if [[ "$DEPLOY_PUSH" == "1" ]]; then
  hr "Push"
  info "Pushing $BRANCH to origin"
  git push origin "$BRANCH"
  ok "Branch is pushed"
fi

ssh_proxmox() {
  local remote_command="$1"
  local expect_script
  expect_script="$(mktemp)"
  cat >"$expect_script" <<'EXPECT'
    set timeout -1
    set password $env(PROXMOX_PASSWORD)
    set host $env(PROXMOX_HOST)
    set user $env(PROXMOX_USER)
    set remote_command $env(PROXMOX_REMOTE_COMMAND)
    spawn ssh -o StrictHostKeyChecking=accept-new "$user@$host" $remote_command
    expect {
      -re "(?i)password:" {
        send "$password\r"
        exp_continue
      }
      eof
    }
    set result [wait]
    exit [lindex $result 3]
EXPECT
  PROXMOX_REMOTE_COMMAND="$remote_command" expect "$expect_script"
  local status=$?
  rm -f "$expect_script"
  return "$status"
}

export PROXMOX_HOST PROXMOX_USER PROXMOX_PASSWORD

print_guest_result() {
  python3 -c '
import json
import sys

raw = sys.stdin.read()
start = raw.find("{")
end = raw.rfind("}")
if start < 0 or end < start:
    print(raw.rstrip())
    sys.exit(0)

try:
    payload = json.loads(raw[start:end + 1])
except json.JSONDecodeError:
    print(raw.rstrip())
    sys.exit(0)

out = payload.get("out-data") or ""
err = payload.get("err-data") or ""
if out:
    print(out.rstrip())
if err:
    print("[remote stderr]")
    print(err.rstrip())
code = payload.get("exitcode", 0)
if code:
    sys.exit(int(code))
'
}

COMPOSE_FILES="-f deploy/home-server.compose.yml -f deploy/guacamole.compose.yml"
DEPLOY_CMD=$(cat <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git rev-parse --short HEAD
docker compose -p deploy --env-file .env.local $COMPOSE_FILES up -d --build
docker compose -p deploy --env-file .env.local $COMPOSE_FILES ps
EOF
)

guest_exec_script() {
  local timeout="$1"
  local script="$2"
  local encoded
  encoded="$(printf '%s' "$script" | base64 | tr -d '\n')"
  ssh_proxmox "qm guest exec $PROXMOX_VMID --timeout $timeout -- bash -lc 'printf %s $encoded | base64 -d | bash'"
}

hr "Deploy"
info "Target: $PROXMOX_HOST VM $PROXMOX_VMID"
info "Branch: $BRANCH"
info "Commit: $COMMIT"
guest_exec_script 0 "$DEPLOY_CMD" | print_guest_result
ok "Remote compose deployment completed"

VERIFY_CMD=$(cat <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
printf 'commit='
git rev-parse --short HEAD
for i in {1..30}; do
  container_health=\$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' deploy-archfleet-1 2>/dev/null || true)
  if [ "\$container_health" = "healthy" ]; then
    break
  fi
  sleep 2
done
printf 'archfleet_container_health=%s\n' "\$container_health"
if [ "\$container_health" != "healthy" ]; then
  docker inspect -f '{{json .State.Health}}' deploy-archfleet-1 || true
  exit 1
fi
docker compose -p deploy --env-file .env.local $COMPOSE_FILES ps --status running
set -a
. ./.env.local
set +a
code=\$(curl -sS -o /tmp/archfleet-health.json -w '%{http_code}' -H "Authorization: Bearer \$CUF_AUTH_TOKEN" http://127.0.0.1:3000/api/health)
printf 'health_http=%s\n' "\$code"
cat /tmp/archfleet-health.json
EOF
)

hr "Verify VM"
guest_exec_script 120 "$VERIFY_CMD" | print_guest_result
ok "Internal health check passed"

hr "Verify Public Routes"
if curl -sS -o /tmp/archfleet-login.html -w 'login_http=%{http_code}\n' "https://$PUBLIC_HOST/login" &&
   curl -sS -o /tmp/archfleet-guac.html -w 'guac_http=%{http_code}\n' "https://$PUBLIC_HOST/guacamole/"; then
  ok "Public verification complete"
else
  EDGE_IP="$(dig +short "$PUBLIC_HOST" @1.1.1.1 | head -n 1 || true)"
  if [[ -z "$EDGE_IP" ]]; then
    fail "Public verification failed and no Cloudflare edge IP resolved for $PUBLIC_HOST."
    exit 1
  fi
  curl --resolve "$PUBLIC_HOST:443:$EDGE_IP" -sS -o /tmp/archfleet-login.html -w 'login_http=%{http_code}\n' "https://$PUBLIC_HOST/login"
  curl --resolve "$PUBLIC_HOST:443:$EDGE_IP" -sS -o /tmp/archfleet-guac.html -w 'guac_http=%{http_code}\n' "https://$PUBLIC_HOST/guacamole/"
  ok "Public verification complete via $EDGE_IP"
fi

hr "Done"
ok "Deployed $BRANCH@$COMMIT"
