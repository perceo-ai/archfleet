import { getDb } from "@/lib/fleet/db/db";
import { captureSession, isSessionError } from "@/lib/fleet/session-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sessions/:id/capture — promote a persist session's desktop back into
// its profile: re-snapshot the source, re-clone the pool. Every later run then
// starts from the new sign-in.
//
// This is how a session that logs into a new site, or replaces a cookie that
// died six weeks in, becomes permanent — without rebuilding the profile.
//
// Returns the profile operation id; it is long-running, streams its logs through
// /api/profile-ops/:id, and stops for a human to confirm the capture.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { clones?: number };
  const result = captureSession(getDb(), id, { clones: body.clones });
  if (isSessionError(result)) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result, { status: 202 });
}
