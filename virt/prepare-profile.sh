#!/usr/bin/env bash
#
# prepare-profile.sh — manually prepare a logged-in VM profile, then clone it.
#
# Flow:
#   1. Start a source VM and show its XRDP connection.
#   2. You log in manually, complete 2FA/captcha, install apps, open tabs, etc.
#   3. The script snapshots the source's live state.
#   4. Optionally shut down the source, copy its disk into N clone domains, start
#      each clone, and create each clone's warm reset snapshot for archfleet runs.
#
# A live RAM snapshot preserves the exact desktop for that domain. Clones preserve
# disk-backed login state (browser cookies, installed apps, config); after first
# boot, each clone gets its own warm RAM snapshot for fast per-run resets.

set -euo pipefail

SOURCE_DOMAIN="${SOURCE_DOMAIN:-cuf-golden}"
PROFILE=""
CLONES="${CLONES:-1}"
DOMAIN_PREFIX=""
BASE_SSH_PORT="${BASE_SSH_PORT:-11022}"
BASE_RDP_PORT="${BASE_RDP_PORT:-14389}"
SOURCE_SSH_PORT="${SOURCE_SSH_PORT:-10022}"
SOURCE_RDP_PORT="${SOURCE_RDP_PORT:-13389}"
AGENT_USER="${AGENT_USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-changeme}"
LIBVIRT_URI="${LIBVIRT_URI:-qemu:///session}"
SNAPSHOT_NAME="${SNAPSHOT_NAME:-golden-warm}"
PROFILE_SNAPSHOT=""
FLEET_JSON_FILE=""
ENV_SNIPPET_FILE=""
ASSUME_READY=0
REPLACE=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="${IMAGES_DIR:-${SCRIPT_DIR}/images}"
STATE_DIR="${STATE_DIR:-${SCRIPT_DIR}/.state}"
VIRSH="virsh -c ${LIBVIRT_URI}"

log() { echo "[prepare-profile] $*"; }
die() { echo "[prepare-profile] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  AGENT_PASSWORD='...' ./virt/prepare-profile.sh --profile bank --clones 2

Options:
  --profile NAME       Required profile name. Used for labels: profile:NAME.
  --source DOMAIN      Source domain to prepare. Default: cuf-golden.
  --clones N           Clone count. Use 0 to only snapshot the source. Default: 1.
  --domain-prefix PFX  Clone domain prefix. Default: cuf-PROFILE.
  --base-ssh-port N    First clone SSH host port. Default: 11022.
  --base-rdp-port N    First clone XRDP host port. Default: 14389.
  --source-ssh-port N  Source SSH host port to print for --clones 0. Default: 10022.
  --source-rdp-port N  Source XRDP host port to show. Default: 13389.
  --snapshot NAME      Per-clone warm snapshot name. Default: golden-warm.
  --fleet-json-file P  Output fleet JSON path. Default: virt/.state/PROFILE.fleet.json.
  --assume-ready       Do not pause for interactive confirmation.
  --replace            Destroy/undefine existing clone domains and overwrite disks.
  -h, --help           Show this help.

Output:
  Writes fleet JSON + env snippet under virt/.state and prints the paths.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --source) SOURCE_DOMAIN="$2"; shift 2;;
    --clones) CLONES="$2"; shift 2;;
    --domain-prefix) DOMAIN_PREFIX="$2"; shift 2;;
    --base-ssh-port) BASE_SSH_PORT="$2"; shift 2;;
    --base-rdp-port) BASE_RDP_PORT="$2"; shift 2;;
    --source-ssh-port) SOURCE_SSH_PORT="$2"; shift 2;;
    --source-rdp-port) SOURCE_RDP_PORT="$2"; shift 2;;
    --snapshot) SNAPSHOT_NAME="$2"; shift 2;;
    --fleet-json-file) FLEET_JSON_FILE="$2"; shift 2;;
    --assume-ready) ASSUME_READY=1; shift;;
    --replace) REPLACE=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "unknown arg: $1";;
  esac
done

