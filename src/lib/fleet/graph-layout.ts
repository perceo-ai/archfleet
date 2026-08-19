// Deterministic layered layout for the automation graph. The graph is the
// primary view of an automation, so it must read the same way every time —
// stored node positions (which the copilot writes loosely) are not trusted.
//
// Two synthetic nodes bracket the real workflow: the trigger that starts it and
// the "done means" node that holds the success criteria. Both are clickable in
// the UI and open their own modal; neither exists in the workflow graph.

import type { EdgeCondition, Workflow, WorkflowNode } from "./types";

export const NODE_W = 230;
export const NODE_H = 56;
const GAP_X = 44;
const GAP_Y = 36;
const PAD = 40;

export const TRIGGER_NODE_ID = "__trigger";
export const DONE_NODE_ID = "__done";

export type LaidOutNode = {
  id: string;
  name: string;
  /** Workflow node kind, or a synthetic marker. */
  kind: WorkflowNode["type"] | "trigger" | "done";
  x: number;
  y: number;
  node?: WorkflowNode;
  synthetic: boolean;
};

export type LaidOutEdge = {
  id: string;
  from: string;
  to: string;
  condition: EdgeCondition;
};

export type GraphLayout = {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
};

/** Depth of each node: longest path from an entry node, so branches that rejoin
 * land below everything they depend on instead of overlapping it. */
function depths(nodes: WorkflowNode[], edges: { from: string; to: string }[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.to) || !outgoing.has(e.from)) continue;
    incoming.get(e.to)!.push(e.from);
    outgoing.get(e.from)!.push(e.to);
  }

  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Relax edges |nodes| times; cycles simply stop moving once they stabilise.
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (!depth.has(e.from) || !depth.has(e.to)) continue;
      const candidate = depth.get(e.from)! + 1;
      if (candidate > depth.get(e.to)!) {
        depth.set(e.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

export function entryNodeIds(workflow: Workflow): string[] {
  const targeted = new Set(workflow.edges.map((e) => e.to));
  const entries = workflow.nodes.filter((n) => !targeted.has(n.id)).map((n) => n.id);
  return entries.length ? entries : workflow.nodes.slice(0, 1).map((n) => n.id);
}

/** Nodes nothing leaves — where the "done means" node attaches. */
function exitNodeIds(workflow: Workflow): string[] {
  const sources = new Set(workflow.edges.map((e) => e.from));
  const exits = workflow.nodes.filter((n) => !sources.has(n.id)).map((n) => n.id);
  return exits.length ? exits : workflow.nodes.slice(-1).map((n) => n.id);
}

export function layoutGraph(workflow: Workflow | undefined | null): GraphLayout {
  const nodes = workflow?.nodes ?? [];
  const edges = workflow?.edges ?? [];

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: NODE_W + PAD * 2, height: NODE_H + PAD * 2 };
  }

  const depth = depths(nodes, edges);
  const rows = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(n);
  }

  const rowIndexes = [...rows.keys()].sort((a, b) => a - b);
  const widest = Math.max(...rowIndexes.map((r) => rows.get(r)!.length));
  const contentW = widest * NODE_W + (widest - 1) * GAP_X;
  const width = contentW + PAD * 2;

  const laid: LaidOutNode[] = [];

  // Row 0 is the synthetic trigger; the workflow starts one row below it.
  const triggerY = PAD;
  laid.push({
    id: TRIGGER_NODE_ID,
    name: "Trigger",
    kind: "trigger",
    x: PAD + (contentW - NODE_W) / 2,
    y: triggerY,
    synthetic: true,
  });

  for (const r of rowIndexes) {
    const row = rows.get(r)!;
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = PAD + (contentW - rowW) / 2;
    row.forEach((n, i) => {
      laid.push({
        id: n.id,
        name: n.name,
        kind: n.type,
        x: startX + i * (NODE_W + GAP_X),
        y: triggerY + (rowIndexes.indexOf(r) + 1) * (NODE_H + GAP_Y),
        node: n,
        synthetic: false,
      });
    });
  }

  const doneY = triggerY + (rowIndexes.length + 1) * (NODE_H + GAP_Y);
  laid.push({
    id: DONE_NODE_ID,
    name: "Done means",
    kind: "done",
    x: PAD + (contentW - NODE_W) / 2,
    y: doneY,
    synthetic: true,
  });

  const laidEdges: LaidOutEdge[] = [
    ...entryNodeIds(workflow!).map((to) => ({
      id: `${TRIGGER_NODE_ID}->${to}`,
      from: TRIGGER_NODE_ID,
      to,
      condition: "always" as const,
    })),
    ...edges.map((e) => ({ id: e.id, from: e.from, to: e.to, condition: e.condition })),
    ...exitNodeIds(workflow!).map((from) => ({
      id: `${from}->${DONE_NODE_ID}`,
      from,
      to: DONE_NODE_ID,
      condition: "always" as const,
    })),
  ];

  return { nodes: laid, edges: laidEdges, width, height: doneY + NODE_H + PAD };
}

/** Cubic path between two laid-out nodes, bottom-centre to top-centre. */
export function edgePath(from: LaidOutNode, to: LaidOutNode): string {
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y - 4;
  if (Math.abs(x1 - x2) < 1) return `M${x1} ${y1} V${y2}`;
  const mid = y1 + (y2 - y1) / 2;
  return `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
}
