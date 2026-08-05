#!/usr/bin/env bash
#
# validate.sh — end-to-end smoke of the golden VM WITHOUT needing model keys.
# Reverts the warm snapshot (per-run reset), then runs the guest agent-runner's
# --selftest over SSH and checks the structured report. Proves the whole real
# chain: virsh snapshot-revert -> SSH transport -> guest venv -> bounded runner.
#
#   ./virt/validate.sh        # expects a built golden VM (build-golden.sh)

set -euo pipefail

VM_NAME="${VM_NAME:-cuf-golden}"
SNAP="${SNAP:-golden-warm}"
HOST_SSH_PORT="${HOST_SSH_PORT:-10022}"
AGENT_USER="${AGENT_USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-cuf-agent-dev}"
LIBVIRT_URI="${LIBVIRT_URI:-qemu:///session}"
VIRSH="virsh -c ${LIBVIRT_URI}"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=6 -p ${HOST_SSH_PORT}"

echo "[validate] reverting warm snapshot ${SNAP} on ${VM_NAME}"
$VIRSH snapshot-revert "${VM_NAME}" "${SNAP}" --running

echo "[validate] waiting for guest SSH after revert"
for _ in $(seq 1 30); do
  sshpass -p "${AGENT_PASSWORD}" ssh ${SSH_OPTS} "${AGENT_USER}@127.0.0.1" true 2>/dev/null && break
  sleep 2
done

echo "[validate] running guest agent-runner --selftest"
REPORT=$(sshpass -p "${AGENT_PASSWORD}" ssh ${SSH_OPTS} "${AGENT_USER}@127.0.0.1" \
  '/opt/agent/venv/bin/python /opt/agent/agent-runner/cli.py --selftest')
echo "[validate] report: ${REPORT}"

echo "${REPORT}" | grep -q '"status": "succeeded"' \
  && echo "[validate] PASS — golden VM chain works end to end" \
  || { echo "[validate] FAIL — unexpected report"; exit 1; }