[ -n "${PROFILE}" ] || { usage; die "--profile is required"; }
[[ "${PROFILE}" =~ ^[A-Za-z0-9._-]+$ ]] || die "--profile may only contain letters, numbers, dot, underscore, and dash"
[[ "${CLONES}" =~ ^[0-9]+$ ]] || die "--clones must be a non-negative integer"
[[ "${BASE_SSH_PORT}" =~ ^[0-9]+$ ]] || die "--base-ssh-port must be an integer"
[[ "${BASE_RDP_PORT}" =~ ^[0-9]+$ ]] || die "--base-rdp-port must be an integer"
[[ "${SOURCE_SSH_PORT}" =~ ^[0-9]+$ ]] || die "--source-ssh-port must be an integer"

DOMAIN_PREFIX="${DOMAIN_PREFIX:-cuf-${PROFILE}}"
PROFILE_SNAPSHOT="${PROFILE_SNAPSHOT:-profile-${PROFILE}-manual}"
FLEET_JSON_FILE="${FLEET_JSON_FILE:-${STATE_DIR}/${PROFILE}.fleet.json}"
ENV_SNIPPET_FILE="${STATE_DIR}/${PROFILE}.env"

for bin in virsh qemu-img python3 ssh sshpass; do
  command -v "$bin" >/dev/null 2>&1 || die "missing tool: $bin (run ./virt/preflight.sh)"
done

domain_exists() { $VIRSH dominfo "$1" >/dev/null 2>&1; }
domain_running() { $VIRSH domstate "$1" 2>/dev/null | grep -q running; }

source_disk() {
  $VIRSH domblklist --details "${SOURCE_DOMAIN}" |
    awk '$2 == "disk" && ($3 == "vda" || $3 == "sda") { print $4; exit }'
}

wait_for_ssh() {
  local port="$1"
  local label="$2"
  log "waiting for ${label} SSH on 127.0.0.1:${port}"
  for _ in $(seq 1 60); do
    sshpass -p "${AGENT_PASSWORD}" ssh \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=4 \
      -p "${port}" \
      "${AGENT_USER}@127.0.0.1" true >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "${label} SSH did not become reachable on port ${port}"
}

shutdown_domain() {
  local domain="$1"
  log "shutting down ${domain} so its disk can be cloned consistently"
  $VIRSH shutdown "${domain}" >/dev/null 2>&1 || true
  for _ in $(seq 1 45); do
    domain_running "${domain}" || return 0
    sleep 2
  done
  log "${domain} did not shut down cleanly; destroying it before disk copy"
  $VIRSH destroy "${domain}" >/dev/null 2>&1 || true
}

define_clone() {
  local domain="$1"
  local disk="$2"
  local ssh_port="$3"
  local rdp_port="$4"
  local source_xml xml
  source_xml="$(mktemp)"
  xml="$(mktemp)"
  $VIRSH dumpxml --inactive "${SOURCE_DOMAIN}" > "${source_xml}"
  python3 "${SCRIPT_DIR}/clone-domain-xml.py" "${source_xml}" "${xml}" "${domain}" "${disk}" "${ssh_port}" "${rdp_port}"
  $VIRSH define "${xml}" >/dev/null || { rm -f "${source_xml}" "${xml}"; die "virsh define failed for ${domain}"; }
  rm -f "${source_xml}" "${xml}"
}

if ! domain_exists "${SOURCE_DOMAIN}"; then
  die "source domain ${SOURCE_DOMAIN} does not exist; build it with ./virt/build-golden.sh first"
fi

if ! domain_running "${SOURCE_DOMAIN}"; then
  log "starting source domain ${SOURCE_DOMAIN}"
  $VIRSH start "${SOURCE_DOMAIN}" >/dev/null
fi

cat <<EOF

Manual profile setup: ${PROFILE}
  Source VM : ${SOURCE_DOMAIN}
  XRDP      : 127.0.0.1:${SOURCE_RDP_PORT}
  User      : ${AGENT_USER}

Log in to the VM now, complete 2FA/captcha, install apps, open required tabs,
and leave the desktop exactly how future runs should start.
EOF

if [ "${ASSUME_READY}" -eq 0 ]; then
  read -r -p "Press Enter when the VM is ready to capture... " _
fi

