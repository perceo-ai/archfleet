// Small, targeted workflow-graph edits driven by run recovery: inserting a human
// takeover point before a failing step, and finding where to resume after one.
// Pure functions over the Workflow shape — persistence stays in the caller.

import type { Workflow, WorkflowNode } from "./types";

/** Find a node by its display name (run.currentStep stores names, not ids). */
export function findNodeByName(workflow: Workflow, name: string | undefined): WorkflowNode | undefined {
  return name ? workflow.nodes.find((n) => n.name === name) : undefined;
}

/** The node a run should continue from once the takeover at `nodeId` is done:
 * the success (or always) edge target out of that node. */
export function nodeAfter(workflow: Workflow, nodeId: string): WorkflowNode | undefined {
  const edge =
    workflow.edges.find((e) => e.from === nodeId && e.condition === "success") ??
    workflow.edges.find((e) => e.from === nodeId && e.condition === "always");
  return edge ? workflow.nodes.find((n) => n.id === edge.to) : undefined;
}

/** Insert a human_takeover node in front of `targetNodeId`, rewiring every
 * incoming edge through it. No-op (returns the workflow unchanged) when a
 * takeover already sits directly before the target. Returns undefined when the
 * target does not exist. */
export function insertTakeoverBefore(
  workflow: Workflow,
  targetNodeId: string,
  requestedAction?: string,
): Workflow | undefined {
  const target = workflow.nodes.find((n) => n.id === targetNodeId);
  if (!target) return undefined;
  const alreadyGuarded = workflow.nodes.some(
    (n) =>
      n.type === "human_takeover" &&
      workflow.edges.some((e) => e.from === n.id && e.to === targetNodeId),
  );
  if (alreadyGuarded) return workflow;

  const takeover: WorkflowNode = {
    id: `takeover_before_${targetNodeId}`,
    type: "human_takeover",
    name: `Human takeover before "${target.name}"`,
    position: { x: target.position.x - 60, y: target.position.y - 80 },
    config: {
      prompt:
        requestedAction ??
        `Do the part the agent gets stuck on before "${target.name}" (login, MFA, captcha), then resume.`,
    },
  };
  const edges = workflow.edges.map((e) => (e.to === targetNodeId ? { ...e, to: takeover.id } : e));
  edges.push({
    id: `edge_${takeover.id}_${targetNodeId}`,
    from: takeover.id,
    to: targetNodeId,
    condition: "success",
  });
  return { ...workflow, nodes: [...workflow.nodes, takeover], edges };
}
