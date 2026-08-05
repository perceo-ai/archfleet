#!/usr/bin/env bash
#
# preflight.sh — verify the controller host can build + run fleet VMs before
# running build-golden.sh. Reports every missing piece and the exact install
# command. Exit 0 only when everything needed is present.

set -uo pipefail

miss=0
ok()   { echo "  ok    $*"; }
bad()  { echo "  MISS  $*"; miss=1; }

echo "== binaries =="
for b in qemu-img wget ssh; do command -v "$b" >/dev/null 2>&1 && ok "$b" || bad "$b"; done
for b in virsh virt-install virt-customize sshpass; do
  command -v "$b" >/dev/null 2>&1 && ok "$b" || bad "$b (see install line below)"
done

echo "== kvm =="
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then ok "/dev/kvm read+write"; else bad "/dev/kvm not read/writable"; fi
if grep -Eq '(vmx|svm)' /proc/cpuinfo; then ok "cpu virtualization"; else bad "no vmx/svm in /proc/cpuinfo"; fi

echo "== libvirt session =="
if command -v virsh >/dev/null 2>&1; then
  if virsh -c qemu:///session version >/dev/null 2>&1; then ok "qemu:///session reachable"; else bad "qemu:///session not reachable"; fi
else
  bad "virsh absent — cannot check session"
fi

echo
if [ "$miss" -eq 0 ]; then
  echo "PREFLIGHT OK — run: AGENT_PASSWORD='...' ./virt/build-golden.sh"
else
  echo "PREFLIGHT INCOMPLETE. On Arch install with:"
  echo "  sudo pacman -S --needed libvirt qemu-desktop virt-install libguestfs sshpass edk2-ovmf dnsmasq"
  echo "  systemctl --user enable --now libvirtd 2>/dev/null || true"
fi
exit "$miss"
