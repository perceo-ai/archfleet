import { getDb } from "@/lib/fleet/db/db";
import { actOnSession, isSessionError } from "@/lib/fleet/session-runtime";
import { DESKTOP_ACTIONS } from "@/lib/fleet/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sessions/:id/act — run a batch of desktop primitives on a leased
// desktop. Body: { actions: [{click:[x,y]}, {type:"…"}, {screenshot:true}, …] }
//
// The batch is validated as a whole before anything runs: a half-applied batch
// would leave the caller's model of the screen silently wrong. Every call renews
// the lease, so an agent that keeps working keeps its desktop.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { actions?: unknown };
  if (body.actions === undefined) {
    return Response.json(
      { error: "actions is required", vocabulary: DESKTOP_ACTIONS },
      { status: 400 },
    );
  }
  const result = await actOnSession(getDb(), id, body.actions);
  if (isSessionError(result)) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
