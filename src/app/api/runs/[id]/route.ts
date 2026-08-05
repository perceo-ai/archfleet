import { getDb } from "@/lib/fleet/db/db";
import { getRun } from "@/lib/fleet/db/runs-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/runs/:id — full run with events + artifacts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(getDb(), id);
  if (!run) return Response.json({ error: "run not found" }, { status: 404 });
  return Response.json(run);
}
