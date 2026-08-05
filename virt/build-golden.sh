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
OS_VARIANT="${OS_VARIANT:-ubuntu24.04}"                   # libosinfo variant for virt-install
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
# virt-customize's offline appliance has no reliable DNS, so we do NOT run the
# network-heavy provision here. Offline we only prep things that need no network
# (disk grow, static netplan, ssh password auth, copy files) and register a
# first-boot service. provision.sh then runs on first boot, where qemu user-mode
# networking gives working DHCP + DNS for apt/pip.
log "offline prep + registering first-boot provisioning"

# Static netplan so the guest always gets DHCP (slirp) regardless of cloud-init.
NETPLAN_FILE="$(mktemp)"
cat > "${NETPLAN_FILE}" <<'YAML'
network:
  version: 2
  renderer: networkd
  ethernets:
    cufnet:
      match:
        name: "e*"
      dhcp4: true
YAML

# First-boot wrapper: bake env, run provision.sh, log to /var/log/cuf-provision.log.
FIRSTBOOT_FILE="$(mktemp)"
cat > "${FIRSTBOOT_FILE}" <<EOF
#!/bin/bash
export AGENT_USER='${AGENT_USER}' AGENT_PASSWORD='${AGENT_PASSWORD}' GUI_AGENTS_VERSION='${GUI_AGENTS_VERSION:-0.3.2}'
bash /opt/provision.sh > /var/log/cuf-provision.log 2>&1
EOF

virt-customize -a "${GOLDEN_IMG}" \
  --root-password "password:${AGENT_PASSWORD}" \
  --run-command "growpart /dev/sda 1 || true" \
  --run-command "resize2fs /dev/sda1 || true" \
  --run-command "touch /etc/cloud/cloud-init.disabled" \
  --upload "${NETPLAN_FILE}:/etc/netplan/99-cuf.yaml" \
  --run-command "chmod 600 /etc/netplan/99-cuf.yaml" \
  --run-command "mkdir -p /etc/ssh/sshd_config.d && printf 'PasswordAuthentication yes\nKbdInteractiveAuthentication yes\n' > /etc/ssh/sshd_config.d/10-cuf.conf" \
  --run-command "ssh-keygen -A" \
  --run-command "systemctl disable --now ssh.socket 2>/dev/null || true; systemctl enable ssh || true" \
  --copy-in "${SCRIPT_DIR}/provision.sh:/opt" \
  --mkdir "/opt/agent" \
  --copy-in "${SCRIPT_DIR}/agent-runner:/opt/agent" \
  --run-command "rm -rf /opt/agent/agent-runner/__pycache__" \
  --run-command "systemctl set-default graphical.target" \
  --firstboot "${FIRSTBOOT_FILE}" \
  || die "virt-customize offline prep failed"

rm -f "${NETPLAN_FILE}" "${FIRSTBOOT_FILE}"

# ---------------------------------------------------------------------------
# 4. Define + boot the domain with user-mode net + host port-forwards.
#    qemu:///session -> user (slirp) networking; hostfwd exposes 22/3389 on host.
# ---------------------------------------------------------------------------
if $VIRSH dominfo "${VM_NAME}" >/dev/null 2>&1; then
  log "existing domain ${VM_NAME} found — destroying + undefining"
  $VIRSH destroy "${VM_NAME}" >/dev/null 2>&1 || true
  $VIRSH undefine "${VM_NAME}" --nvram >/dev/null 2>&1 || true
fi

# Define via `virsh define` + generated XML (no virt-install / PyGObject dep).
# Networking is entirely qemu user-mode (slirp) via <qemu:commandline>, with host
# port-forwards for SSH (control) and RDP (human takeover).
log "defining + starting domain ${VM_NAME}"
QEMU_BIN="$(command -v qemu-system-x86_64)"
DOMAIN_XML="$(mktemp)"
cat > "${DOMAIN_XML}" <<XML
<domain type='kvm' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>
  <name>${VM_NAME}</name>
  <memory unit='MiB'>${RAM_MB}</memory>
  <vcpu>${VCPUS}</vcpu>
  <os>
    <type arch='x86_64' machine='pc'>hvm</type>
    <boot dev='hd'/>
  </os>
  <features><acpi/><apic/></features>
  <cpu mode='host-passthrough'/>
  <clock offset='utc'/>
  <devices>
    <emulator>${QEMU_BIN}</emulator>
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
    <qemu:arg value='user,id=unet,hostfwd=tcp::${HOST_SSH_PORT}-:22,hostfwd=tcp::${HOST_RDP_PORT}-:3389'/>
    <qemu:arg value='-device'/>
    <qemu:arg value='virtio-net-pci,netdev=unet,addr=0x10'/>
  </qemu:commandline>
</domain>
XML

$VIRSH define "${DOMAIN_XML}" || die "virsh define failed"
$VIRSH start "${VM_NAME}" || die "virsh start failed"
rm -f "${DOMAIN_XML}"

# ---------------------------------------------------------------------------
# 5. Wait for provisioning marker over the forwarded SSH port.
# ---------------------------------------------------------------------------
# First boot runs provision.sh (desktop + xrdp + pip), which is slow — wait up to
# PROVISION_WAIT_S. Follow /var/log/cuf-provision.log inside the guest to debug.
PROVISION_WAIT_S="${PROVISION_WAIT_S:-1800}"
log "waiting up to ${PROVISION_WAIT_S}s for first-boot provisioning (ssh port ${HOST_SSH_PORT})"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p ${HOST_SSH_PORT}"
deadline=$(( $(date +%s) + PROVISION_WAIT_S ))
until sshpass -p "${AGENT_PASSWORD}" ssh ${SSH_OPTS} "${AGENT_USER}@127.0.0.1" \
        'test -f /opt/agent/PROVISIONED' >/dev/null 2>&1; do
  if [ "$(date +%s)" -gt "${deadline}" ]; then
    die "timed out waiting for provisioning — check /var/log/cuf-provision.log in the guest (ssh -p ${HOST_SSH_PORT} root@127.0.0.1)"
  fi
  sleep 10
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
