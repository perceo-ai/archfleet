import { getDb } from "@/lib/fleet/db/db";
import { listWorkflows, saveWorkflow } from "@/lib/fleet/db/workflows-repo";
import type { Workflow } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workflows — list persisted workflows.
export async function GET() {
  return Response.json(listWorkflows(getDb()));
}

// POST /api/workflows — upsert a workflow graph.
export async function POST(req: Request) {
  const wf = (await req.json()) as Workflow;
  if (!wf.id || !wf.name || !Array.isArray(wf.nodes)) {
    return Response.json({ error: "id, name and nodes are required" }, { status: 400 });
  }
  saveWorkflow(getDb(), wf);
  return Response.json({ id: wf.id }, { status: 201 });
}
