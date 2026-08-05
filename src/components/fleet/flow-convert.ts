// Pure conversion between the domain Workflow graph and React Flow's node/edge
// shape. Kept free of React so it is unit tested directly.

import type { Workflow, WorkflowEdge, WorkflowNode } from "@/lib/fleet/types";

export type FlowNode = {
  id: string;
  position: { x: number; y: number };
  data: { wnode: WorkflowNode };
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  data: { condition: WorkflowEdge["condition"] };
};

export function workflowToFlow(wf: Workflow): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: wf.nodes.map((n) => ({ id: n.id, position: n.position, data: { wnode: n } })),
    edges: wf.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      data: { condition: e.condition },
    })),
  };
}

export function flowToWorkflow(base: Workflow, nodes: FlowNode[], edges: FlowEdge[]): Workflow {
  return {
    ...base,
    nodes: nodes.map((fn) => ({ ...fn.data.wnode, id: fn.id, position: fn.position })),
    edges: edges.map((fe) => ({
      id: fe.id,
      from: fe.source,
      to: fe.target,
      condition: fe.data?.condition ?? "success",
    })),
  };
}

let counter = 0;
/** Build a new node of a given type at a position. */
export function makeNode(
  type: WorkflowNode["type"],
  position = { x: 120, y: 120 },
): WorkflowNode {
  const id = `node_${type}_${counter++}`;
  return { id, type, name: type.replaceAll("_", " "), position, config: {} };
}
