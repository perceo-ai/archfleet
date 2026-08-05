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
  let params: Record<string, string | number | boolean | null> | undefined;
  try {
    const body = (await req.json()) as {
      workflowId?: string;
      params?: Record<string, string | number | boolean | null>;
    };
    workflowId = body.workflowId;
    params = body.params;
  } catch {
    // no body — default workflow, no params
  }
  const run = enqueueManualRun(workflowId, { params });
  return Response.json(run, { status: 202 });
}

// GET /api/runs — recent run summaries, newest first.
export async function GET() {
  return Response.json(listRuns(getDb()));
}
