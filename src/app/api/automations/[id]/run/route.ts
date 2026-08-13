import { getDb } from "@/lib/fleet/db/db";
import { getAutomation } from "@/lib/fleet/db/automations-repo";
import { enqueueManualRun } from "@/lib/fleet/server-runtime";

// Node runtime: the orchestrator spawns virsh + ssh child processes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/automations/:id/run — enqueue a run of this automation (202).
// Body: { params?, branch?, pr? } — optional run-level params + PR/branch association.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const automation = getAutomation(db, id);
  if (!automation) return Response.json({ error: "automation not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    params?: Record<string, string | number | boolean | null>;
    branch?: string;
    pr?: string | number;
  };
  const run = enqueueManualRun(automation.workflowId, {
    db,
    params: body.params,
    automationId: automation.id,
    environmentId: automation.environmentId,
    triggerSource: "manual",
    branchRef: body.branch,
    prRef: body.pr != null ? String(body.pr) : undefined,
  });
  return Response.json(run, { status: 202 });
}
