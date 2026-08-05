import { planWorkflow } from "@/lib/fleet/planner";
import { spawnAgentExec } from "@/lib/fleet/ssh-exec";
import { getDb } from "@/lib/fleet/db/db";
import { saveWorkflow } from "@/lib/fleet/db/workflows-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/plan — draft a workflow from a plain-language task via the agent planner.
// Body: { task, save?: boolean }. Returns { workflow, errors }. Draft starts disabled.
export async function POST(req: Request) {
  const { task, save } = (await req.json().catch(() => ({}))) as { task?: string; save?: boolean };
  if (!task) return Response.json({ error: "task is required" }, { status: 400 });
  const result = await planWorkflow(task, spawnAgentExec);
  if (save && result.errors.length === 0) saveWorkflow(getDb(), result.workflow);
  return Response.json(result);
}
