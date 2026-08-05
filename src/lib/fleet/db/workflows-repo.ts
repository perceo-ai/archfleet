// Workflow persistence. The visual graph (nodes + edges + trigger kinds) is stored
// as JSON in cuf_workflows; upsert keeps the row current on each save.

import type { Db } from "./db";
import type { Workflow, WorkflowEdge, WorkflowNode, TriggerKind } from "../types";

type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[]; triggerKinds: TriggerKind[] };

export function saveWorkflow(db: Db, wf: Workflow, now = new Date().toISOString()): void {
  const graph: Graph = { nodes: wf.nodes, edges: wf.edges, triggerKinds: wf.triggerKinds };
  const existing = db.prepare("SELECT created_at FROM cuf_workflows WHERE id=?").get(wf.id) as
    | { created_at: string }
    | undefined;
  db.prepare(
    `INSERT OR REPLACE INTO cuf_workflows (id, name, description, enabled, graph_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    wf.id,
    wf.name,
    wf.description,
    wf.enabled ? 1 : 0,
    JSON.stringify(graph),
    existing?.created_at ?? now,
    now,
  );
}

function rowToWorkflow(row: Record<string, unknown>): Workflow {
  const graph = JSON.parse(row.graph_json as string) as Graph;
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    enabled: Boolean(row.enabled),
    triggerKinds: graph.triggerKinds ?? [],
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
  };
}

export function getWorkflow(db: Db, id: string): Workflow | undefined {
  const row = db.prepare("SELECT * FROM cuf_workflows WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToWorkflow(row) : undefined;
}

export function listWorkflows(db: Db): Workflow[] {
  const rows = db.prepare("SELECT * FROM cuf_workflows ORDER BY name").all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToWorkflow);
}
