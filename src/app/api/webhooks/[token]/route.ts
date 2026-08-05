import { getDb } from "@/lib/fleet/db/db";
import { makeTriggerExecute } from "@/lib/fleet/server-runtime";
import { runWebhook } from "@/lib/fleet/triggers/triggers-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/:token — fire the webhook trigger matching this token.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const run = await runWebhook(getDb(), token, makeTriggerExecute());
  if (!run) return Response.json({ error: "invalid or disabled webhook token" }, { status: 404 });
  return Response.json(run);
}
