import { getDb } from "@/lib/fleet/db/db";
import { closeSession, getSessionView, isSessionError } from "@/lib/fleet/session-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sessions/:id — one session. For a task session this carries the run
// underneath (status, events, artifacts, and any open question), so an agent
// polls a single object instead of correlating a session with a run.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = getSessionView(getDb(), id);
  if (!view) return Response.json({ error: "session not found" }, { status: 404 });
  return Response.json(view);
}

// DELETE /api/sessions/:id — close it and hand the desktop back.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const closed = await closeSession(getDb(), id);
  if (isSessionError(closed)) {
    return Response.json({ error: closed.error }, { status: closed.status });
  }
  return Response.json(closed);
}
