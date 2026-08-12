#!/usr/bin/env bash
#
# build-golden.sh — staged, resumable builder for the golden warm-snapshot VM.
#
# Stages (run in order; each stamps virt/.state/<stage>.done on success):
#   disk       fetch base cloud image + create the golden qcow2
#   prep       OFFLINE virt-customize: agent user + sudo, ssh keys/auth, netplan,
#              copy provision.sh + agent-runner in  (network-free)
#   boot       define + start the domain (virsh XML, user-net hostfwd)
#   provision  run provision.sh over SSH as root — LIVE output, re-runnable
#   snapshot   warm memory snapshot 'golden-warm' (per-run reset target)
#   validate   guest agent-runner --selftest over SSH
#
# Reruns skip already-stamped stages, so fixing provision.sh + rerunning only
# repeats `provision` onward against the still-booted VM — no full rebuild.
#
# Usage:
#   AGENT_PASSWORD='...' ./virt/build-golden.sh                 # run all, resume
#   AGENT_PASSWORD='...' ./virt/build-golden.sh --from provision# rerun from a stage
#   AGENT_PASSWORD='...' ./virt/build-golden.sh --only provision# run one stage
#   ./virt/build-golden.sh --clean                              # wipe state + VM + disk

set -uo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
UBUNTU_RELEASE="${UBUNTU_RELEASE:-noble}"
CLOUD_IMG_URL="${CLOUD_IMG_URL:-https://cloud-images.ubuntu.com/${UBUNTU_RELEASE}/current/${UBUNTU_RELEASE}-server-cloudimg-amd64.img}"
VM_NAME="${VM_NAME:-cuf-golden}"
DISK_SIZE="${DISK_SIZE:-25G}"
RAM_MB="${RAM_MB:-4096}"
VCPUS="${VCPUS:-2}"
HOST_SSH_PORT="${HOST_SSH_PORT:-10022}"
HOST_RDP_PORT="${HOST_RDP_PORT:-13389}"
HOST_BIND="${HOST_BIND:-127.0.0.1}"
AGENT_USER="${AGENT_USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-changeme}"
GUI_AGENTS_VERSION="${GUI_AGENTS_VERSION:-0.3.2}"
LIBVIRT_URI="${LIBVIRT_URI:-qemu:///session}"
PROVISION_WAIT_S="${PROVISION_WAIT_S:-2400}"
VIRSH="virsh -c ${LIBVIRT_URI}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${CACHE_DIR:-${SCRIPT_DIR}/.cache}"
IMAGES_DIR="${IMAGES_DIR:-${SCRIPT_DIR}/images}"
STATE_DIR="${STATE_DIR:-${SCRIPT_DIR}/.state}"
BASE_IMG="${CACHE_DIR}/${UBUNTU_RELEASE}-base.img"
GOLDEN_IMG="${IMAGES_DIR}/${VM_NAME}.qcow2"

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=6 -p ${HOST_SSH_PORT}"
SSH="sshpass -p ${AGENT_PASSWORD} ssh ${SSH_OPTS} ${AGENT_USER}@127.0.0.1"

log()  { echo "[build-golden] $*"; }
die()  { echo "[build-golden] ERROR: $*" >&2; exit 1; }
stamp(){ mkdir -p "${STATE_DIR}"; touch "${STATE_DIR}/$1.done"; }
done_() { [ -f "${STATE_DIR}/$1.done" ]; }

ALL_STAGES=(disk prep boot provision snapshot validate)

# ---------------------------------------------------------------------------
# Stage implementations
# ---------------------------------------------------------------------------
stage_disk() {
  for bin in virsh virt-customize qemu-img wget ssh sshpass; do
    command -v "$bin" >/dev/null 2>&1 || die "missing tool: $bin (run ./virt/preflight.sh)"
  done
  mkdir -p "${CACHE_DIR}" "${IMAGES_DIR}"
  if [ ! -f "${BASE_IMG}" ]; then
    log "downloading Ubuntu ${UBUNTU_RELEASE} cloud image"
    wget -q --show-progress -O "${BASE_IMG}.part" "${CLOUD_IMG_URL}" || die "download failed"
    mv "${BASE_IMG}.part" "${BASE_IMG}"
  else
    log "base image cached"
  fi
  log "creating golden disk (${DISK_SIZE})"
  rm -f "${GOLDEN_IMG}"
  qemu-img convert -O qcow2 "${BASE_IMG}" "${GOLDEN_IMG}" || die "qemu-img convert failed"
  qemu-img resize "${GOLDEN_IMG}" "${DISK_SIZE}" || die "qemu-img resize failed"
}

SSH_KEY="${SSH_KEY:-${STATE_DIR}/cuf_id}"

