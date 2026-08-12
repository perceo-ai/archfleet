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
import { GitBranchPlus, Plus, Save, Trash2, X } from "lucide-react";
import type { NodeKind, Workflow, WorkflowNode } from "@/lib/fleet/types";
import { flowToWorkflow, makeNode, type FlowEdge, type FlowNode } from "./flow-convert";

type WorkflowCanvasProps = {
  workflow: Workflow;
  onSave?: (wf: Workflow) => Promise<{ ok: boolean; errors?: string[] }>;
  className?: string;
};

const nodeTone: Record<string, string> = {
  start: "border-[#4ade80]/60 bg-[#eefbf0] text-[#172018]",
  computer_use_task: "border-[#8b5cf6]/45 bg-[#f6f3ff] text-[#211934]",
  script_task: "border-zinc-300 bg-zinc-50 text-zinc-950",
  browser_task: "border-[#60a5fa]/50 bg-[#eff6ff] text-[#172033]",
  cli_agent_task: "border-[#8b5cf6]/45 bg-[#f6f3ff] text-[#211934]",
  shell_task: "border-zinc-300 bg-zinc-50 text-zinc-950",
  api_call: "border-[#60a5fa]/50 bg-[#eff6ff] text-[#172033]",
  otp_email: "border-[#8b5cf6]/45 bg-[#f6f3ff] text-[#211934]",
  condition: "border-[#8b5cf6]/45 bg-[#f6f3ff] text-[#211934]",
  retry_wait: "border-[#4ade80]/60 bg-[#eefbf0] text-[#172018]",
  human_takeover: "border-[#f87171]/55 bg-[#fff1f2] text-[#35191d]",
  end: "border-zinc-300 bg-zinc-50 text-zinc-950",
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

const STEP_TYPE_LABELS: Partial<Record<NodeKind, string>> = {
  start: "Start",
  agent_planner: "Agent Planner",
  computer_use_task: "Runner VM Step",
  script_task: "Desktop Script",
  browser_task: "Browser Step",
  cli_agent_task: "Model Reasoning",
  shell_task: "Shell Step",
  api_call: "API Call",
  otp_email: "OTP Email",
  condition: "Decision",
  retry_wait: "Retry Wait",
  human_takeover: "Human Takeover",
  artifact: "Collect Artifact",
  end: "Complete",
};

const STEP_TEMPLATES: Partial<
  Record<NodeKind, { label: string; description: string; name: string; prompt?: string; labels?: string; timeoutMs?: string }>
> = {
  computer_use_task: {
    label: "Runner VM Step",
    description: "Use the cloned desktop with browser/app state.",
    name: "Use Runner VM",
    prompt:
      "Use the runner VM restored from the prepared golden profile to complete this task step. Stop and report if human input is required.",
    labels: "runner, golden-profile",
    timeoutMs: "300000",
  },
  browser_task: {
    label: "Browser Step",
    description: "Navigate, inspect, and operate a website.",
    name: "Browser step",
    prompt: "Run the browser automation step and return structured success or failure.",
    labels: "browser",
    timeoutMs: "180000",
  },
  cli_agent_task: {
    label: "Model Reasoning",
    description: "Let the agent decide, summarize, or branch.",
    name: "Model reasoning step",
    prompt: "Inspect the current run context and decide the next action.",
    timeoutMs: "120000",
  },
  condition: {
    label: "Decision",
    description: "Branch the run by success, failure, or always.",
    name: "Model decision",
    prompt: "Return success when the workflow can continue, otherwise return failure with the reason.",
    timeoutMs: "60000",
  },
  human_takeover: {
    label: "Human Takeover",
    description: "Pause for login, 2FA, captcha, or review.",
    name: "Human takeover",
    prompt: "Pause for manual login, 2FA, captcha, device trust, or review.",
    timeoutMs: "900000",
  },
  shell_task: {
    label: "Shell Step",
    description: "Run a command inside the controlled environment.",
    name: "Shell step",
    prompt: "Run the required shell command and summarize the result.",
    timeoutMs: "120000",
  },
  api_call: {
    label: "API Call",
    description: "Call an external service and validate output.",
    name: "API step",
    prompt: "Call the required API and validate the response.",
    timeoutMs: "120000",
  },
  otp_email: {
    label: "OTP Email",
    description: "Fetch a code from a connected inbox.",
    name: "Read OTP email",
    prompt: "Fetch the latest OTP email and return the code if available.",
    labels: "email, otp",
    timeoutMs: "120000",
  },
  retry_wait: {
    label: "Retry Wait",
    description: "Wait before retrying a failed step.",
    name: "Retry wait",
    prompt: "Wait before retrying the previous step.",
    timeoutMs: "60000",
  },
  script_task: {
    label: "Desktop Script",
    description: "Run a prepared desktop automation script.",
    name: "Desktop script",
    prompt: "Run the desktop script against the current VM session.",
    labels: "desktop",
    timeoutMs: "180000",
  },
  end: {
    label: "Complete",
    description: "Mark the workflow finished.",
    name: "Complete",
  },
};

function stepTypeLabel(type: NodeKind): string {
  return STEP_TYPE_LABELS[type] ?? type.replaceAll("_", " ");
}

function stepTemplate(type: NodeKind) {
  return (
    STEP_TEMPLATES[type] ?? {
      label: stepTypeLabel(type),
      description: "Add a configured workflow step.",
      name: stepTypeLabel(type),
      prompt: "",
      labels: "",
      timeoutMs: "",
    }
  );
}

function toRfNode(n: WorkflowNode): Node {
  return {
    id: n.id,
    position: n.position,
    data: { wnode: n, label: n.name },
    className: `rounded-[5px] border px-3 py-2 text-xs font-semibold shadow-sm ${nodeTone[n.type] ?? "border-zinc-300 bg-zinc-50 text-zinc-950"}`,
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
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPrompt, setAddPrompt] = useState("");
  const [addLabels, setAddLabels] = useState("");
  const [addTimeoutMs, setAddTimeoutMs] = useState("");

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

  function setAddTemplate(type: NodeKind) {
    const template = stepTemplate(type);
    setNodeType(type);
    setAddName(template.name);
    setAddPrompt(template.prompt ?? "");
    setAddLabels(template.labels ?? "");
    setAddTimeoutMs(template.timeoutMs ?? "");
  }

  function openAddStep() {
    setAddTemplate(nodeType);
    setAddOpen(true);
  }

  function addNode() {
    // Cascade new nodes so they don't stack exactly on top of each other.
    setNodes((ns) => {
      const wnode = makeNode(nodeType, { x: 80 + (ns.length % 5) * 40, y: 60 + (ns.length % 7) * 40 });
      wnode.name = addName.trim() || wnode.name;
      wnode.config = {
        ...wnode.config,
        prompt: addPrompt.trim() || undefined,
        requiredLabels: addLabels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        timeoutMs: addTimeoutMs ? Number(addTimeoutMs) : undefined,
      };
      return [...ns, toRfNode(wnode)];
    });
    setAddOpen(false);
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
            <h2 className="text-sm font-semibold text-white">Graph Editor</h2>
          </div>
          <p className="mt-0.5 truncate text-xs text-white/45">{status ?? `${nodes.length} Steps / ${edges.length} Links`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="workflow-step-type">
            Step Type
          </label>
          <select
            id="workflow-step-type"
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as NodeKind)}
            aria-label="Step Type"
            className="h-8 w-44 rounded-[5px] border border-white/[0.12] bg-[#161616] px-2 text-xs font-medium text-white outline-none focus:border-[#8b5cf6]"
          >
            {PALETTE.map((t) => (
              <option key={t} value={t}>
                {stepTypeLabel(t)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={openAddStep}
            className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-[#8b5cf6]/40 bg-[#8b5cf6]/20 px-3 text-xs font-semibold text-white hover:bg-[#8b5cf6]/30"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Configure Step
          </button>
          {onSave ? (
            <button
              type="button"
              onClick={save}
              className="perceo-primary inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-semibold"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save Graph Draft
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
                <span className="font-semibold uppercase text-white/45">Selected Step</span>
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
                    className="mt-0.5 h-8 w-full rounded-[5px] border border-white/[0.12] bg-[#161616] px-2 text-white outline-none focus:border-[#8b5cf6]"
                  >
                    {["start", ...PALETTE].map((t) => (
                      <option key={t} value={t}>
                        {stepTypeLabel(t as NodeKind)}
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
              <p className="mt-1 text-white/45">Select a step to edit it, or use Configure Step to create a workflow node.</p>
            </div>
          )}
        </aside>
      </div>

      {addOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-6">
          <section className="w-full max-w-4xl rounded-[6px] border border-white/[0.12] bg-[#232323] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Configure Workflow Step</h2>
                <p className="mt-1 text-xs text-white/45">Pick a step template, fill the required fields, then place it on the graph.</p>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/[0.08] text-white/70 hover:bg-white/[0.08]"
                title="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-px bg-white/[0.08] text-xs md:grid-cols-[280px_minmax(0,1fr)]">
              <div className="max-h-[560px] overflow-y-auto bg-[#1d1d1d] p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/45">Step Templates</div>
                <div className="grid gap-2">
                  {PALETTE.map((type) => {
                    const template = stepTemplate(type);
                    const active = nodeType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setAddTemplate(type)}
                        className={`rounded-[5px] border px-3 py-2 text-left transition ${
                          active
                            ? "border-[#8b5cf6]/50 bg-[#8b5cf6]/20 text-white"
                            : "border-white/[0.08] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]"
                        }`}
                      >
                        <span className="block font-semibold">{template.label}</span>
                        <span className="mt-1 block text-[11px] leading-4 text-white/45">{template.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 bg-[#232323] p-4">
                <label className="grid gap-1 font-medium text-white/60">
                  Step Name
                  <input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    className="h-9 rounded-[5px] border border-white/[0.12] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
                  />
                </label>
                <label className="grid gap-1 font-medium text-white/60">
                  Instruction For The Agent
                  <textarea
                    value={addPrompt}
                    onChange={(e) => setAddPrompt(e.target.value)}
                    rows={8}
                    className="rounded-[5px] border border-white/[0.12] bg-white/[0.05] px-2 py-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <label className="grid gap-1 font-medium text-white/60">
                    Required Runner Labels
                    <input
                      value={addLabels}
                      onChange={(e) => setAddLabels(e.target.value)}
                      placeholder="browser, profile:bank"
                      className="h-9 rounded-[5px] border border-white/[0.12] bg-white/[0.05] px-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
                    />
                  </label>
                  <label className="grid gap-1 font-medium text-white/60">
                    Timeout Ms
                    <input
                      value={addTimeoutMs}
                      onChange={(e) => setAddTimeoutMs(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="300000"
                      className="h-9 rounded-[5px] border border-white/[0.12] bg-white/[0.05] px-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
                    />
                  </label>
                </div>
                <div className="rounded-[5px] border border-[#8b5cf6]/20 bg-[#8b5cf6]/10 px-3 py-2 text-[11px] leading-4 text-white/55">
                  After adding the step, connect it by dragging from one node handle to another. Save Graph Draft stores the graph; Save Version captures the broader task draft.
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="inline-flex h-9 items-center rounded-[5px] border border-white/[0.08] px-3 text-xs font-semibold text-white/70 hover:bg-white/[0.08]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addNode}
                className="perceo-primary inline-flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-xs font-semibold"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Step
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
