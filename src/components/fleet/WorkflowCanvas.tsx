"use client";

import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { Workflow } from "@/lib/fleet/types";

type WorkflowCanvasProps = {
  workflow: Workflow;
};

const nodeTone: Record<string, string> = {
  start: "border-emerald-400 bg-emerald-50",
  cli_agent_task: "border-blue-400 bg-blue-50",
  human_takeover: "border-amber-400 bg-amber-50",
  end: "border-zinc-400 bg-zinc-50",
};

export function WorkflowCanvas({ workflow }: WorkflowCanvasProps) {
  const nodes: Node[] = workflow.nodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: {
      label: (
        <div className="min-w-36">
          <div className="text-xs font-semibold text-zinc-950">{node.name}</div>
          <div className="mt-1 text-[10px] uppercase text-zinc-500">{node.type.replaceAll("_", " ")}</div>
        </div>
      ),
    },
    className: `rounded border px-3 py-2 shadow-sm ${nodeTone[node.type] ?? "border-zinc-300 bg-white"}`,
  }));

  const edges: Edge[] = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.condition,
    animated: edge.condition !== "failure",
  }));

  return (
    <section className="min-h-0 bg-zinc-100">
      <div className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">{workflow.name}</h2>
          <p className="text-xs text-zinc-500">{workflow.description}</p>
        </div>
        <div className="flex gap-1">
          {workflow.triggerKinds.map((trigger) => (
            <span
              key={trigger}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600"
            >
              {trigger}
            </span>
          ))}
        </div>
      </div>
      <div className="h-[420px]">
        <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