stage_prep() {
  [ -f "${GOLDEN_IMG}" ] || die "golden disk missing — run the 'disk' stage first"
  log "offline prep (agent user + sudo, ssh keys/auth, netplan, copy runner)"

  # Controller keypair for the app's key-based SSH transport (set CUF_SSH_KEY to it).
  mkdir -p "${STATE_DIR}"
  [ -f "${SSH_KEY}" ] || ssh-keygen -q -t ed25519 -N "" -C cuf-controller -f "${SSH_KEY}"

  local netplan firstuser
  netplan="$(mktemp)"
  cat > "${netplan}" <<'YAML'
network:
  version: 2
  renderer: networkd
  ethernets:
    cufnet:
      match:
        name: "e*"
      dhcp4: true
YAML

  virt-customize -a "${GOLDEN_IMG}" \
    --run-command "growpart /dev/sda 1 || true" \
    --run-command "resize2fs /dev/sda1 || true" \
    --run-command "touch /etc/cloud/cloud-init.disabled" \
    --run-command "id ${AGENT_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${AGENT_USER}" \
    --password "${AGENT_USER}:password:${AGENT_PASSWORD}" \
    --run-command "usermod -aG sudo ${AGENT_USER}; echo '${AGENT_USER} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-cuf; chmod 440 /etc/sudoers.d/90-cuf" \
    --upload "${netplan}:/etc/netplan/99-cuf.yaml" \
    --run-command "chmod 600 /etc/netplan/99-cuf.yaml" \
    --run-command "mkdir -p /etc/ssh/sshd_config.d && printf 'PasswordAuthentication yes\nKbdInteractiveAuthentication yes\n' > /etc/ssh/sshd_config.d/10-cuf.conf" \
    --run-command "ssh-keygen -A" \
    --ssh-inject "${AGENT_USER}:file:${SSH_KEY}.pub" \
    --run-command "systemctl disable --now ssh.socket 2>/dev/null || true; systemctl enable ssh || true" \
    --copy-in "${SCRIPT_DIR}/provision.sh:/opt" \
    --mkdir "/opt/agent" \
    --copy-in "${SCRIPT_DIR}/agent-runner:/opt/agent" \
    --run-command "rm -rf /opt/agent/agent-runner/__pycache__" \
    --run-command "systemctl set-default graphical.target" \
    || { rm -f "${netplan}"; die "virt-customize prep failed"; }
  rm -f "${netplan}"
}

domain_running() { $VIRSH domstate "${VM_NAME}" 2>/dev/null | grep -q running; }

stage_boot() {
  # Always recreate from the CURRENT disk — never reuse a possibly-stale running
  # domain (that caused old images to be booted instead of the freshly prepped one).
  if $VIRSH dominfo "${VM_NAME}" >/dev/null 2>&1; then
    $VIRSH destroy "${VM_NAME}" >/dev/null 2>&1 || true
    $VIRSH undefine "${VM_NAME}" --nvram >/dev/null 2>&1 || true
  fi
  local qemu_bin xml
  qemu_bin="$(command -v qemu-system-x86_64)"
  xml="$(mktemp)"
  cat > "${xml}" <<XML
<domain type='kvm' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>
  <name>${VM_NAME}</name>
  <memory unit='MiB'>${RAM_MB}</memory>
  <vcpu>${VCPUS}</vcpu>
  <os><type arch='x86_64' machine='pc'>hvm</type><boot dev='hd'/></os>
  <features><acpi/><apic/></features>
  <cpu mode='host-passthrough'/>
  <clock offset='utc'/>
  <devices>
    <emulator>${qemu_bin}</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='${GOLDEN_IMG}'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <graphics type='vnc' port='-1' listen='127.0.0.1'/>
    <video><model type='vga'/></video>
    <console type='pty'/>
    <memballoon model='virtio'/>
  </devices>
  <qemu:commandline>
    <qemu:arg value='-netdev'/>
    <qemu:arg value='user,id=unet,hostfwd=tcp:${HOST_BIND}:${HOST_SSH_PORT}-:22,hostfwd=tcp:${HOST_BIND}:${HOST_RDP_PORT}-:3389'/>
    <qemu:arg value='-device'/>
    <qemu:arg value='virtio-net-pci,netdev=unet,addr=0x10'/>
  </qemu:commandline>
</domain>
XML
  $VIRSH define "${xml}" || { rm -f "${xml}"; die "virsh define failed"; }
  $VIRSH start "${VM_NAME}" || { rm -f "${xml}"; die "virsh start failed"; }
  rm -f "${xml}"

  log "waiting for guest SSH (host port ${HOST_SSH_PORT})"
  local deadline=$(( $(date +%s) + 180 ))
  until $SSH true 2>/dev/null; do
    [ "$(date +%s)" -gt "${deadline}" ] && die "guest SSH never came up — check VNC/console"
    sleep 5
  done
  log "guest reachable over SSH"
}

