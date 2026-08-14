import { draftAutomation } from "@/lib/fleet/automation-draft";
import { spawnAgentExec } from "@/lib/fleet/ssh-exec";
import { getDb } from "@/lib/fleet/db/db";
import { saveAutomation } from "@/lib/fleet/db/automations-repo";
import { saveWorkflow } from "@/lib/fleet/db/workflows-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/automations/draft — turn a plain-language description into a draft
// automation + disabled workflow. Body: { prompt, save?: boolean }.
// Returns { automation, workflow, clarifyingQuestions, warnings, errors }.
export async function POST(req: Request) {
  const { prompt, save } = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    save?: boolean;
  };
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  const draft = await draftAutomation(prompt, spawnAgentExec);
  if (save && draft.errors.length === 0) {
    const db = getDb();
    saveWorkflow(db, draft.workflow);
    saveAutomation(db, draft.automation);
  }
  return Response.json(draft);
}
