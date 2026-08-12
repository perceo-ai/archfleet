import type { FleetVm } from "./types";
import type { VirshClient } from "./vm-daemon/virsh";

export type ProfileVmStatus = {
  vmId: string;
  domain: string;
  state: string;
  snapshot: string;
  snapshotPresent: boolean;
  ready: boolean;
};

export type ProfileFleetStatus = {
  profiles: Record<
    string,
    {
      ready: boolean;
      vms: ProfileVmStatus[];
    }
  >;
};

function profileOf(vm: FleetVm): string | undefined {
  return vm.labels.find((label) => label.startsWith("profile:"))?.slice("profile:".length);
}

export async function checkProfileFleet(
  vms: FleetVm[],
  client: Pick<VirshClient, "domainState" | "listSnapshots">,
): Promise<ProfileFleetStatus> {
  const profiles: ProfileFleetStatus["profiles"] = {};
  for (const vm of vms) {
    const profile = profileOf(vm);
    if (!profile || !vm.domain) continue;
    const snapshot = vm.warmSnapshot ?? "golden-warm";
    let state = "unknown";
    let snapshotPresent = false;
    try {
      state = await client.domainState(vm.domain);
      snapshotPresent = (await client.listSnapshots(vm.domain)).includes(snapshot);
    } catch {
      state = "unknown";
      snapshotPresent = false;
    }
    const ready = state !== "absent" && state !== "unknown" && snapshotPresent;
    profiles[profile] ??= { ready: true, vms: [] };
    profiles[profile].vms.push({
      vmId: vm.id,
      domain: vm.domain,
      state,
      snapshot,
      snapshotPresent,
      ready,
    });
    profiles[profile].ready &&= ready;
  }
  return { profiles };
}
