import { continueProfileOperation } from "@/lib/fleet/profile-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operation = continueProfileOperation(id);
  if (!operation) return Response.json({ error: "profile operation not found" }, { status: 404 });
  return Response.json({ operation });
}
