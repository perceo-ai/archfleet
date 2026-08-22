// VM daemon: maps fleet VMs to libvirt domains and handles per-run assignment.
// Per-run reset uses the warm snapshot (revert-to-running) so a "fresh" logged-in
// desktop comes back in ~1-3s instead of a cold boot. Pure orchestration over an
// injected VirshClient, so it is fully unit testable with a fake client.

import type { FleetVm, VmStatus, XrdpConnection } from "../types";
import type { DomainState, VirshClient } from "./virsh";
import { createMemoryLeaseStore, type LeaseStore } from "./lease-store";
import net from "node:net";

export type AcquireInput = {
  requiredLabels: string[];
  runId: string;
  /** Skip the warm-snapshot revert, keeping whatever is on the desktop. Only for
   * `persist` sessions on a profile's source desktop — every other caller wants
   * the clean, repeatable state. */
  keepState?: boolean;
  /** Override the lease length for this hold (long-lived sessions). */
  ttlMs?: number;
};

export type AcquireResult =
  | { ok: true; vm: FleetVm; xrdp: XrdpConnection }
  | { ok: false; reason: "no_matching_vm" | "reset_failed"; detail?: string };

const DEFAULT_WARM_SNAPSHOT = "golden-warm";
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_READY_INTERVAL_MS = 500;
/** Long enough that no honest computer-use run outlives its lease, short enough
 * that a killed controller's desktops come back the same working day. Holders
 * that legitimately outlive it (a run paused for a human) renew instead. */
export const DEFAULT_LEASE_TTL_MS = 6 * 60 * 60 * 1000;

export type VmDaemonOptions = {
  readyTimeoutMs?: number;
  readyIntervalMs?: number;
  waitForTcp?: (host: string, port: number, timeoutMs: number, intervalMs: number) => Promise<void>;
  /** Where holds are recorded. Defaults to process-local; pass the db-backed store
   * to make exclusion hold across workers and survive a restart. */
  leases?: LeaseStore;
  leaseTtlMs?: number;
  now?: () => string;
};

/** Map a libvirt domain state to our fleet-facing VM status. */
export function mapDomainState(state: DomainState, assigned: boolean): VmStatus {
  switch (state) {
    case "running":
    case "idle":
      return assigned ? "assigned" : "idle";
    case "shut off":
      return "stopped";
    case "in shutdown":
      return "resetting";
    case "paused":
    case "pmsuspended":
      return "resetting";
    case "crashed":
    case "absent":
    case "unknown":
    default:
      return "unhealthy";
  }
}

