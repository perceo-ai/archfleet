import { getDb } from "@/lib/fleet/db/db";
import { createTrigger, listTriggers } from "@/lib/fleet/triggers/triggers-repo";
import type { TriggerKind } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/triggers — list all triggers.
export async function GET() {
  return Response.json(listTriggers(getDb()));
}

// POST /api/triggers — create a trigger. Body: { workflowId, type, cron?, config? }.
// A webhook trigger's token is returned ONCE in the response.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    workflowId?: string;
    type?: TriggerKind;
    cron?: string;
    config?: Record<string, unknown>;
  };
  if (!body.workflowId || !body.type) {
    return Response.json({ error: "workflowId and type are required" }, { status: 400 });
  }
  try {
    const result = createTrigger(getDb(), {
      workflowId: body.workflowId,
      type: body.type,
      cron: body.cron,
      config: body.config,
    });
    return Response.json(result, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
