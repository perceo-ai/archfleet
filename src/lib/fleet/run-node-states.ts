// Paint a run onto the graph. Node state is read out of the run's own events —
// the orchestrator names every node it touches (`Node "x" succeeded (...)`) — so
// nothing here is guessed: a node it never mentions stays "not reached".

import type { Workflow, WorkflowRun } from "./types";

export type NodeRunState = "ok" | "fail" | "human" | "live" | "idle";

const NODE_NAME = /(?:Node|Condition|Shell|Running \w+ node) "([^"]+)"/;

/** Precedence: an explicit failure beats a pause beats a live marker beats a pass. */
const RANK: Record<NodeRunState, number> = { idle: 0, ok: 1, live: 2, human: 3, fail: 4 };

function raise(
  map: Map<string, NodeRunState>,
  id: string | undefined,
  state: NodeRunState,
): void {
  if (!id) return;
  const current = map.get(id) ?? "idle";
  if (RANK[state] >= RANK[current]) map.set(id, state);
}

/** Per-node state for one run, keyed by workflow node id. */
export function runNodeStates(
  run: WorkflowRun | undefined | null,
  workflow: Workflow | undefined | null,
): Map<string, NodeRunState> {
  const states = new Map<string, NodeRunState>();
  if (!run || !workflow) return states;

  const idByName = new Map(workflow.nodes.map((n) => [n.name, n.id]));

  for (const event of run.events) {
    const name = NODE_NAME.exec(event.message)?.[1];
    const id = name ? idByName.get(name) : undefined;
    if (!id) continue;
    if (/paused for human takeover/i.test(event.message)) raise(states, id, "human");
    else if (event.level === "error" || /\bfailed\b|retries exhausted/i.test(event.message)) {
      raise(states, id, "fail");
    } else raise(states, id, "ok");
  }

  // The step the run is sitting on right now outranks anything inferred above.
  const currentId = idByName.get(run.currentStep ?? "");
  if (currentId) {
    if (run.status === "running" || run.status === "queued") raise(states, currentId, "live");
    if (run.status === "paused") raise(states, currentId, "human");
    if (run.status === "failed") raise(states, currentId, "fail");
  }

  return states;
}

/** How many recent runs failed at each node — the "7 runs failed here" badge. */
export function failureCountsByNode(
  runs: { status: string; currentStep?: string }[],
  workflow: Workflow | undefined | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!workflow) return counts;
  const idByName = new Map(workflow.nodes.map((n) => [n.name, n.id]));
  for (const run of runs) {
    if (run.status !== "failed") continue;
    const id = idByName.get(run.currentStep ?? "");
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
