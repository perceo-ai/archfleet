import { getDb } from "@/lib/fleet/db/db";
import { listEvidenceByAutomation, listEvidenceByRun } from "@/lib/fleet/db/evidence-repo";
import { addEvidence } from "@/lib/fleet/db/evidence-repo";
import type { EvidenceItem, EvidenceType } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evidence?runId=|automationId=&type= — evidence for a run or automation.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  const automationId = url.searchParams.get("automationId");
  const type = (url.searchParams.get("type") ?? undefined) as EvidenceType | undefined;
  const db = getDb();
  if (runId) return Response.json(listEvidenceByRun(db, runId, { type }));
  if (automationId) return Response.json(listEvidenceByAutomation(db, automationId, { type }));
  return Response.json({ error: "runId or automationId is required" }, { status: 400 });
}

// POST /api/evidence — record a human review (or other manual evidence) for a run.
// Body: { runId, type, description, verdict?, automationId?, stepId?, artifactRef? }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<EvidenceItem>;
  if (!body.runId || !body.type || !body.description) {
    return Response.json({ error: "runId, type and description are required" }, { status: 400 });
  }
  const item: EvidenceItem = {
    id: body.id ?? `ev_manual_${body.runId}_${Date.now()}`,
    runId: body.runId,
    automationId: body.automationId,
    type: body.type,
    artifactRef: body.artifactRef,
    stepId: body.stepId,
    description: body.description,
    verdict: body.verdict,
    createdAt: body.createdAt ?? new Date().toISOString(),
  };
  addEvidence(getDb(), item);
  return Response.json(item, { status: 201 });
}