export function createVmDaemon(client: VirshClient, vms: FleetVm[], opts: VmDaemonOptions = {}) {
  // Only VMs bound to a real libvirt domain are managed here.
  const managed = vms.filter((vm): vm is FleetVm & { domain: string } => Boolean(vm.domain));
  // Who holds each domain. Process-local by default; db-backed in the server.
  const leases = opts.leases ?? createMemoryLeaseStore();
  const now = opts.now ?? (() => new Date().toISOString());
  const ttlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const expiryFrom = (nowIso: string, ms: number) =>
    new Date(new Date(nowIso).getTime() + ms).toISOString();

  function warmSnapshotOf(vm: FleetVm): string {
    return vm.warmSnapshot ?? DEFAULT_WARM_SNAPSHOT;
  }

  return {
    /** VMs this daemon controls (have a libvirt domain). */
    managedVms(): FleetVm[] {
      return managed;
    },

    isAssigned(vm: FleetVm): boolean {
      return vm.domain ? Boolean(leases.get(vm.domain, now())) : false;
    },

    /** Push a held desktop's lease out, so a long session is not swept mid-work.
     * False means the lease was lost — the caller must stop driving that desktop. */
    renew(vm: FleetVm, holder: string, forMs = ttlMs): boolean {
      if (!vm.domain) return false;
      const at = now();
      return leases.renew(vm.domain, holder, expiryFrom(at, forMs), at);
    },

    /**
     * Find an unheld, present VM whose labels satisfy `requiredLabels`, reset it
     * via warm snapshot, and lease it to the run.
     *
     * The lease is taken BEFORE the revert: reverting a desktop another holder is
     * driving would destroy its work, so losing the claim race has to mean we
     * never touched the domain.
     */
    async acquire(input: AcquireInput): Promise<AcquireResult> {
      const at = now();
      const held = new Set(leases.heldDomains(at));
      const candidates = managed.filter(
        (vm) =>
          !held.has(vm.domain) &&
          input.requiredLabels.every((label) => vm.labels.includes(label)),
      );
      if (candidates.length === 0) {
        return { ok: false, reason: "no_matching_vm" };
      }

      const expiresAt = expiryFrom(at, input.ttlMs ?? ttlMs);
      for (const vm of candidates) {
        const state = await client.domainState(vm.domain);
        if (state === "absent" || state === "unknown" || state === "crashed") {
          continue; // unhealthy — try the next candidate
        }
        // Another worker may have taken this domain since we listed holds.
        if (!leases.claim(vm.domain, input.runId, expiresAt, at)) continue;
        try {
          if (!input.keepState) await client.revertSnapshot(vm.domain, warmSnapshotOf(vm));
          if (vm.ssh) {
            await (opts.waitForTcp ?? waitForTcp)(
              vm.ssh.host,
              vm.ssh.port,
              opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
              opts.readyIntervalMs ?? DEFAULT_READY_INTERVAL_MS,
            );
          }
        } catch (e) {
          // Hand the desktop back — holding a lease on a VM we failed to reset
          // would leak it out of the fleet until the TTL lapsed.
          leases.release(vm.domain, input.runId);
          return { ok: false, reason: "reset_failed", detail: String(e) };
        }
        return { ok: true, vm: { ...vm, status: "assigned", assignedRunId: input.runId }, xrdp: vm.xrdp };
      }

      return { ok: false, reason: "no_matching_vm" };
    },

    /** Release a VM back to the pool, reverting to the clean warm snapshot.
     * `holder` scopes the release, so a late call cannot free a desktop somebody
     * else has since taken. `keepState` leaves a persist session's work in place. */
    async release(vm: FleetVm, opt: { holder?: string; keepState?: boolean } = {}): Promise<void> {
      if (!vm.domain) return;
      const holder = opt.holder ?? vm.assignedRunId;
      const current = leases.get(vm.domain, now());
      // Somebody else owns it now: leave both the lease and the disk alone.
      if (holder && current && current.holder !== holder) return;
      leases.release(vm.domain, holder);
      if (!opt.keepState) await client.revertSnapshot(vm.domain, warmSnapshotOf(vm));
    },

    /** Free desktops whose holder died. Returns how many came back. */
    sweepExpiredLeases(): number {
      return leases.sweepExpired(now());
    },

    /** Current fleet status of a managed VM from its live domain state. */
    async health(vm: FleetVm): Promise<VmStatus> {
      if (!vm.domain) return vm.status;
      const state = await client.domainState(vm.domain);
      return mapDomainState(state, Boolean(leases.get(vm.domain, now())));
    },

    /** XRDP connection block for human takeover. */
    xrdpMeta(vm: FleetVm): XrdpConnection {
      return vm.xrdp;
    },
  };
}

export type VmDaemon = ReturnType<typeof createVmDaemon>;

async function waitForTcp(host: string, port: number, timeoutMs: number, intervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "connection failed";
  while (Date.now() <= deadline) {
    try {
      await connectOnce(host, port, Math.min(intervalMs, 2_000));
      return;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await sleep(intervalMs);
    }
  }
  throw new Error(`timed out waiting for TCP ${host}:${port}: ${lastError}`);
}

function connectOnce(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const done = (err?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done());
    socket.once("timeout", () => done(new Error("connect timeout")));
    socket.once("error", done);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
