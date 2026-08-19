"use client";

// The automation, drawn. Nodes are buttons — their detail opens in a modal, so
// the canvas never grows a side panel. The last run is painted on top of it and
// can be toggled off to see the bare structure.

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  Bot,
  Clock,
  Cloud,
  FileText,
  Flag,
  GitBranch,
  Globe,
  Hand,
  Mail,
  Maximize2,
  MousePointer,
  Plus,
  RefreshCw,
  Blocks,
  Sparkles,
  Split,
  Terminal,
  Timer,
  Variable,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  DONE_NODE_ID,
  NODE_H,
  NODE_W,
  TRIGGER_NODE_ID,
  edgePath,
  layoutGraph,
  type LaidOutNode,
} from "@/lib/fleet/graph-layout";
import { formatDuration } from "@/lib/fleet/node-timings";
import type { NodeRunState } from "@/lib/fleet/run-node-states";
import type { Workflow } from "@/lib/fleet/types";

const KIND: Record<string, { icon: LucideIcon; label: string }> = {
  trigger: { icon: Clock, label: "Trigger" },
  done: { icon: Flag, label: "Done means" },
  start: { icon: Flag, label: "Start" },
  agent_planner: { icon: Sparkles, label: "Planner" },
  computer_use_task: { icon: MousePointer, label: "Desktop" },
  browser_task: { icon: Globe, label: "Browser" },
  script_task: { icon: Terminal, label: "Script" },
  cli_agent_task: { icon: Bot, label: "CLI agent" },
  shell_task: { icon: Terminal, label: "Shell" },
  api_call: { icon: Cloud, label: "API call" },
  otp_email: { icon: Mail, label: "Email OTP" },
  human_takeover: { icon: Hand, label: "Human takeover" },
  condition: { icon: GitBranch, label: "Condition" },
  retry_wait: { icon: RefreshCw, label: "Retry" },
  artifact: { icon: FileText, label: "Artifact" },
  end: { icon: Flag, label: "End" },
  switch: { icon: Split, label: "Switch" },
  wait: { icon: Timer, label: "Wait" },
  set_params: { icon: Variable, label: "Set values" },
  custom: { icon: Blocks, label: "Custom step" },
};

const ASK_LABEL: Record<string, string> = {
  input: "for values",
  choice: "to pick one",
  approval: "to approve",
  acknowledge: "for a hand",
};

const ZOOMS = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3];

function nodeClass(node: LaidOutNode, state: NodeRunState | undefined): string {
  const kind =
    node.kind === "trigger"
      ? "k-trigger"
      : node.kind === "done"
        ? "k-done"
        : node.kind === "human_takeover"
          ? "k-human"
          : "";
  return clsx("gnode", kind, state && state !== "idle" && `st-${state}`);
}

