import { seedFleetState } from "@/lib/fleet/seed";
import { executeManualRun } from "@/lib/fleet/server-runtime";

// Node runtime: the orchestrator spawns virsh + ssh child processes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs — start a manual run of the seed workflow through the REAL
// orchestrator. Returns the resulting WorkflowRun (queued when no VM is live).
export async function POST() {
  const state = seedFleetState();
  const run = await executeManualRun(state, state.workflows[0]);
  return Response.json(run);
}
