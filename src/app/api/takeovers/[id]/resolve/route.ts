import { getDb } from "@/lib/fleet/db/db";
import { getTakeover, resolveTakeover } from "@/lib/fleet/db/takeovers-repo";
import { cancelRun, getRun } from "@/lib/fleet/db/runs-repo";
import { resumeRunAfterPause } from "@/lib/fleet/run-resume";
import { applyAskAnswers } from "@/lib/fleet/ask-answers";
import { parseAsk, splitAnswers, summarizeAnswers, validateAnswers } from "@/lib/fleet/human-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/takeovers/:id/resolve — the human answered the run's question.
// Body: { answers?: Record<string,string>, operatorNotes?, action?: "resume" | "cancel" }.
//
// Answers are validated against the takeover's own ask, then landed in the run:
// plain values as run params, values the ask marked secret as run-scoped secrets.
// "resume" re-queues the paused run; "cancel" stops it; omitted = just close it.
// The run transition happens BEFORE the takeover is resolved: if the run already
// moved on, the takeover stays open and the caller gets a 409 instead of a silent
// success that would orphan a paused run.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const takeover = getTakeover(db, id);
  if (!takeover) return Response.json({ error: "takeover not found" }, { status: 404 });
  if (takeover.status !== "open") {
    return Response.json({ error: "takeover already resolved" }, { status: 409 });
  }
  const { operatorNotes, action, answers } = (await req.json().catch(() => ({}))) as {
    operatorNotes?: string;
    action?: "resume" | "cancel";
    answers?: Record<string, string>;
  };
  // A paused run must be transitioned, not just have its takeover closed —
  // otherwise it disappears from needs-human lists while still paused.
  if (!action && getRun(db, takeover.runId)?.status === "paused") {
    return Response.json(
      { error: "run is still paused — pass action: \"resume\" or \"cancel\"" },
      { status: 400 },
    );
  }

  const ask = parseAsk(takeover.ask ?? takeover.requestedAction, takeover.reason);
  const supplied = answers ?? {};

  // Only an answer that lets the run continue has to satisfy the ask. Cancelling
  // is always allowed — you should never have to fill in a form to stop a run.
  if (action !== "cancel") {
    const errors = validateAnswers(ask, supplied);
    if (errors.length) return Response.json({ error: errors.join(" "), errors }, { status: 400 });
    const landed = applyAskAnswers(db, takeover.runId, ask, supplied);
    // Resuming without a value the run explicitly asked for would fail further
    // down, in a place with far less context. Stay paused and say why.
    if (landed.dropped.length) {
      return Response.json(
        {
          error: `Cannot store ${landed.dropped.join(", ")} securely — set CUF_SECRET_KEY on the server. The run is still paused.`,
          dropped: landed.dropped,
        },
        { status: 503 },
      );
    }
  }

  // Continue *after* the step that asked — a bare re-queue would re-run the
  // takeover node and ask the same question again.
  if (action === "resume" && !resumeRunAfterPause(db, takeover.runId)) {
    return Response.json({ error: "run not in a state to resume" }, { status: 409 });
  }
  if (action === "cancel" && !cancelRun(db, takeover.runId)) {
    return Response.json({ error: "run not in a state to cancel" }, { status: 409 });
  }

  // Secret answers are recorded as "supplied", never as their value.
  const notes =
    action === "cancel"
      ? operatorNotes
      : [operatorNotes, summarizeAnswers(ask, supplied)].filter(Boolean).join(" · ");
  resolveTakeover(db, id, {
    operatorNotes: notes || undefined,
    answers: splitAnswers(ask, supplied).params,
  });
  return Response.json(getTakeover(db, id));
}
