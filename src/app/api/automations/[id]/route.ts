import { getDb } from "@/lib/fleet/db/db";
import {
  activationReadiness,
  automationHealth,
  deleteAutomation,
  getAutomation,
  saveAutomation,
} from "@/lib/fleet/db/automations-repo";
import { getEnvironment } from "@/lib/fleet/db/environments-repo";
import { listRuns } from "@/lib/fleet/db/runs-repo";
import { getWorkflow } from "@/lib/fleet/db/workflows-repo";
import { listTriggers } from "@/lib/fleet/triggers/triggers-repo";
import type { Automation } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/automations/:id — the automation with workflow, environment, triggers,
// recent runs, and derived health. Everything the detail page needs in one call.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const automation = getAutomation(db, id);
  if (!automation) return Response.json({ error: "automation not found" }, { status: 404 });
  return Response.json({
    automation,
    workflow: getWorkflow(db, automation.workflowId),
    environment: automation.environmentId ? getEnvironment(db, automation.environmentId) : undefined,
    triggers: listTriggers(db, automation.workflowId),
    runs: listRuns(db, 20, { automationId: id }),
    activation: activationReadiness(db, automation),
    ...automationHealth(db, id),
  });
}

// PATCH /api/automations/:id — partial update of user-editable fields.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const existing = getAutomation(db, id);
  if (!existing) return Response.json({ error: "automation not found" }, { status: 404 });
  const patch = (await req.json().catch(() => ({}))) as Partial<Automation>;
  // Draft lifecycle gate: drafts only activate after a successful, reviewed run.
  if (patch.status === "active" && existing.status === "draft") {
    const readiness = activationReadiness(db, existing);
    if (!readiness.ok) {
      return Response.json({ error: readiness.reason, activation: readiness }, { status: 409 });
    }
  }
  const editable: (keyof Automation)[] = [
    "name",
    "goal",
    "category",
    "target",
    "specMarkdown",
    "environmentId",
    "successCriteria",
    "requiredSecrets",
    "mfaExpectation",
    "artifactPolicy",
    "retryPolicy",
    "takeoverPolicy",
    "triggerSuggestion",
    "riskNotes",
    "evidenceChecks",
    "status",
  ];
  const updated: Automation = { ...existing };
  for (const key of editable) {
    if (patch[key] !== undefined) {
      (updated as Record<string, unknown>)[key] = patch[key];
    }
  }
  updated.updatedAt = new Date().toISOString();
  saveAutomation(db, updated);
  return Response.json(updated);
}

// DELETE /api/automations/:id — remove the automation (its workflow stays).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteAutomation(getDb(), id);
  if (!ok) return Response.json({ error: "automation not found" }, { status: 404 });
  return Response.json({ ok: true });
}
