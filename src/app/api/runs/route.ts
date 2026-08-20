import { enqueueManualRun } from "@/lib/fleet/server-runtime";
import { getDb } from "@/lib/fleet/db/db";
import { listRuns } from "@/lib/fleet/db/runs-repo";

// Node runtime: the orchestrator spawns virsh + ssh child processes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs — enqueue a run and return immediately (status: queued). A worker
// (instrumentation loop or POST /api/runs/process) executes it.
// Body: { workflowId?, params?, branch?, pr? }.
export async function POST(req: Request) {
  let workflowId: string | undefined;
  let params: Record<string, string | number | boolean | null> | undefined;
  let branchRef: string | undefined;
  let prRef: string | undefined;
  try {
    const body = (await req.json()) as {
      workflowId?: string;
      params?: Record<string, string | number | boolean | null>;
      branch?: string;
      pr?: string | number;
    };
    workflowId = body.workflowId;
    params = body.params;
    branchRef = body.branch;
    prRef = body.pr != null ? String(body.pr) : undefined;
  } catch {
    // no body — default workflow, no params
  }
  const run = enqueueManualRun(workflowId, { params, triggerSource: "manual", branchRef, prRef });
  return Response.json(run, { status: 202 });
}

// GET /api/runs?branch=&pr=&limit= — recent run summaries, newest first.
// `limit` is bounded so a page cannot ask for the whole table by accident.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const branchRef = url.searchParams.get("branch") ?? undefined;
  const prRef = url.searchParams.get("pr") ?? undefined;
  const asked = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 500) : 50;
  return Response.json(listRuns(getDb(), limit, { branchRef, prRef }));
}
