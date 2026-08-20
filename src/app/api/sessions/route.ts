import { getDb } from "@/lib/fleet/db/db";
import { isSessionError, listSessionViews, openSession } from "@/lib/fleet/session-runtime";
import type { SessionMode } from "@/lib/fleet/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: SessionMode[] = ["task", "lease", "persist"];

// GET /api/sessions?open=1&environmentId=… — computer-use sessions held by agents.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  return Response.json(
    listSessionViews(getDb(), {
      open: params.get("open") === "1",
      environmentId: params.get("environmentId") ?? undefined,
    }),
  );
}

// POST /api/sessions — open a computer-use session on a prepared environment.
// Body: { environmentId, mode: "task"|"lease"|"persist", task?, ttlMs?, openedBy? }
//
//   task     archfleet drives: the request becomes a run, so it gets takeover,
//            evidence, secrets and redaction. Poll GET /api/sessions/:id.
//   lease    the caller drives a clean desktop via POST /api/sessions/:id/act.
//   persist  the caller drives the profile's SOURCE desktop, changes survive, and
//            POST /api/sessions/:id/capture folds them back into the profile.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    environmentId?: string;
    mode?: string;
    task?: string;
    ttlMs?: number;
    openedBy?: string;
  };
  if (!body.environmentId) {
    return Response.json({ error: "environmentId is required" }, { status: 400 });
  }
  const mode = (body.mode ?? "task") as SessionMode;
  if (!MODES.includes(mode)) {
    return Response.json({ error: `mode must be one of ${MODES.join(", ")}` }, { status: 400 });
  }

  const session = await openSession(
    {
      environmentId: body.environmentId,
      mode,
      task: body.task,
      ttlMs: body.ttlMs,
      openedBy: body.openedBy,
    },
    { db: getDb() },
  );
  if (isSessionError(session)) {
    return Response.json({ error: session.error }, { status: session.status });
  }
  return Response.json(session, { status: 201 });
}
