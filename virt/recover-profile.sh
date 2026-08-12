#!/usr/bin/env bash
#
# recover-profile.sh — validate and recover a prepared profile fleet.
#
# For each VM in a generated fleet JSON:
#   1. verify the libvirt domain exists
#   2. verify the warm snapshot exists
#   3. revert to the warm snapshot and leave the VM running
#   4. wait for SSH
#   5. run the guest agent-runner selftest unless disabled
#
# With --repair, a missing snapshot is recreated from the current running VM.

set -euo pipefail

PROFILE=""
FLEET_JSON_FILE=""
AGENT_USER="${AGENT_USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-changeme}"
LIBVIRT_URI="${LIBVIRT_URI:-qemu:///session}"
SSH_KEY="${SSH_KEY:-}"
REPAIR=0
SKIP_SELFTEST=0
SSH_WAIT_ATTEMPTS="${SSH_WAIT_ATTEMPTS:-60}"
VIRSH="virsh -c ${LIBVIRT_URI}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${STATE_DIR:-${SCRIPT_DIR}/.state}"

log() { echo "[recover-profile] $*"; }
die() { echo "[recover-profile] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  AGENT_PASSWORD='...' ./virt/recover-profile.sh --profile bank
  AGENT_PASSWORD='...' ./virt/recover-profile.sh --fleet-json-file virt/.state/bank.fleet.json --repair

Options:
  --profile NAME       Profile name. Defaults fleet file to virt/.state/NAME.fleet.json.
  --fleet-json-file P  Fleet JSON file emitted by prepare-profile.sh.
  --repair             Start stopped domains and recreate missing warm snapshots.
  --skip-selftest      Only check libvirt revert + SSH, skip guest runner selftest.
  -h, --help           Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --fleet-json-file) FLEET_JSON_FILE="$2"; shift 2;;
    --repair) REPAIR=1; shift;;
    --skip-selftest) SKIP_SELFTEST=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "unknown arg: $1";;
  esac
done

if [ -z "${FLEET_JSON_FILE}" ] && [ -n "${PROFILE}" ]; then
  FLEET_JSON_FILE="${STATE_DIR}/${PROFILE}.fleet.json"
fi
[ -n "${FLEET_JSON_FILE}" ] || { usage; die "--profile or --fleet-json-file is required"; }
[ -f "${FLEET_JSON_FILE}" ] || die "fleet JSON file not found: ${FLEET_JSON_FILE}"

for bin in virsh python3 ssh; do
  command -v "${bin}" >/dev/null 2>&1 || die "missing tool: ${bin} (run ./virt/preflight.sh)"
done
if [ -z "${SSH_KEY}" ]; then
  command -v sshpass >/dev/null 2>&1 || die "missing tool: sshpass (or set SSH_KEY)"
fi

fleet_rows() {
  python3 - "${FLEET_JSON_FILE}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
if not isinstance(data, list):
    raise SystemExit("fleet JSON must be an array")
for vm in data:
    if not isinstance(vm, dict) or not vm.get("domain"):
        continue
    print(
        "\t".join(
            [
                str(vm["domain"]),
                str(vm.get("sshPort", 10022)),
                str(vm.get("snapshot", "golden-warm")),
                str(vm.get("user", "agent")),
            ]
        )
    )
PY
}

domain_running() { $VIRSH domstate "$1" 2>/dev/null | grep -q running; }
snapshot_exists() { $VIRSH snapshot-list "$1" --name 2>/dev/null | awk 'NF' | grep -Fxq "$2"; }

ssh_ok() {
  local port="$1"
  local user="$2"
  if [ -n "${SSH_KEY}" ]; then
    ssh -i "${SSH_KEY}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=4 -p "${port}" "${user}@127.0.0.1" true >/dev/null 2>&1
  else
    sshpass -p "${AGENT_PASSWORD}" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=4 -p "${port}" "${user}@127.0.0.1" true >/dev/null 2>&1
  fi
}

ssh_run() {
  local port="$1"
  local user="$2"
  local command="$3"
  if [ -n "${SSH_KEY}" ]; then
    ssh -i "${SSH_KEY}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 -p "${port}" "${user}@127.0.0.1" "${command}"
  else
    sshpass -p "${AGENT_PASSWORD}" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 -p "${port}" "${user}@127.0.0.1" "${command}"
  fi
}

wait_for_ssh() {
  local domain="$1"
  local port="$2"
  local user="$3"
  for _ in $(seq 1 "${SSH_WAIT_ATTEMPTS}"); do
    ssh_ok "${port}" "${user}" && return 0
    sleep 2
  done
  die "${domain}: SSH did not become reachable on 127.0.0.1:${port}"
}

checked=0
while IFS=$'\t' read -r domain ssh_port snapshot user; do
  [ -n "${domain}" ] || continue
  checked=$((checked + 1))
  log "${domain}: checking domain"
  $VIRSH dominfo "${domain}" >/dev/null 2>&1 || die "${domain}: domain not defined"

  if ! snapshot_exists "${domain}" "${snapshot}"; then
    if [ "${REPAIR}" -ne 1 ]; then
      die "${domain}: missing snapshot ${snapshot} (rerun with --repair to recreate from current state)"
    fi
    if ! domain_running "${domain}"; then
      log "${domain}: starting domain before snapshot repair"
      $VIRSH start "${domain}" >/dev/null
      wait_for_ssh "${domain}" "${ssh_port}" "${user}"
    fi
    log "${domain}: recreating missing snapshot ${snapshot}"
    $VIRSH snapshot-create-as "${domain}" \
      --name "${snapshot}" \
      --description "Recovered warm reset snapshot" \
      >/dev/null
  fi

  log "${domain}: reverting ${snapshot}"
  $VIRSH snapshot-revert "${domain}" "${snapshot}" --running >/dev/null
  wait_for_ssh "${domain}" "${ssh_port}" "${user}"

  if [ "${SKIP_SELFTEST}" -eq 0 ]; then
    log "${domain}: running guest selftest"
    report="$(ssh_run "${ssh_port}" "${user}" "/opt/agent/venv/bin/python /opt/agent/agent-runner/cli.py --selftest" 2>/dev/null)"
    echo "${report}" | grep -q '"status": "succeeded"' || die "${domain}: selftest failed: ${report}"
  fi
  log "${domain}: ok"
done < <(fleet_rows)

[ "${checked}" -gt 0 ] || die "no VMs found in ${FLEET_JSON_FILE}"
log "PASS — ${checked} VM(s) recovered from ${FLEET_JSON_FILE}"
