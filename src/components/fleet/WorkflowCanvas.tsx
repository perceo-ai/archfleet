"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { NodeKind, Workflow, WorkflowNode } from "@/lib/fleet/types";
import { flowToWorkflow, makeNode, type FlowEdge, type FlowNode } from "./flow-convert";

type WorkflowCanvasProps = {
  workflow: Workflow;
  onSave?: (wf: Workflow) => Promise<{ ok: boolean; errors?: string[] }>;
};

const nodeTone: Record<string, string> = {
  start: "border-emerald-400 bg-emerald-50",
  computer_use_task: "border-violet-400 bg-violet-50",
  cli_agent_task: "border-blue-400 bg-blue-50",
  shell_task: "border-slate-400 bg-slate-50",
  condition: "border-yellow-400 bg-yellow-50",
  human_takeover: "border-amber-400 bg-amber-50",
  end: "border-zinc-400 bg-zinc-50",
};

const PALETTE: NodeKind[] = [
  "computer_use_task",
  "cli_agent_task",
  "shell_task",
  "condition",
  "human_takeover",
  "end",
];

function toRfNode(n: WorkflowNode): Node {
  return {
    id: n.id,
    position: n.position,
    data: { wnode: n, label: n.name },
    className: `rounded border px-3 py-2 text-xs shadow-sm ${nodeTone[n.type] ?? "border-zinc-300 bg-white"}`,
  };
}

export function WorkflowCanvas({ workflow, onSave }: WorkflowCanvasProps) {
  const initial = useMemo(() => workflow, [workflow]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial.nodes.map(toRfNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.condition, data: { condition: e.condition } })),
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [status, setStatus] = useState<string>();

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge({ ...c, label: "success", data: { condition: "success" } }, eds),
      ),
    [setEdges],
  );

  const selected = nodes.find((n) => n.id === selectedId);
  const selectedNode = selected?.data?.wnode as WorkflowNode | undefined;

  function patchSelected(patch: Partial<WorkflowNode>) {
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== selectedId) return n;
        const wnode = { ...(n.data.wnode as WorkflowNode), ...patch };
        return { ...n, data: { ...n.data, wnode, label: wnode.name } };
      }),
    );
  }

  function addNode(type: NodeKind) {
    // Cascade new nodes so they don't stack exactly on top of each other.
    setNodes((ns) => {
      const wnode = makeNode(type, { x: 80 + (ns.length % 5) * 40, y: 60 + (ns.length % 7) * 40 });
      return [...ns, toRfNode(wnode)];
    });
  }

  function deleteSelected() {
    if (!selectedId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(undefined);
  }

  async function save() {
    if (!onSave) return;
    const wf = flowToWorkflow(
      workflow,
      nodes.map((n) => ({ id: n.id, position: n.position, data: n.data as FlowNode["data"] })),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: (e.data ?? { condition: "success" }) as FlowEdge["data"] })),
    );
    setStatus("Saving…");
    const res = await onSave(wf);
    setStatus(res.ok ? "Saved" : `Invalid: ${(res.errors ?? []).join("; ")}`);
  }

  return (
    <section className="min-h-0 bg-zinc-100">
      <div className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">{workflow.name}</h2>
          <p className="text-xs text-zinc-500">{status ?? workflow.description}</p>
        </div>
        <div className="flex items-center gap-1">
          {PALETTE.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addNode(t)}
              title={`Add ${t}`}
              className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-600 hover:bg-zinc-50"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {t.replaceAll("_", " ")}
            </button>
          ))}
          {onSave ? (
            <button
              type="button"
              onClick={save}
              className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              Save
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_220px]">
        <div className="h-[420px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(undefined)}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="h-[420px] overflow-y-auto border-l border-zinc-200 bg-white p-3 text-xs">
          {selectedNode ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-zinc-500">Node</span>
                <button type="button" onClick={deleteSelected} className="text-red-600 hover:text-red-700">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <label className="block">
                <span className="text-zinc-500">Name</span>
                <input
                  value={selectedNode.name}
                  onChange={(e) => patchSelected({ name: e.target.value })}
                  className="mt-0.5 w-full rounded border border-zinc-200 px-1.5 py-1"
                />
              </label>
              <label className="block">
                <span className="text-zinc-500">Type</span>
                <select
                  value={selectedNode.type}
                  onChange={(e) => patchSelected({ type: e.target.value as NodeKind })}
                  className="mt-0.5 w-full rounded border border-zinc-200 px-1.5 py-1"
                >
                  {["start", ...PALETTE].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-zinc-500">Prompt / command</span>
                <textarea
                  value={selectedNode.config.prompt ?? ""}
                  onChange={(e) => patchSelected({ config: { ...selectedNode.config, prompt: e.target.value } })}
                  rows={4}
                  className="mt-0.5 w-full rounded border border-zinc-200 px-1.5 py-1"
                />
              </label>
            </div>
          ) : (
            <p className="text-zinc-500">Click a node to edit. Drag between handles to connect. Add nodes above.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
