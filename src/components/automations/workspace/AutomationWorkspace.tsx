"use client";

// The automation workspace. Its own page — three columns, no app chrome:
// copilot left, the graph in the middle, live state right. The graph *is* the
// automation; every detail opens as an overlay so the middle column never grows.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ChevronLeft, Play, Settings as SettingsIcon } from "lucide-react";
import { getJson, sendJson, usePolling } from "@/lib/ui/api";
import { duration, timeAgo } from "@/lib/ui/format";
import {
  automationHealthTone,
  environmentHealthTone,
  statusLabel,
} from "@/components/fleet/status-colors";
import { Card, CardHead, Chip, Empty, Pill, RunStrip } from "@/components/ui/primitives";
import { AutomationCopilot } from "@/components/automations/AutomationCopilot";
import { GraphCanvas } from "@/components/automations/workspace/GraphCanvas";
import { DoneModal, NodeModal, SettingsModal, TriggerModal } from "@/components/automations/workspace/NodeModals";
import { NodePalette, type PaletteChoice } from "@/components/automations/workspace/NodePalette";
import type { CustomNodeType } from "@/lib/fleet/node-types";
import { RunDrawer, RunsDrawer } from "@/components/automations/workspace/RunDrawers";
import { DONE_NODE_ID, TRIGGER_NODE_ID } from "@/lib/fleet/graph-layout";
import { failureCountsByNode, runNodeStates } from "@/lib/fleet/run-node-states";
import { nodeDurations } from "@/lib/fleet/node-timings";
import { Viewport } from "@/components/ui/Viewport";
import { latestScreenshotUrl } from "@/lib/ui/thumbnails";
import type { AutomationDraft } from "@/lib/fleet/automation-draft";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type {
  Automation,
  AutomationHealth,
  PreparedEnvironment,
  Trigger,
  Workflow,
  WorkflowNode,
  WorkflowRun,
} from "@/lib/fleet/types";

type Detail = {
  automation: Automation;
  workflow?: Workflow;
  environment?: PreparedEnvironment;
  triggers: Trigger[];
  runs: RunSummary[];
  health: AutomationHealth;
  lastRun?: RunSummary;
  activation?: { ok: boolean; reason?: string };
};

type Overlay = "none" | "node" | "done" | "trigger" | "settings" | "runs" | "run" | "palette";

/** Sensible starting config per kind, so a new node is never blank-but-broken. */
function starterConfig(choice: PaletteChoice): WorkflowNode["config"] {
  switch (choice.kind) {
    case "condition":
      return { expr: 'steps["A step"].body.ok == true' };
    case "switch":
      return {
        cases: [
          { label: "yes", expr: "true" },
          { label: "no", expr: "true" },
        ],
      };
    case "wait":
      return { waitMs: 30_000 };
    case "set_params":
      return { assign: { value_1: '""' } };
    case "api_call":
      return { prompt: '{"url": "https://api.example.com/thing", "method": "GET"}' };
    case "custom":
      return { customTypeId: choice.customTypeId, fields: {} };
    case "human_takeover":
      return {
        ask: { kind: "acknowledge", question: "Take a look and continue when it's handled." },
      };
    default:
      return { prompt: "Describe what this step should do." };
  }
}

