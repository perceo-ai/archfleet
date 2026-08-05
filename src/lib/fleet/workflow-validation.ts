// Structural validation for a workflow graph. Returns a list of human-readable
// errors (empty = valid). Used to reject bad graphs at the API / MCP boundary.

import type { Workflow } from "./types";

export function validateWorkflow(wf: Partial<Workflow>): string[] {
  const errors: string[] = [];
  if (!wf.id) errors.push("workflow.id is required");
  if (!wf.name) errors.push("workflow.name is required");

  const nodes = wf.nodes ?? [];
  const edges = wf.edges ?? [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push("workflow has no nodes");
    return errors;
  }

  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
  }

  if (!nodes.some((n) => n.type === "start")) errors.push("workflow needs a start node");
  if (!nodes.some((n) => n.type === "end")) errors.push("workflow needs an end node");

  for (const e of edges) {
    if (!ids.has(e.from)) errors.push(`edge ${e.id} references unknown 'from' node: ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge ${e.id} references unknown 'to' node: ${e.to}`);
  }

  // Reachability from a start node (task nodes that can never run are a bug).
  const start = nodes.find((n) => n.type === "start");
  if (start) {
    const adj = new Map<string, string[]>();
    for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    const seen = new Set<string>();
    const stack = [start.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of adj.get(id) ?? []) stack.push(next);
    }
    for (const n of nodes) {
      if (n.type !== "start" && !seen.has(n.id)) {
        errors.push(`node "${n.name}" (${n.id}) is unreachable from start`);
      }
    }
  }

  return errors;
}
