import { getDb } from "@/lib/fleet/db/db";
import { listVms } from "@/lib/fleet/db/vms-repo";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vms — fleet inventory: real domain-bound VMs (from env) plus any
// persisted/mock VMs from the registry.
export async function GET() {
  const persisted = listVms(getDb());
  const real = realVmsFromEnv();
  const realIds = new Set(real.map((v) => v.id));
  return Response.json([...real, ...persisted.filter((v) => !realIds.has(v.id))]);
}
