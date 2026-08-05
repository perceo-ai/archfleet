import { enqueueManualRun } from "@/lib/fleet/server-runtime";
import { getDb } from "@/lib/fleet/db/db";
import { listRuns } from "@/lib/fleet/db/runs-repo";

// Node runtime: the orchestrator spawns virsh + ssh child processes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs — enqueue a run and return immediately (status: queued). A worker
// (instrumentation loop or POST /api/runs/process) executes it. Body: { workflowId? }.
export async function POST(req: Request) {
  let workflowId: string | undefined;
  try {
    workflowId = ((await req.json()) as { workflowId?: string }).workflowId;
  } catch {
    // no body — default workflow
  }
  const run = enqueueManualRun(workflowId);
  return Response.json(run, { status: 202 });
}

// GET /api/runs — recent run summaries, newest first.
export async function GET() {
  return Response.json(listRuns(getDb()));
}
