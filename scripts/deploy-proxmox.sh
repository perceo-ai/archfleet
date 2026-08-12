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

if [[ -z "${PROXMOX_PASSWORD:-}" ]]; then
  cat >&2 <<MSG
Missing PROXMOX_PASSWORD.

Set it in the environment or create this local gitignored file:
  $LOCAL_ENV

Example:
  PROXMOX_PASSWORD=...
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

if [[ -z "$BRANCH" ]]; then
  echo "Could not determine the current branch. Set DEPLOY_BRANCH explicitly." >&2
  exit 2
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit or stash before deploying." >&2
  git status --short >&2
  exit 2
fi

if [[ "$DEPLOY_PUSH" == "1" ]]; then
  echo "Pushing $BRANCH..."
  git push origin "$BRANCH"
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

echo "Deploying $BRANCH@$COMMIT to $PROXMOX_HOST VM $PROXMOX_VMID..."
guest_exec_script 0 "$DEPLOY_CMD"

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

echo "Verifying containers and internal health..."
guest_exec_script 120 "$VERIFY_CMD"

echo "Verifying public routes..."
if curl -sS -o /tmp/archfleet-login.html -w 'login_http=%{http_code}\n' "https://$PUBLIC_HOST/login" &&
   curl -sS -o /tmp/archfleet-guac.html -w 'guac_http=%{http_code}\n' "https://$PUBLIC_HOST/guacamole/"; then
  echo "Public verification complete."
else
  EDGE_IP="$(dig +short "$PUBLIC_HOST" @1.1.1.1 | head -n 1 || true)"
  if [[ -z "$EDGE_IP" ]]; then
    echo "Public verification failed and no Cloudflare edge IP resolved for $PUBLIC_HOST." >&2
    exit 1
  fi
  curl --resolve "$PUBLIC_HOST:443:$EDGE_IP" -sS -o /tmp/archfleet-login.html -w 'login_http=%{http_code}\n' "https://$PUBLIC_HOST/login"
  curl --resolve "$PUBLIC_HOST:443:$EDGE_IP" -sS -o /tmp/archfleet-guac.html -w 'guac_http=%{http_code}\n' "https://$PUBLIC_HOST/guacamole/"
  echo "Public verification complete via $EDGE_IP."
fi