export function GraphCanvas({
  workflow,
  states,
  failures,
  timings,
  nodeTypeNames,
  onOpenNode,
  onAddStep,
  showRunDefault = true,
}: {
  workflow: Workflow | undefined | null;
  states: Map<string, NodeRunState>;
  failures: Map<string, number>;
  /** Node id -> ms spent there on the last run. */
  timings?: Map<string, number>;
  /** Custom node type id -> its display name, so custom steps read as themselves. */
  nodeTypeNames?: Record<string, string>;
  onOpenNode: (nodeId: string) => void;
  onAddStep?: () => void;
  showRunDefault?: boolean;
}) {
  const [zoom, setZoom] = useState(4);
  const [showRun, setShowRun] = useState(showRunDefault);

  const layout = useMemo(() => layoutGraph(workflow), [workflow]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  return (
    <div className="canvas-wrap">
      <div className="canvas-tools">
        {onAddStep ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAddStep}>
            <Plus className="ico" aria-hidden="true" />
            Add step
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={showRun}
          onClick={() => setShowRun((s) => !s)}
        >
          <Activity className="ico" aria-hidden="true" />
          Last run
        </button>
      </div>

      <div className={clsx("canvas", showRun && "show-run")}>
        <div
          className="canvas-inner"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `scale(${ZOOMS[zoom]})`,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            aria-hidden="true"
          >
            <defs>
              <marker id="arw" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 1.2 6 4 0 6.8z" fill="var(--line-strong)" />
              </marker>
            </defs>
            <g fill="none" stroke="var(--line-strong)" strokeWidth={1.5} markerEnd="url(#arw)">
              {layout.edges.map((e) => {
                const from = byId.get(e.from);
                const to = byId.get(e.to);
                if (!from || !to) return null;
                return (
                  <path
                    key={e.id}
                    d={edgePath(from, to)}
                    strokeDasharray={e.condition === "success" ? undefined : "4 3"}
                    stroke={e.condition === "failure" ? "var(--danger-base)" : undefined}
                  />
                );
              })}
            </g>
          </svg>

          {layout.edges.map((e) => {
            // Only branch edges are labelled — a plain success edge needs no words.
            if (e.condition === "success") return null;
            const from = byId.get(e.from);
            const to = byId.get(e.to);
            if (!from || !to || from.synthetic || to.synthetic) return null;
            return (
              <span
                key={`${e.id}-label`}
                className="gedge-label"
                style={{
                  left: (from.x + to.x) / 2 + NODE_W / 2 + 8,
                  top: (from.y + NODE_H + to.y) / 2 - 8,
                }}
              >
                {e.condition.startsWith("case:")
                  ? e.condition.slice(5)
                  : e.condition === "failure"
                    ? "on failure"
                    : "always"}
              </span>
            );
          })}

          {layout.nodes.map((n) => {
            const meta = KIND[n.kind] ?? { icon: MousePointer, label: n.kind };
            const Icon = meta.icon;
            // A takeover node's job is the question it asks — say which kind.
            const label =
              n.kind === "human_takeover" && n.node?.config.ask
                ? `Asks: ${ASK_LABEL[n.node.config.ask.kind]}`
                : n.kind === "switch"
                  ? `${(n.node?.config.cases ?? []).length} branches`
                  : n.kind === "wait"
                    ? n.node?.config.untilExpr
                      ? "Until a rule holds"
                      : `Pause ${Math.round((n.node?.config.waitMs ?? 0) / 1000)}s`
                    : n.kind === "set_params"
                      ? `Sets ${Object.keys(n.node?.config.assign ?? {}).join(", ") || "nothing"}`
                      : n.kind === "custom"
                        ? (nodeTypeNames?.[n.node?.config.customTypeId ?? ""] ?? "Custom step")
                        : meta.label;
            const state = states.get(n.id);
            const failed = failures.get(n.id) ?? 0;
            return (
              <div key={n.id}>
                <button
                  type="button"
                  className={nodeClass(n, state)}
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                  onClick={() => onOpenNode(n.id)}
                >
                  <span className="gicon">
                    <Icon className="ico" aria-hidden="true" />
                  </span>
                  <span className="gbody">
                    <span className="gn">{n.name}</span>
                    <span className="gk">{label}</span>
                  </span>
                  <span className="gs" />
                </button>
                {showRun && state === "human" ? (
                  <span className="gbadge human" style={{ left: n.x + NODE_W + 10, top: n.y + 18 }}>
                    waiting on you
                  </span>
                ) : showRun && failed > 0 ? (
                  <span className="gbadge danger" style={{ left: n.x + NODE_W + 10, top: n.y + 18 }}>
                    {failed} {failed === 1 ? "run" : "runs"} failed here
                  </span>
                ) : showRun && timings?.has(n.id) ? (
                  <span
                    className="gbadge idle timing"
                    style={{ left: n.x + NODE_W + 10, top: n.y + 18 }}
                  >
                    {formatDuration(timings.get(n.id)!)}
                  </span>
                ) : null}
              </div>
            );
          })}

          {layout.nodes.length === 0 ? (
            <div className="empty" style={{ paddingTop: 60 }}>
              No steps yet — ask the copilot for the first draft.
            </div>
          ) : null}
        </div>
      </div>

      <div className="canvas-legend">
        <span>
          <i style={{ background: "var(--ok-base)" }} />
          passed
        </span>
        <span>
          <i style={{ background: "var(--danger-base)" }} />
          failed
        </span>
        <span>
          <i style={{ background: "var(--human-base)" }} />
          needs a human
        </span>
        <span>
          <i style={{ background: "var(--idle)" }} />
          not reached
        </span>
      </div>

      <div className="canvas-zoom">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0, z - 1))}
        >
          <ZoomOut className="ico" aria-hidden="true" />
        </button>
        <span className="zval">{Math.round(ZOOMS[zoom] * 100)}%</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
        >
          <ZoomIn className="ico" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Fit"
          onClick={() => setZoom(2)}
        >
          <Maximize2 className="ico" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export { TRIGGER_NODE_ID, DONE_NODE_ID };
