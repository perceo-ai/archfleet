// VM daemon: maps fleet VMs to libvirt domains and handles per-run assignment.
// Per-run reset uses the warm snapshot (revert-to-running) so a "fresh" logged-in
// desktop comes back in ~1-3s instead of a cold boot. Pure orchestration over an
// injected VirshClient, so it is fully unit testable with a fake client.

import type { FleetVm, VmStatus, XrdpConnection } from "../types";
import type { DomainState, VirshClient } from "./virsh";
import net from "node:net";

export type AcquireInput = {
  requiredLabels: string[];
  runId: string;
};

export type AcquireResult =
  | { ok: true; vm: FleetVm; xrdp: XrdpConnection }
  | { ok: false; reason: "no_matching_vm" | "reset_failed"; detail?: string };

const DEFAULT_WARM_SNAPSHOT = "golden-warm";
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_READY_INTERVAL_MS = 500;

export type VmDaemonOptions = {
  readyTimeoutMs?: number;
  readyIntervalMs?: number;
  waitForTcp?: (host: string, port: number, timeoutMs: number, intervalMs: number) => Promise<void>;
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
  // domain -> runId currently holding the VM.
  const assignments = new Map<string, string>();

  function warmSnapshotOf(vm: FleetVm): string {
    return vm.warmSnapshot ?? DEFAULT_WARM_SNAPSHOT;
  }

  return {
    /** VMs this daemon controls (have a libvirt domain). */
    managedVms(): FleetVm[] {
      return managed;
    },

    isAssigned(vm: FleetVm): boolean {
      return vm.domain ? assignments.has(vm.domain) : false;
    },

    /**
     * Find an unassigned, present VM whose labels satisfy `requiredLabels`,
     * reset it via warm snapshot, and mark it assigned to the run.
     */
    async acquire(input: AcquireInput): Promise<AcquireResult> {
      const candidates = managed.filter(
        (vm) =>
          !assignments.has(vm.domain) &&
          input.requiredLabels.every((label) => vm.labels.includes(label)),
      );
      if (candidates.length === 0) {
        return { ok: false, reason: "no_matching_vm" };
      }

      for (const vm of candidates) {
        const state = await client.domainState(vm.domain);
        if (state === "absent" || state === "unknown" || state === "crashed") {
          continue; // unhealthy — try the next candidate
        }
        try {
          await client.revertSnapshot(vm.domain, warmSnapshotOf(vm));
          if (vm.ssh) {
            await (opts.waitForTcp ?? waitForTcp)(
              vm.ssh.host,
              vm.ssh.port,
              opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
              opts.readyIntervalMs ?? DEFAULT_READY_INTERVAL_MS,
            );
          }
        } catch (e) {
          return { ok: false, reason: "reset_failed", detail: String(e) };
        }
        assignments.set(vm.domain, input.runId);
        return { ok: true, vm: { ...vm, status: "assigned", assignedRunId: input.runId }, xrdp: vm.xrdp };
      }

      return { ok: false, reason: "no_matching_vm" };
    },

    /** Release a VM back to the pool, reverting to the clean warm snapshot. */
    async release(vm: FleetVm): Promise<void> {
      if (!vm.domain) return;
      assignments.delete(vm.domain);
      await client.revertSnapshot(vm.domain, warmSnapshotOf(vm));
    },

    /** Current fleet status of a managed VM from its live domain state. */
    async health(vm: FleetVm): Promise<VmStatus> {
      if (!vm.domain) return vm.status;
      const state = await client.domainState(vm.domain);
      return mapDomainState(state, assignments.has(vm.domain));
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
