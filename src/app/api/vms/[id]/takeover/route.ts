import { getDb } from "@/lib/fleet/db/db";
import { listVms } from "@/lib/fleet/db/vms-repo";
import { createRdpLaunch } from "@/lib/fleet/rdp-gateway";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/vms/:id/takeover — returns a browser-launchable remote desktop URL
// when Guacamole is configured, otherwise falls back to the .rdp download route.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vm = [...realVmsFromEnv(), ...listVms(getDb())].find((v) => v.id === id);
  if (!vm) return Response.json({ error: "vm not found" }, { status: 404 });

  try {
    const launch = await createRdpLaunch(vm, { downloadUrl: `/api/vms/${encodeURIComponent(id)}/rdp` });
    return Response.json(launch);
  } catch (e) {
    return Response.json(
      {
        mode: "rdp_file",
        downloadUrl: `/api/vms/${encodeURIComponent(id)}/rdp`,
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
