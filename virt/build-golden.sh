#!/usr/bin/env bash
#
# build-golden.sh — controller-side. Builds the golden warm-snapshot VM the fleet
# reverts to on every run.
#
# Pipeline:
#   1. Fetch Ubuntu cloud image (qcow2).
#   2. Copy + grow it into a golden disk.
#   3. Inject provision.sh OFFLINE with virt-customize (deterministic, no boot).
#   4. Define + boot the domain under qemu:///session with host port-forwards.
#   5. Wait until SSH answers and /opt/agent/PROVISIONED exists.
#   6. Take a WARM snapshot (running domain -> captures RAM) named "golden-warm".
#      Per-run reset = `virsh snapshot-revert <domain> golden-warm` (~1-3s).
#
# Prereqs (install once): libvirt qemu virt-install libguestfs (virt-customize),
# and either qemu:///session usable by your user. See host-virt-capability memory.
#
# Usage:
#   AGENT_PASSWORD='...' ./virt/build-golden.sh
#
# Config via env (all optional, sane defaults below).

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
UBUNTU_RELEASE="${UBUNTU_RELEASE:-noble}"                 # 24.04 LTS
CLOUD_IMG_URL="${CLOUD_IMG_URL:-https://cloud-images.ubuntu.com/${UBUNTU_RELEASE}/current/${UBUNTU_RELEASE}-server-cloudimg-amd64.img}"

VM_NAME="${VM_NAME:-cuf-golden}"
DISK_SIZE="${DISK_SIZE:-25G}"                             # grown from the ~3.5G base
RAM_MB="${RAM_MB:-4096}"
VCPUS="${VCPUS:-2}"

HOST_SSH_PORT="${HOST_SSH_PORT:-10022}"                   # host -> guest:22
HOST_RDP_PORT="${HOST_RDP_PORT:-13389}"                   # host -> guest:3389

AGENT_USER="${AGENT_USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-changeme}"

LIBVIRT_URI="${LIBVIRT_URI:-qemu:///session}"
VIRSH="virsh -c ${LIBVIRT_URI}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${CACHE_DIR:-${SCRIPT_DIR}/.cache}"
IMAGES_DIR="${IMAGES_DIR:-${SCRIPT_DIR}/images}"
BASE_IMG="${CACHE_DIR}/${UBUNTU_RELEASE}-base.img"
GOLDEN_IMG="${IMAGES_DIR}/${VM_NAME}.qcow2"

