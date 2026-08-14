import { getDb } from "@/lib/fleet/db/db";
import {
  addEvidence,
  listEvidenceByAutomation,
  listEvidenceByRun,
  listEvidenceByRunAssociation,
} from "@/lib/fleet/db/evidence-repo";
import type { EvidenceItem, EvidenceType } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evidence?runId=|automationId=|pr=|branch=&type= — evidence for a run,
// an automation, or every run associated with a PR/branch (release checks).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  const automationId = url.searchParams.get("automationId");
  const prRef = url.searchParams.get("pr");
  const branchRef = url.searchParams.get("branch");
  const type = (url.searchParams.get("type") ?? undefined) as EvidenceType | undefined;
  const db = getDb();
  if (runId) return Response.json(listEvidenceByRun(db, runId, { type }));
  if (automationId) return Response.json(listEvidenceByAutomation(db, automationId, { type }));
  if (prRef || branchRef) {
    return Response.json(
      listEvidenceByRunAssociation(db, { prRef: prRef ?? undefined, branchRef: branchRef ?? undefined, type }),
    );
  }
  return Response.json({ error: "runId, automationId, pr or branch is required" }, { status: 400 });
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