export function AutomationWorkspace({ id }: { id?: string }) {
  const router = useRouter();
  const detail = usePolling<Detail>(id ? `/api/automations/${id}` : "", id ? 8000 : 0);
  const [environments, setEnvironments] = useState<PreparedEnvironment[]>([]);
  const nodeTypes = usePolling<CustomNodeType[]>("/api/node-types", 60000);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getJson<PreparedEnvironment[]>("/api/environments")
      .then(setEnvironments)
      .catch(() => undefined);
  }, []);

  const automation = detail.data?.automation;
  const workflow = detail.data?.workflow;
  const runs = useMemo(() => detail.data?.runs ?? [], [detail.data?.runs]);
  const latest = runs[0];

  // The newest run is fetched in full so its events can be painted on the graph.
  const latestRun = usePolling<WorkflowRun>(
    latest ? `/api/runs/${latest.id}` : "",
    latest && (latest.status === "running" || latest.status === "paused" || latest.status === "queued")
      ? 3000
      : 0,
  );

  const states = useMemo(
    () => runNodeStates(latestRun.data, workflow),
    [latestRun.data, workflow],
  );
  const failures = useMemo(() => failureCountsByNode(runs, workflow), [runs, workflow]);
  const timings = useMemo(() => nodeDurations(latestRun.data, workflow), [latestRun.data, workflow]);

  const refreshAll = useCallback(async () => {
    await detail.refresh();
    await latestRun.refresh();
  }, [detail, latestRun]);

  /* ---------------- mutations ---------------- */

  async function patchAutomation(patch: Partial<Automation>) {
    if (!automation) return;
    setMessage(null);
    try {
      await sendJson(`/api/automations/${automation.id}`, "PATCH", patch);
      await detail.refresh();
      setOverlay("none");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function saveWorkflow(next: Workflow) {
    setMessage(null);
    try {
      await sendJson("/api/workflows", "POST", next);
      await detail.refresh();
      setOverlay("none");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function saveNode(node: WorkflowNode) {
    if (!workflow) return;
    await saveWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === node.id ? node : n)),
    });
  }

  async function deleteNode(id: string) {
    if (!workflow) return;
    await saveWorkflow({
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== id),
      edges: workflow.edges.filter((e) => e.from !== id && e.to !== id),
    });
  }

  /** Append the chosen step to the end of the graph, then open it for editing.
   * A switch also gets one edge per case, so it is never saved half-wired. */
  async function addStep(choice: PaletteChoice) {
    if (!workflow) return;
    const sources = new Set(workflow.edges.map((e) => e.from));
    const tail =
      workflow.nodes.filter((n) => n.type !== "end" && !sources.has(n.id)).at(-1) ??
      workflow.nodes.at(-1);
    const newId = `node-${Math.random().toString(36).slice(2, 8)}`;
    const config = starterConfig(choice);
    const node: WorkflowNode = {
      id: newId,
      type: choice.kind,
      name: choice.name,
      position: { x: tail?.position.x ?? 0, y: (tail?.position.y ?? 0) + 120 },
      config,
    };
    const edges = [...workflow.edges];
    if (tail) {
      edges.push({ id: `${tail.id}->${newId}`, from: tail.id, to: newId, condition: "success" as const });
    }
    for (const branch of config.cases ?? []) {
      // Each case needs somewhere to go or the graph will not validate; point
      // them at the end node until the author rewires them.
      const end = workflow.nodes.find((n) => n.type === "end");
      if (end) {
        edges.push({
          id: `${newId}->${end.id}-${branch.label}`,
          from: newId,
          to: end.id,
          condition: `case:${branch.label}` as const,
        });
      }
    }
    await saveWorkflow({ ...workflow, nodes: [...workflow.nodes, node], edges });
    setNodeId(newId);
    setOverlay("node");
  }

  async function addTrigger(type: "schedule" | "webhook", cron?: string) {
    if (!automation) return;
    setMessage(null);
    try {
      const res = await sendJson<{ trigger: Trigger; webhookToken?: string }>("/api/triggers", "POST", {
        workflowId: automation.workflowId,
        type,
        cron: type === "schedule" ? cron : undefined,
      });
      if (res.webhookToken) setWebhookToken(res.webhookToken);
      await detail.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function runNow() {
    if (!automation) return;
    setMessage(null);
    try {
      const run = await sendJson<WorkflowRun>(`/api/automations/${automation.id}/run`, "POST", {});
      setRunId(run.id);
      setOverlay("run");
      await detail.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function applyDraft(draft: AutomationDraft) {
    setMessage(null);
    try {
      if (!automation) {
        // New automation: the first accepted proposal is what creates it.
        await sendJson("/api/automations", "POST", {
          automation: draft.automation,
          workflow: draft.workflow,
        });
        router.push(`/automations/${draft.automation.id}`);
        return;
      }
      await sendJson("/api/automations", "POST", {
        automation: {
          ...automation,
          name: draft.automation.name,
          goal: draft.automation.goal,
          category: draft.automation.category,
          target: draft.automation.target,
          specMarkdown: draft.automation.specMarkdown,
          successCriteria: draft.automation.successCriteria,
          requiredSecrets: draft.automation.requiredSecrets,
          mfaExpectation: draft.automation.mfaExpectation,
          artifactPolicy: draft.automation.artifactPolicy,
          retryPolicy: draft.automation.retryPolicy,
          takeoverPolicy: draft.automation.takeoverPolicy,
          triggerSuggestion: draft.automation.triggerSuggestion,
          riskNotes: draft.automation.riskNotes,
          evidenceChecks: draft.automation.evidenceChecks,
        },
        workflow: { ...draft.workflow, id: automation.workflowId, name: draft.workflow.name || automation.name },
      });
      await detail.refresh();
      setMessage("Proposal applied to the graph.");
    } catch (e) {
      setMessage(String(e));
    }
  }

  function openNode(id: string) {
    if (id === TRIGGER_NODE_ID) return setOverlay("trigger");
    if (id === DONE_NODE_ID) return setOverlay("done");
    setNodeId(id);
    setOverlay("node");
  }

  /* ---------------- render ---------------- */

  const isNew = !id;
  const selectedNode = workflow?.nodes.find((n) => n.id === nodeId);
  const recent = runs
    .filter((r) => r.status === "succeeded" || r.status === "failed")
    .slice(0, 5)
    .map((r) => r.status === "succeeded");

  if (!isNew && !detail.data) {
    return (
      <div className="focus">
        <Empty>{detail.error ?? "Loading automation…"}</Empty>
      </div>
    );
  }

  return (
    <div className="focus">
      <header className="focus-head">
        <Link href="/automations" className="focus-back">
          <ChevronLeft className="ico" aria-hidden="true" />
          Automations
        </Link>
        <div style={{ width: 1, height: 20, background: "var(--line)" }} />
        <div className="hstack grow" style={{ minWidth: 0 }}>
          <span className="t-head truncate">{automation?.name ?? "Untitled automation"}</span>
          {automation ? (
            <>
              <Pill tone={automationHealthTone(detail.data!.health)}>
                {statusLabel(detail.data!.health)}
              </Pill>
              <Chip>{automation.status}</Chip>
            </>
          ) : (
            <Chip>draft</Chip>
          )}
        </div>
        <div className="hstack">
          {automation ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOverlay("runs")}>
                <Activity className="ico" aria-hidden="true" />
                Runs <span className="dimmer t-num">{runs.length}</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="Settings"
                aria-label="Settings"
                onClick={() => setOverlay("settings")}
              >
                <SettingsIcon className="ico" aria-hidden="true" />
              </button>
              <div style={{ width: 1, height: 20, background: "var(--line)", margin: "0 3px" }} />
              {automation.status === "draft" ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={detail.data?.activation ? !detail.data.activation.ok : false}
                  title={detail.data?.activation?.reason}
                  onClick={() => void patchAutomation({ status: "active" })}
                >
                  Activate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    void patchAutomation({
                      status: automation.status === "disabled" ? "active" : "disabled",
                    })
                  }
                >
                  {automation.status === "disabled" ? "Enable" : "Pause"}
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void runNow()}>
                <Play className="ico" aria-hidden="true" />
                Run now
              </button>
            </>
          ) : (
            <span className="t-xs faint">Describe the job to create it</span>
          )}
        </div>
      </header>

      <div className="workspace">
        <AutomationCopilot
          automation={automation}
          workflow={workflow}
          run={latestRun.data}
          onApplyDraft={applyDraft}
        />

        <div className="ws-center">
          <div className="goalbar">
            <span className="t-label">Goal</span>
            <span className="gtext grow truncate">
              {automation?.goal ?? "Nothing yet — the copilot fills this in from your description."}
            </span>
            {automation ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOverlay("settings")}>
                Edit
              </button>
            ) : null}
          </div>

          {message ? (
            <p className="t-xs" style={{ padding: "6px 16px", color: "var(--accent-hi)" }}>
              {message}
            </p>
          ) : null}

          <GraphCanvas
            workflow={workflow}
            states={states}
            failures={failures}
            timings={timings}
            nodeTypeNames={Object.fromEntries((nodeTypes.data ?? []).map((t) => [t.id, t.name]))}
            onOpenNode={openNode}
            onAddStep={workflow ? () => setOverlay("palette") : undefined}
          />
        </div>

        <div className="ws-right">
          <div className="ws-head">
            <span className="t-label">Live</span>
          </div>
          <div style={{ padding: 12 }} className="stack-s">
            {latest ? (
              <button type="button" className="card" onClick={() => { setRunId(latest.id); setOverlay("run"); }}>
                <div className="card-body stack-s">
                  <div className="hstack">
                    <Pill
                      tone={
                        latest.status === "paused"
                          ? "human"
                          : latest.status === "running"
                            ? "info"
                            : latest.status === "failed"
                              ? "danger"
                              : latest.status === "succeeded"
                                ? "ok"
                                : "idle"
                      }
                      live={latest.status === "running" || latest.status === "paused"}
                    >
                      {statusLabel(latest.status)}
                    </Pill>
                    <div className="spacer" />
                    <span className="t-xs faint t-num">
                      {duration(latest.startedAt, latest.finishedAt)}
                    </span>
                  </div>
                  <Viewport
                    src={latestScreenshotUrl(latestRun.data)}
                    alt="Latest desktop screenshot"
                    bar={
                      <span className="t-xs truncate">
                        {latest.currentStep ?? latest.resultSummary ?? "no detail"}
                      </span>
                    }
                  />
                  <div className="t-xs faint">started {timeAgo(latest.startedAt)}</div>
                </div>
              </button>
            ) : (
              <Card>
                <div className="card-body t-sm dimmer">
                  No runs yet. Press Run now to build the first one.
                </div>
              </Card>
            )}

            {automation ? (
              <Card>
                <CardHead
                  title="Health"
                  right={
                    <Pill tone={automationHealthTone(detail.data!.health)}>
                      {statusLabel(detail.data!.health)}
                    </Pill>
                  }
                />
                <div className="card-body stack-s">
                  <RunStrip results={recent} />
                  <div className="t-xs faint">
                    {runs.length} {runs.length === 1 ? "run" : "runs"} recorded
                  </div>
                </div>
              </Card>
            ) : null}

            {detail.data?.environment ? (
              <Card>
                <CardHead
                  title="Runs on"
                  right={
                    <Pill tone={environmentHealthTone(detail.data.environment.health)}>
                      {statusLabel(detail.data.environment.health)}
                    </Pill>
                  }
                />
                <div className="card-body stack-s">
                  <div className="t-sm strong">{detail.data.environment.name}</div>
                  <div className="t-xs dimmer">{detail.data.environment.description}</div>
                  <Link href="/environments" className="btn btn-sm">
                    Open environment
                  </Link>
                </div>
              </Card>
            ) : null}

            {automation && automation.requiredSecrets.length > 0 ? (
              <Card>
                <CardHead title="Secrets" />
                <div className="rows">
                  {automation.requiredSecrets.map((s) => (
                    <div className="row" key={s} style={{ padding: "8px 12px" }}>
                      <span className="grow mono t-sm truncate">{s}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {automation && detail.data?.triggers.length ? (
              <Card>
                <CardHead
                  title="Triggers"
                  right={
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOverlay("trigger")}>
                      Edit
                    </button>
                  }
                />
                <div className="rows">
                  {detail.data.triggers.map((t) => (
                    <div className="row" key={t.id} style={{ padding: "8px 12px" }}>
                      <span className="grow t-sm truncate">{t.type}</span>
                      <Pill tone={t.enabled ? "ok" : "idle"}>{t.enabled ? "on" : "off"}</Pill>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>

      {selectedNode ? (
        <NodeModal
          key={selectedNode.id}
          node={selectedNode}
          open={overlay === "node"}
          onClose={() => setOverlay("none")}
          onSave={saveNode}
          onDelete={deleteNode}
          failures={failures.get(selectedNode.id)}
          workflow={workflow}
          nodeTypes={nodeTypes.data ?? []}
        />
      ) : null}

      <NodePalette
        open={overlay === "palette"}
        onClose={() => setOverlay("none")}
        onPick={(choice) => void addStep(choice)}
        nodeTypes={nodeTypes.data ?? []}
        onManageTypes={() => router.push("/users?tab=node-types")}
      />

      {automation ? (
        <>
          <DoneModal
            key={`done-${automation.updatedAt}`}
            automation={automation}
            open={overlay === "done"}
            onClose={() => setOverlay("none")}
            onSave={patchAutomation}
          />
          <TriggerModal
            triggers={detail.data?.triggers ?? []}
            open={overlay === "trigger"}
            onClose={() => setOverlay("none")}
            onAdd={addTrigger}
            webhookToken={webhookToken}
          />
          <SettingsModal
            key={`settings-${automation.updatedAt}`}
            automation={automation}
            environments={environments}
            open={overlay === "settings"}
            onClose={() => setOverlay("none")}
            onSave={patchAutomation}
          />
          <RunsDrawer
            runs={runs}
            open={overlay === "runs"}
            onClose={() => setOverlay("none")}
            onOpenRun={(rid) => {
              setRunId(rid);
              setOverlay("run");
            }}
          />
        </>
      ) : null}

      <RunDrawer
        runId={runId}
        open={overlay === "run"}
        onClose={() => setOverlay("none")}
        onChanged={() => void refreshAll()}
      />
    </div>
  );
}