log() { echo "[build-golden] $*"; }
die() { echo "[build-golden] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Prereq checks
# ---------------------------------------------------------------------------
for bin in virsh virt-install virt-customize qemu-img wget ssh; do
  command -v "$bin" >/dev/null 2>&1 || die "missing required tool: $bin"
done
$VIRSH version >/dev/null 2>&1 || die "cannot reach libvirt at ${LIBVIRT_URI}"
[ "${AGENT_PASSWORD}" = "changeme" ] && log "WARNING: using default AGENT_PASSWORD — override for anything real."

mkdir -p "${CACHE_DIR}" "${IMAGES_DIR}"

# ---------------------------------------------------------------------------
# 1. Fetch base cloud image (cached)
# ---------------------------------------------------------------------------
if [ ! -f "${BASE_IMG}" ]; then
  log "downloading Ubuntu ${UBUNTU_RELEASE} cloud image"
  wget --show-progress -O "${BASE_IMG}.part" "${CLOUD_IMG_URL}"
  mv "${BASE_IMG}.part" "${BASE_IMG}"
else
  log "base image cached: ${BASE_IMG}"
fi

# ---------------------------------------------------------------------------
# 2. Copy + grow into the golden disk (fresh each build)
# ---------------------------------------------------------------------------
log "creating golden disk ${GOLDEN_IMG} (${DISK_SIZE})"
rm -f "${GOLDEN_IMG}"
qemu-img convert -O qcow2 "${BASE_IMG}" "${GOLDEN_IMG}"
qemu-img resize "${GOLDEN_IMG}" "${DISK_SIZE}"

# ---------------------------------------------------------------------------
# 3. Offline provisioning with virt-customize (deterministic, no boot needed)
# ---------------------------------------------------------------------------
log "running provision.sh offline into the image (this takes a while)"
virt-customize -a "${GOLDEN_IMG}" \
  --root-password "password:${AGENT_PASSWORD}" \
  --run-command "growpart /dev/sda 1 || true" \
  --run-command "resize2fs /dev/sda1 || true" \
  --copy-in "${SCRIPT_DIR}/provision.sh:/tmp" \
  --run-command "AGENT_USER='${AGENT_USER}' AGENT_PASSWORD='${AGENT_PASSWORD}' bash /tmp/provision.sh" \
  --run-command "systemctl set-default graphical.target" \
  --run-command "rm -f /tmp/provision.sh"

# ---------------------------------------------------------------------------
# 4. Define + boot the domain with user-mode net + host port-forwards.
#    qemu:///session -> user (slirp) networking; hostfwd exposes 22/3389 on host.
# ---------------------------------------------------------------------------
if $VIRSH dominfo "${VM_NAME}" >/dev/null 2>&1; then
  log "existing domain ${VM_NAME} found — destroying + undefining"
  $VIRSH destroy "${VM_NAME}" >/dev/null 2>&1 || true
  $VIRSH undefine "${VM_NAME}" --nvram >/dev/null 2>&1 || true
fi

log "defining + starting domain ${VM_NAME}"
virt-install \
  --connect "${LIBVIRT_URI}" \
  --name "${VM_NAME}" \
  --memory "${RAM_MB}" \
  --vcpus "${VCPUS}" \
  --cpu host-passthrough \
  --import \
  --disk "path=${GOLDEN_IMG},format=qcow2,bus=virtio" \
  --os-variant "ubuntu${UBUNTU_RELEASE}" \
  --graphics vnc,listen=127.0.0.1 \
  --network none \
  --qemu-commandline="-netdev user,id=unet,hostfwd=tcp::${HOST_SSH_PORT}-:22,hostfwd=tcp::${HOST_RDP_PORT}-:3389 -device virtio-net-pci,netdev=unet" \
  --noautoconsole \
  --import || die "virt-install failed"

# ---------------------------------------------------------------------------
# 5. Wait for provisioning marker over the forwarded SSH port.
# ---------------------------------------------------------------------------
log "waiting for guest SSH on host port ${HOST_SSH_PORT} + provisioning marker"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p ${HOST_SSH_PORT}"
deadline=$(( $(date +%s) + 600 ))
until sshpass -p "${AGENT_PASSWORD}" ssh ${SSH_OPTS} "${AGENT_USER}@127.0.0.1" \
        'test -f /opt/agent/PROVISIONED' >/dev/null 2>&1; do
  [ "$(date +%s)" -gt "${deadline}" ] && die "timed out waiting for guest provisioning"
  sleep 5
done
log "guest is up and provisioned"

# ---------------------------------------------------------------------------
# 6. Warm snapshot (running domain -> includes RAM). Reset target for every run.
# ---------------------------------------------------------------------------
log "creating warm snapshot 'golden-warm' (includes RAM)"
$VIRSH snapshot-create-as "${VM_NAME}" \
  --name "golden-warm" \
  --description "Booted + auto-logged-in desktop, agent venv ready" \
  --live || die "snapshot-create failed"

log "DONE."
cat <<EOF

Golden VM ready: ${VM_NAME}
  disk        : ${GOLDEN_IMG}
  warm reset  : virsh -c ${LIBVIRT_URI} snapshot-revert ${VM_NAME} golden-warm
  XRDP (human): 127.0.0.1:${HOST_RDP_PORT}  user=${AGENT_USER}
  SSH (control): ssh -p ${HOST_SSH_PORT} ${AGENT_USER}@127.0.0.1
EOF
