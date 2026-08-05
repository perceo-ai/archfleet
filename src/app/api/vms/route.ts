import { getDb } from "@/lib/fleet/db/db";
import { listVms } from "@/lib/fleet/db/vms-repo";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";
import { createVirshClient } from "@/lib/fleet/vm-daemon/virsh";
import { execVirshRunner } from "@/lib/fleet/vm-daemon/exec-runner";
import { mapDomainState } from "@/lib/fleet/vm-daemon/daemon";
import type { FleetVm } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vms — fleet inventory (real domain-bound VMs from env + persisted
// registry), each domain VM enriched with its LIVE libvirt state (best-effort).
export async function GET() {
  const persisted = listVms(getDb());
  const real = realVmsFromEnv();
  const realIds = new Set(real.map((v) => v.id));
  const vms = [...real, ...persisted.filter((v) => !realIds.has(v.id))];

  const client = createVirshClient(
    execVirshRunner(),
    process.env.CUF_LIBVIRT_URI ?? "qemu:///session",
  );
  const enriched = await Promise.all(
    vms.map(async (vm): Promise<FleetVm> => {
      if (!vm.domain) return vm;
      try {
        const state = await client.domainState(vm.domain);
        return { ...vm, status: mapDomainState(state, Boolean(vm.assignedRunId)), lastHealthAt: new Date().toISOString() };
      } catch {
        return vm; // virsh unavailable — keep registry status
      }
    }),
  );
  return Response.json(enriched);
}
