import { getDb } from "@/lib/fleet/db/db";
import {
  automationHealth,
  listAutomations,
  saveAutomation,
} from "@/lib/fleet/db/automations-repo";
import { getWorkflow, saveWorkflow } from "@/lib/fleet/db/workflows-repo";
import { validateWorkflow } from "@/lib/fleet/workflow-validation";
import type { Automation, AutomationStatus, Workflow } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/automations?status=&category= — automations with derived health + last run.
export async function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const automations = listAutomations(db, {
    status: status as AutomationStatus | undefined,
    category,
  }).map((a) => ({ ...a, ...automationHealth(db, a.id) }));
  return Response.json(automations);
}

// POST /api/automations — create/replace an automation, optionally with its workflow.
// Body: { automation: Automation, workflow?: Workflow }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    automation?: Automation;
    workflow?: Workflow;
  };
  if (!body.automation?.id || !body.automation.name || !body.automation.workflowId) {
    return Response.json(
      { error: "automation with id, name and workflowId is required" },
      { status: 400 },
    );
  }
  const db = getDb();
  if (body.workflow) {
    const errors = validateWorkflow(body.workflow);
    if (errors.length) return Response.json({ error: "invalid workflow", errors }, { status: 400 });
    saveWorkflow(db, body.workflow);
  } else if (!getWorkflow(db, body.automation.workflowId)) {
    // Without a resolvable workflow the automation would run the seed workflow
    // while attributing runs/evidence to itself.
    return Response.json(
      { error: `workflow ${body.automation.workflowId} not found — include it in the request or save it first` },
      { status: 400 },
    );
  }
  saveAutomation(db, body.automation);
  return Response.json({ id: body.automation.id }, { status: 201 });
}