log "capturing live source snapshot ${PROFILE_SNAPSHOT}"
$VIRSH snapshot-delete "${SOURCE_DOMAIN}" "${PROFILE_SNAPSHOT}" >/dev/null 2>&1 || true
$VIRSH snapshot-create-as "${SOURCE_DOMAIN}" \
  --name "${PROFILE_SNAPSHOT}" \
  --description "Manual profile ${PROFILE}: logged-in operator-prepared state" \
  >/dev/null

if [ "${CLONES}" -eq 0 ]; then
  json="[{\"domain\":\"${SOURCE_DOMAIN}\",\"sshPort\":${SOURCE_SSH_PORT},\"rdpPort\":${SOURCE_RDP_PORT},\"snapshot\":\"${PROFILE_SNAPSHOT}\",\"profile\":\"${PROFILE}\"}]"
  mkdir -p "$(dirname "${FLEET_JSON_FILE}")" "${STATE_DIR}"
  printf '%s\n' "${json}" > "${FLEET_JSON_FILE}"
  printf 'CUF_FLEET_JSON_FILE=%s\n' "${FLEET_JSON_FILE}" > "${ENV_SNIPPET_FILE}"
  cat <<EOF

Source profile snapshot ready.
Use this single-domain fleet binding:
  CUF_FLEET_JSON_FILE=${FLEET_JSON_FILE}

Env snippet written:
  ${ENV_SNIPPET_FILE}
EOF
  exit 0
fi

disk="$(source_disk)"
[ -n "${disk}" ] && [ -f "${disk}" ] || die "could not find source disk for ${SOURCE_DOMAIN}"

shutdown_domain "${SOURCE_DOMAIN}"
mkdir -p "${IMAGES_DIR}" "${STATE_DIR}"

json="["
for i in $(seq 1 "${CLONES}"); do
  domain="${DOMAIN_PREFIX}-${i}"
  clone_disk="${IMAGES_DIR}/${domain}.qcow2"
  ssh_port=$((BASE_SSH_PORT + i - 1))
  rdp_port=$((BASE_RDP_PORT + i - 1))

  if domain_exists "${domain}"; then
    [ "${REPLACE}" -eq 1 ] || die "${domain} already exists; rerun with --replace to overwrite it"
    $VIRSH destroy "${domain}" >/dev/null 2>&1 || true
    $VIRSH undefine "${domain}" --nvram >/dev/null 2>&1 || true
  fi
  if [ -f "${clone_disk}" ]; then
    [ "${REPLACE}" -eq 1 ] || die "${clone_disk} already exists; rerun with --replace to overwrite it"
    rm -f "${clone_disk}"
  fi

  log "copying ${SOURCE_DOMAIN} disk to ${clone_disk}"
  qemu-img convert -O qcow2 "${disk}" "${clone_disk}"
  define_clone "${domain}" "${clone_disk}" "${ssh_port}" "${rdp_port}"
  log "starting ${domain}"
  $VIRSH start "${domain}" >/dev/null
  wait_for_ssh "${ssh_port}" "${domain}"
  log "creating ${domain} warm snapshot ${SNAPSHOT_NAME}"
  $VIRSH snapshot-delete "${domain}" "${SNAPSHOT_NAME}" >/dev/null 2>&1 || true
  $VIRSH snapshot-create-as "${domain}" \
    --name "${SNAPSHOT_NAME}" \
    --description "Warm reset for manual profile ${PROFILE}" \
    >/dev/null

  [ "${i}" -gt 1 ] && json="${json},"
  json="${json}{\"domain\":\"${domain}\",\"sshPort\":${ssh_port},\"rdpPort\":${rdp_port},\"snapshot\":\"${SNAPSHOT_NAME}\",\"profile\":\"${PROFILE}\"}"
done
json="${json}]"
printf '%s\n' "${json}" > "${FLEET_JSON_FILE}"
printf 'CUF_FLEET_JSON_FILE=%s\n' "${FLEET_JSON_FILE}" > "${ENV_SNIPPET_FILE}"

cat <<EOF

Profile clone fleet ready.
Add this to .env.local:
  CUF_FLEET_JSON_FILE=${FLEET_JSON_FILE}

Fleet JSON written:
  ${FLEET_JSON_FILE}

Env snippet written:
  ${ENV_SNIPPET_FILE}

Target these VMs from workflows with requiredLabels:
  profile:${PROFILE}
EOF
