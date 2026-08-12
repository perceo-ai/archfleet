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
  className?: string;
};

const nodeTone: Record<string, string> = {
  start: "border-emerald-300 bg-emerald-50",
  computer_use_task: "border-stone-300 bg-stone-50",
  script_task: "border-stone-300 bg-stone-50",
  browser_task: "border-sky-300 bg-sky-50",
  cli_agent_task: "border-stone-300 bg-stone-50",
  shell_task: "border-stone-300 bg-stone-50",
  api_call: "border-cyan-300 bg-cyan-50",
  otp_email: "border-amber-300 bg-amber-50",
  condition: "border-yellow-300 bg-yellow-50",
  retry_wait: "border-lime-300 bg-lime-50",
  human_takeover: "border-orange-300 bg-orange-50",
  end: "border-zinc-300 bg-white",
};

const PALETTE: NodeKind[] = [
  "computer_use_task",
  "script_task",
  "browser_task",
  "cli_agent_task",
  "shell_task",
  "api_call",
  "otp_email",
  "condition",
  "retry_wait",
  "human_takeover",
  "end",
];

function toRfNode(n: WorkflowNode): Node {
  return {
    id: n.id,
    position: n.position,
    data: { wnode: n, label: n.name },
    className: `rounded-md border px-3 py-2 text-xs shadow-sm shadow-stone-200/60 ${nodeTone[n.type] ?? "border-zinc-300 bg-white"}`,
  };
}

export function WorkflowCanvas({ workflow, onSave, className = "" }: WorkflowCanvasProps) {
  const initial = useMemo(() => workflow, [workflow]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial.nodes.map(toRfNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.condition, data: { condition: e.condition } })),
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [nodeType, setNodeType] = useState<NodeKind>("cli_agent_task");

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
    <section className={`grid min-h-0 grid-rows-[48px_minmax(0,1fr)] bg-[#f7f4ef] ${className}`}>
      <div className="flex min-w-0 items-center justify-between border-b border-stone-200 bg-white px-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">Graph editor</h2>
          <p className="truncate text-xs text-zinc-500">{status ?? workflow.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as NodeKind)}
            aria-label="Step type"
            className="h-8 w-36 rounded-md border border-stone-200 bg-white px-2 text-xs text-zinc-700 outline-none focus:border-zinc-500"
          >
            {PALETTE.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => addNode(nodeType)}
            title="Add step"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 text-zinc-700 hover:bg-stone-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          {onSave ? (
            <button
              type="button"
              onClick={save}
              title="Save graph"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-950 text-white hover:bg-zinc-800"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0">
        <div className="h-full min-h-[320px]">
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
            <Background color="#d8d0c4" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="absolute bottom-3 left-3 w-[min(440px,calc(100%-24px))] rounded-md border border-stone-200 bg-white/95 p-3 text-xs shadow-sm backdrop-blur">
          {selectedNode ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-zinc-500">Selected step</span>
                <button type="button" onClick={deleteSelected} className="text-red-600 hover:text-red-700">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="grid grid-cols-[1fr_150px] gap-2">
                <label className="block">
                  <span className="text-zinc-500">Name</span>
                  <input
                    value={selectedNode.name}
                    onChange={(e) => patchSelected({ name: e.target.value })}
                    className="mt-0.5 h-8 w-full rounded-md border border-stone-200 px-2 text-zinc-900 outline-none focus:border-zinc-500"
                  />
                </label>
                <label className="block">
                  <span className="text-zinc-500">Type</span>
                  <select
                    value={selectedNode.type}
                    onChange={(e) => patchSelected({ type: e.target.value as NodeKind })}
                    className="mt-0.5 h-8 w-full rounded-md border border-stone-200 px-2 text-zinc-900 outline-none focus:border-zinc-500"
                  >
                    {["start", ...PALETTE].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-zinc-500">Instruction</span>
                <textarea
                  value={selectedNode.config.prompt ?? ""}
                  onChange={(e) => patchSelected({ config: { ...selectedNode.config, prompt: e.target.value } })}
                  rows={3}
                  className="mt-0.5 w-full rounded-md border border-stone-200 px-2 py-1.5 text-zinc-900 outline-none focus:border-zinc-500"
                />
              </label>
            </div>
          ) : (
            <p className="text-zinc-500">Select a step to edit it. Drag between handles to connect steps.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
