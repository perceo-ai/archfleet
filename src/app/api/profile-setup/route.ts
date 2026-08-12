import { getDb } from "@/lib/fleet/db/db";
import { saveWorkflow } from "@/lib/fleet/db/workflows-repo";
import { createProfileSetupWorkflow } from "@/lib/fleet/profile-setup-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/profile-setup — create a draft setup workflow for a task golden VM.
// Body: { profile, task, save?: boolean, id?: string }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    profile?: string;
    task?: string;
    save?: boolean;
    id?: string;
  };
  if (!body.profile) return Response.json({ error: "profile is required" }, { status: 400 });
  if (!body.task) return Response.json({ error: "task is required" }, { status: 400 });

  const slug = body.profile.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  const workflow = createProfileSetupWorkflow({
    id: body.id ?? `wf_profile_setup_${slug || "profile"}`,
    profile: body.profile,
    task: body.task,
  });
  if (body.save) saveWorkflow(getDb(), workflow);
  return Response.json({ workflow });
}
