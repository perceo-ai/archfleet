import { getDb } from "@/lib/fleet/db/db";
import { getRun, setRunOutcome, setRunStatus } from "@/lib/fleet/db/runs-repo";
import { getOpenTakeoverForRun, openTakeover } from "@/lib/fleet/db/takeovers-repo";
import { parseAsk } from "@/lib/fleet/human-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs/:id/ask — the run stops and asks a human for something.
//
// This is the general form of "human takeover": any executor (a computer-use
// agent that hit an unexpected screen, a CLI agent that needs a decision, an
// api_call that got a 402) can raise a structured question and have the answer
// handed back to the run. Body is a HumanAsk:
//   { kind?, question, detail?, fields?: [{name,label,type,secret?}], options?: [...] }
// Anything unparseable degrades to a plain "a human needs to look at this".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const run = getRun(db, id);
  if (!run) return Response.json({ error: "run not found" }, { status: 404 });
  if (run.status !== "running" && run.status !== "queued" && run.status !== "paused") {
    return Response.json(
      { error: `run is ${run.status} — only an in-flight run can ask for help` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => undefined);
  const ask = parseAsk(body, `The run needs a human at "${run.currentStep ?? "this step"}".`);

  const existing = getOpenTakeoverForRun(db, id);
  if (existing) {
    return Response.json({ takeover: existing, alreadyOpen: true }, { status: 200 });
  }

  // Hold the desktop where it is, so the human lands on the same screen.
  if (run.status !== "paused") {
    setRunStatus(db, id, "paused");
    setRunOutcome(db, id, { pausedReason: ask.question });
  }

  const now = new Date().toISOString();
  const takeover = {
    id: `tk_${id}_${now}`,
    runId: id,
    environmentId: run.environmentId,
    vmId: run.vmId,
    reason: `Asked at "${run.currentStep ?? "unknown step"}"`,
    requestedAction: ask.question,
    ask,
    status: "open" as const,
    openedAt: now,
  };
  openTakeover(db, takeover);
  return Response.json({ takeover }, { status: 201 });
}
