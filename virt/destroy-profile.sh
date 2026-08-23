#!/usr/bin/env bash
#
# destroy-profile.sh — tear down every clone domain belonging to a profile.
#
# The counterpart to prepare-profile.sh. Iterating on a profile means throwing
# one away and building it again, and without this that is a hand-written pile
# of virsh commands where forgetting `--remove-all-storage` silently leaks a
# 25GB disk per clone.
#
# Destroys ONLY the profile's clones (domains named "<prefix>-N"). The source /
# golden domain is never touched — it is the thing profiles are built FROM, and
# taking it out would mean a full rebuild rather than a re-clone.
#
# Usage:
#   ./virt/destroy-profile.sh --profile bank                 # dry run: show what would go
#   ./virt/destroy-profile.sh --profile bank --yes           # actually destroy
#   ./virt/destroy-profile.sh --profile bank --yes --keep-disks

set -uo pipefail

PROFILE=""
DOMAIN_PREFIX=""
ASSUME_YES=0
KEEP_DISKS=0
LIBVIRT_URI="${LIBVIRT_URI:-qemu:///session}"

die() { echo "error: $*" >&2; exit 2; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2;;
    --domain-prefix) DOMAIN_PREFIX="${2:-}"; shift 2;;
    --yes|-y) ASSUME_YES=1; shift;;
    --keep-disks) KEEP_DISKS=1; shift;;
    --uri) LIBVIRT_URI="${2:-}"; shift 2;;
    -h|--help) usage;;
    *) die "unknown argument: $1";;
  esac
done

[[ -n "$PROFILE" ]] || die "--profile is required"
DOMAIN_PREFIX="${DOMAIN_PREFIX:-cuf-${PROFILE}}"
VIRSH="virsh -c ${LIBVIRT_URI}"

# Match "<prefix>-<number>" exactly, so a profile called "bank" never sweeps up
# a domain called "bank-archive" or the golden source.
mapfile -t DOMAINS < <($VIRSH list --all --name 2>/dev/null | grep -E "^${DOMAIN_PREFIX}-[0-9]+$" || true)

if [[ ${#DOMAINS[@]} -eq 0 ]]; then
  echo "No clone domains found for profile '${PROFILE}' (prefix '${DOMAIN_PREFIX}-')."
  exit 0
fi

echo "Profile '${PROFILE}' clones:"
for d in "${DOMAINS[@]}"; do
  state="$($VIRSH domstate "$d" 2>/dev/null || echo unknown)"
  disks="$($VIRSH domblklist --details "$d" 2>/dev/null | awk '$2=="disk"{print $4}' | tr '\n' ' ')"
  echo "  - ${d} [${state}] ${disks}"
done

if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo
  echo "Dry run. Nothing was destroyed. Re-run with --yes to remove the domains above."
  exit 0
fi

rc=0
for d in "${DOMAINS[@]}"; do
  echo "== ${d} =="
  # Snapshots must go before the domain, or undefine refuses on some drivers.
  while read -r snap; do
    [[ -n "$snap" ]] || continue
    echo "  deleting snapshot ${snap}"
    $VIRSH snapshot-delete "$d" "$snap" >/dev/null 2>&1 || echo "  (snapshot ${snap} would not delete)"
  done < <($VIRSH snapshot-list "$d" --name 2>/dev/null || true)

  if $VIRSH domstate "$d" 2>/dev/null | grep -q running; then
    echo "  destroying (force off)"
    $VIRSH destroy "$d" >/dev/null 2>&1 || true
  fi

  if [[ "$KEEP_DISKS" -eq 1 ]]; then
    $VIRSH undefine "$d" --snapshots-metadata >/dev/null 2>&1 \
      || { echo "  FAILED to undefine ${d}"; rc=1; continue; }
    echo "  undefined (disks kept)"
  else
    # --remove-all-storage is the whole point: without it each clone leaves its
    # backing qcow2 behind and the host silently fills up.
    $VIRSH undefine "$d" --remove-all-storage --snapshots-metadata >/dev/null 2>&1 \
      || { echo "  FAILED to undefine ${d}"; rc=1; continue; }
    echo "  undefined and disks removed"
  fi
done

echo
if [[ $rc -eq 0 ]]; then
  echo "Profile '${PROFILE}' destroyed (${#DOMAINS[@]} clone(s))."
  echo "Rebuild with: ./virt/prepare-profile.sh --profile ${PROFILE} --clones N"
else
  echo "Finished with errors — some domains may remain. Check: virsh list --all"
fi
exit "$rc"
