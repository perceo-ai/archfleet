import { getDb } from "@/lib/fleet/db/db";
import { listVms } from "@/lib/fleet/db/vms-repo";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vms/:id/rdp — download an .rdp file to open the VM in an RDP client
// (human takeover). Password is not embedded; the client prompts (or use the
// AGENT_PASSWORD secret).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vm = [...realVmsFromEnv(), ...listVms(getDb())].find((v) => v.id === id);
  if (!vm) return Response.json({ error: "vm not found" }, { status: 404 });

  const rdp = [
    `full address:s:${vm.xrdp.host}:${vm.xrdp.port}`,
    `username:s:${vm.xrdp.username}`,
    "screen mode id:i:2",
    "prompt for credentials:i:1",
    "authentication level:i:0",
  ].join("\r\n");

  return new Response(rdp, {
    headers: {
      "content-type": "application/x-rdp",
      "content-disposition": `attachment; filename="${vm.name}.rdp"`,
    },
  });
}
