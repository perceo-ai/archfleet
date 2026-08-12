import { getProfileOperation } from "@/lib/fleet/profile-ops";
import { createRdpLaunch } from "@/lib/fleet/rdp-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operation = getProfileOperation(id);
  if (!operation?.sourceVm) return Response.json({ error: "source desktop not available" }, { status: 404 });
  const downloadUrl = `/api/profile-ops/${encodeURIComponent(id)}/rdp`;
  try {
    return Response.json(await createRdpLaunch(operation.sourceVm, { downloadUrl }));
  } catch (e) {
    return Response.json(
      { mode: "rdp_file", downloadUrl, reason: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
