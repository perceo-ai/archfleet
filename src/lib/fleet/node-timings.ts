// Per-node durations, read out of the run's own event timestamps. The
// orchestrator logs `Running <kind> node "x" on <vm>` when a node starts and
// `Node "x" succeeded/failed …` when it ends, so the gap between them is the
// node's real wall-clock time. Nodes without both markers are simply absent.

import type { Workflow, WorkflowRun } from "./types";

const START = /Running \w+ node "([^"]+)"/;
const END = /Node "([^"]+)" (?:succeeded|failed)/;

/** Node id -> milliseconds spent in that node during this run. */
export function nodeDurations(
  run: WorkflowRun | undefined | null,
  workflow: Workflow | undefined | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!run || !workflow) return out;
  const idByName = new Map(workflow.nodes.map((n) => [n.name, n.id]));
  const startedAt = new Map<string, number>();

  for (const event of run.events) {
    const time = new Date(event.timestamp).getTime();
    if (Number.isNaN(time)) continue;

    const startName = START.exec(event.message)?.[1];
    if (startName && idByName.has(startName)) {
      startedAt.set(startName, time);
      continue;
    }

    const endName = END.exec(event.message)?.[1];
    if (!endName || !idByName.has(endName)) continue;
    const start = startedAt.get(endName);
    if (start != null) {
      out.set(idByName.get(endName)!, Math.max(0, time - start));
      startedAt.delete(endName);
    }
  }
  return out;
}

/** "4s" / "1m 12s" — compact enough for a badge hanging off a node. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
