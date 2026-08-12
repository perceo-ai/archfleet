import { checkProfileFleet } from "@/lib/fleet/profile-status";
import { execVirshRunner } from "@/lib/fleet/vm-daemon/exec-runner";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";
import { createVirshClient } from "@/lib/fleet/vm-daemon/virsh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/profile-status — readiness of profile clone fleets from env config.
export async function GET() {
  const client = createVirshClient(execVirshRunner(), process.env.CUF_LIBVIRT_URI ?? "qemu:///session");
  const vms = realVmsFromEnv();
  const status = await checkProfileFleet(vms, client);
  return Response.json({ ...status, vmCount: vms.length, time: new Date().toISOString() });
}
