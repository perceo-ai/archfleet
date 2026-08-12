import { getProfileOperation } from "@/lib/fleet/profile-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operation = getProfileOperation(id);
  const vm = operation?.sourceVm;
  if (!vm) return Response.json({ error: "source desktop not available" }, { status: 404 });

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
      "content-disposition": `attachment; filename="${operation.profile}-source.rdp"`,
    },
  });
}