stage_provision() {
  domain_running || die "domain not running — run the 'boot' stage first"
  log "syncing current provision.sh + agent-runner to guest (so edits take effect on rerun)"
  local SCP="sshpass -p ${AGENT_PASSWORD} scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P ${HOST_SSH_PORT}"
  # Clean the temp dir first: `scp -r` into an existing dir NESTS (agent-runner/
  # agent-runner), which left stale files on repeated syncs.
  $SSH "rm -rf /tmp/agent-runner" 2>/dev/null || true
  $SCP "${SCRIPT_DIR}/provision.sh" "${AGENT_USER}@127.0.0.1:/tmp/provision.sh" || die "scp provision.sh failed"
  $SCP -r "${SCRIPT_DIR}/agent-runner" "${AGENT_USER}@127.0.0.1:/tmp/agent-runner" || die "scp agent-runner failed"
  $SSH "echo '${AGENT_PASSWORD}' | sudo -S -p '' sh -c 'cp /tmp/provision.sh /opt/provision.sh && rm -rf /opt/agent/agent-runner && cp -r /tmp/agent-runner /opt/agent/agent-runner && rm -rf /opt/agent/agent-runner/__pycache__ && chown -R ${AGENT_USER}:${AGENT_USER} /opt/agent/agent-runner'" \
    || die "syncing files into place failed"

  log "provisioning over SSH (live output; re-runnable)"
  # Stream provision.sh output straight to this log. Runs as root via `sudo -S`
  # (password on stdin) so it works over SSH without a TTY, NOPASSWD or not.
  $SSH "echo '${AGENT_PASSWORD}' | sudo -S -p '' env AGENT_USER='${AGENT_USER}' AGENT_PASSWORD='${AGENT_PASSWORD}' GUI_AGENTS_VERSION='${GUI_AGENTS_VERSION}' bash /opt/provision.sh 2>&1" \
    || die "provision.sh failed (see output above) — fix + rerun: build-golden.sh --from provision"
  $SSH 'test -f /opt/agent/PROVISIONED' 2>/dev/null || die "provision finished but marker missing"
  log "provisioning complete"
}

stage_snapshot() {
  domain_running || die "domain not running"
  log "creating warm snapshot 'golden-warm' (includes RAM)"
  $VIRSH snapshot-delete "${VM_NAME}" golden-warm >/dev/null 2>&1 || true
  # Internal system snapshot (no --live: the guest pauses briefly while RAM is
  # saved into the qcow2 — that memory state is what makes revert a warm reset).
  $VIRSH snapshot-create-as "${VM_NAME}" --name golden-warm \
    --description "Booted, provisioned, agent venv ready" \
    || die "snapshot-create failed"
}

stage_validate() {
  log "validating guest agent-runner --selftest"
  local report
  report="$($SSH '/opt/agent/venv/bin/python /opt/agent/agent-runner/cli.py --selftest' 2>/dev/null)"
  log "selftest report: ${report}"
  echo "${report}" | grep -q '"status": "succeeded"' || die "selftest did not succeed"
}

stage_clean() {
  log "cleaning state + VM + disk"
  $VIRSH destroy "${VM_NAME}" >/dev/null 2>&1 || true
  $VIRSH undefine "${VM_NAME}" --nvram >/dev/null 2>&1 || true
  rm -rf "${STATE_DIR}" "${GOLDEN_IMG}"
}

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
FROM=""; ONLY=""; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2;;
    --only) ONLY="$2"; shift 2;;
    --force) FORCE=1; shift;;
    --clean) stage_clean; exit 0;;
    *) die "unknown arg: $1";;
  esac
done

[ "${AGENT_PASSWORD}" = "changeme" ] && log "WARNING: default AGENT_PASSWORD — override for anything real."

run_stage() {
  local s="$1"
  if [ -n "${ONLY}" ] && [ "${ONLY}" != "${s}" ]; then return 0; fi
  # provision/snapshot/validate are cheap to redo and depend on live state, so
  # never skip them on stamp alone unless we're resuming past them.
  if [ "${FORCE}" -eq 0 ] && [ -z "${ONLY}" ] && done_ "${s}"; then
    log "stage ${s}: already done (skip)"; return 0
  fi
  log "stage ${s}: running"
  "stage_${s}" && stamp "${s}"
}

# Honour --from by clearing stamps from that stage onward.
if [ -n "${FROM}" ]; then
  seen=0
  for s in "${ALL_STAGES[@]}"; do
    [ "${s}" = "${FROM}" ] && seen=1
    [ "${seen}" -eq 1 ] && rm -f "${STATE_DIR}/${s}.done"
  done
fi

for s in "${ALL_STAGES[@]}"; do run_stage "${s}"; done

log "DONE."
cat <<EOF

Golden VM ready: ${VM_NAME}
  warm reset  : ${VIRSH} snapshot-revert ${VM_NAME} golden-warm
  XRDP (human): ${HOST_BIND}:${HOST_RDP_PORT}  user=${AGENT_USER}
  SSH (control): ssh -p ${HOST_SSH_PORT} ${AGENT_USER}@${HOST_BIND}
  bind to fleet: export CUF_GOLDEN_DOMAIN=${VM_NAME} CUF_SSH_KEY=${SSH_KEY}
EOF
