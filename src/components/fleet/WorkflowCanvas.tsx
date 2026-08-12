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
import { GitBranchPlus, Plus, Save, Trash2 } from "lucide-react";
import type { NodeKind, Workflow, WorkflowNode } from "@/lib/fleet/types";
import { flowToWorkflow, makeNode, type FlowEdge, type FlowNode } from "./flow-convert";

type WorkflowCanvasProps = {
  workflow: Workflow;
  onSave?: (wf: Workflow) => Promise<{ ok: boolean; errors?: string[] }>;
  className?: string;
};

const nodeTone: Record<string, string> = {
  start: "border-[#4ade80]/40 bg-[#4ade80]/15 text-white",
  computer_use_task: "border-white/[0.12] bg-white/[0.06] text-white",
  script_task: "border-white/[0.12] bg-white/[0.06] text-white",
  browser_task: "border-[#60a5fa]/40 bg-[#60a5fa]/15 text-white",
  cli_agent_task: "border-[#8b5cf6]/40 bg-[#8b5cf6]/15 text-white",
  shell_task: "border-white/[0.12] bg-white/[0.06] text-white",
  api_call: "border-[#60a5fa]/40 bg-[#60a5fa]/15 text-white",
  otp_email: "border-[#8b5cf6]/40 bg-[#8b5cf6]/15 text-white",
  condition: "border-[#8b5cf6]/40 bg-[#8b5cf6]/15 text-white",
  retry_wait: "border-[#4ade80]/40 bg-[#4ade80]/15 text-white",
  human_takeover: "border-[#f87171]/40 bg-[#f87171]/15 text-white",
  end: "border-white/[0.12] bg-white/[0.05] text-white",
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
    className: `rounded-[5px] border px-3 py-2 text-xs shadow-sm backdrop-blur ${nodeTone[n.type] ?? "border-white/[0.12] bg-white/[0.06] text-white"}`,
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
    <section className={`grid min-h-0 grid-rows-[56px_minmax(0,1fr)] bg-[#232323]/70 ${className}`}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#232323]/80 px-3 py-2">
        <div>
          <div className="flex items-center gap-2">
            <GitBranchPlus className="h-4 w-4 text-[#8b5cf6]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">Graph editor</h2>
          </div>
          <p className="mt-0.5 truncate text-xs text-white/45">{status ?? `${nodes.length} steps / ${edges.length} links`}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as NodeKind)}
            aria-label="Step type"
            className="h-8 w-40 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-xs text-white outline-none focus:border-[#8b5cf6]"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] text-white/70 hover:bg-white/[0.08]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          {onSave ? (
            <button
              type="button"
              onClick={save}
              title="Save graph"
              className="perceo-primary inline-flex h-8 w-8 items-center justify-center rounded-[5px]"
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
            <Background color="rgba(255,255,255,0.08)" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="glass glass-border absolute bottom-3 left-3 w-[min(460px,calc(100%-24px))] rounded-[5px] p-3 text-xs">
          {selectedNode ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-white/45">Selected step</span>
                <button
                  type="button"
                  onClick={deleteSelected}
                  title="Delete step"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-[#f87171]/20 text-[#fca5a5] hover:bg-[#f87171]/10"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                <label className="block">
                  <span className="text-white/45">Name</span>
                  <input
                    value={selectedNode.name}
                    onChange={(e) => patchSelected({ name: e.target.value })}
                    className="mt-0.5 h-8 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-white outline-none focus:border-[#8b5cf6]"
                  />
                </label>
                <label className="block">
                  <span className="text-white/45">Type</span>
                  <select
                    value={selectedNode.type}
                    onChange={(e) => patchSelected({ type: e.target.value as NodeKind })}
                    className="mt-0.5 h-8 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-white outline-none focus:border-[#8b5cf6]"
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
                <span className="text-white/45">Instruction</span>
                <textarea
                  value={selectedNode.config.prompt ?? ""}
                  onChange={(e) => patchSelected({ config: { ...selectedNode.config, prompt: e.target.value } })}
                  rows={3}
                  className="mt-0.5 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-white outline-none focus:border-[#8b5cf6]"
                />
              </label>
            </div>
          ) : (
            <div>
              <div className="font-semibold text-white">No step selected</div>
              <p className="mt-1 text-white/45">Select a step to edit it. Drag between handles to connect steps.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
