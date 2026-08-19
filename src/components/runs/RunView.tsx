"use client";

// One run, one layout. The banner and the right column change with the run's
// state — paused wants a human, failed wants a diagnosis, succeeded wants its
// evidence reviewed — but the desktop, the timeline and the log stay put.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Hand, Monitor, Play, RefreshCw } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { duration, timeAgo } from "@/lib/ui/format";
import { runStatusTone, statusLabel } from "@/components/fleet/status-colors";
import { AutomationCopilot } from "@/components/automations/AutomationCopilot";
import { diagnoseFailure } from "@/lib/fleet/run-diagnosis";
import { runNodeStates } from "@/lib/fleet/run-node-states";
import { groupFailures } from "@/lib/fleet/failure-groups";
import { parseAsk } from "@/lib/fleet/human-ask";
import { AskPanel } from "@/components/inbox/AskPanel";
import { Banner, Card, CardHead, Chip, Empty, Meter, Pill, Segmented } from "@/components/ui/primitives";
import { Viewport } from "@/components/ui/Viewport";
import type { AutomationDraft } from "@/lib/fleet/automation-draft";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type {
  Automation,
  EvidenceItem,
  HumanTakeover,
  Workflow,
  WorkflowRun,
} from "@/lib/fleet/types";

const isImage = (path: string | undefined) => !!path && /\.(png|jpe?g)$/i.test(path);
/** A run in one of these states will never change again. */
const isSettled = (status: string | undefined) =>
  status === "succeeded" || status === "failed" || status === "canceled";
const fileName = (path: string) => path.split("/").pop() ?? path;

export function RunView({ id }: { id: string }) {
  const router = useRouter();
  // A settled run never changes again — polling it forever is pure noise.
  const run = usePolling<WorkflowRun>(`/api/runs/${id}`, (r) => (isSettled(r?.status) ? 0 : 2000));
  const evidence = usePolling<EvidenceItem[]>(`/api/evidence?runId=${id}`, () =>
    isSettled(run.data?.status) ? 0 : 5000,
  );
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", () =>
    isSettled(run.data?.status) ? 0 : 5000,
  );
  const allRuns = usePolling<RunSummary[]>("/api/runs", 30000);
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, "pass" | "fail">>({});
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [logView, setLogView] = useState<"readable" | "raw">("readable");
  const logEnd = useRef<HTMLDivElement>(null);

  const data = run.data;
  const automationId = data?.automationId;

  useEffect(() => {
    if (!automationId) return;
    fetch(`/api/automations/${automationId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d) => {
        if (!d?.automation) return;
        setAutomation(d.automation as Automation);
        if (d.workflow) setWorkflow(d.workflow as Workflow);
      })
      .catch(() => undefined);
  }, [automationId]);

  const live = data?.status === "running" || data?.status === "queued";

  useEffect(() => {
    if (!data?.vmId || desktopUrl || !(live || data.status === "paused")) return;
    let canceled = false;
    sendJson<{ mode: string; launchUrl?: string; downloadUrl?: string }>(
      `/api/vms/${data.vmId}/takeover`,
      "POST",
    )
      .then((res) => {
        if (!canceled && res.mode === "guacamole" && res.launchUrl) setDesktopUrl(res.launchUrl);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [data?.vmId, data?.status, desktopUrl, live]);

  useEffect(() => {
    // Scroll the log box itself — scrollIntoView would yank the whole page.
    const box = logEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [data?.events.length]);

  const openTakeover = useMemo(
    () => (takeovers.data ?? []).find((t) => t.runId === id),
    [takeovers.data, id],
  );
  const states = useMemo(() => runNodeStates(data, workflow), [data, workflow]);

  // How far this failure reaches: other runs broken the same way, and whether
  // more than one automation is affected.
  const blastRadius = useMemo(() => {
    if (!data || data.status !== "failed") return undefined;
    return groupFailures(allRuns.data ?? []).find((g) => g.runs.some((r) => r.id === data.id));
  }, [allRuns.data, data]);

  if (!data) {
    return (
      <div className="page-pad">
        <Empty>{run.error ?? "Loading run…"}</Empty>
      </div>
    );
  }

  const artifacts = data.artifacts ?? [];
  const screenshots = artifacts.filter((a) => isImage(a.path));
  const lastShot = screenshots[screenshots.length - 1];
  const artifactUrl = (name: string) => `/api/runs/${data.id}/artifacts/${encodeURIComponent(name)}`;
  const outputs = artifacts.filter((a) => !isImage(a.path));

  const nodes = workflow?.nodes ?? [];
  const doneCount = [...states.values()].filter((s) => s === "ok").length;

  async function openDesktop() {
    if (!data?.vmId) {
      setMessage("No desktop attached to this run.");
      return;
    }
    try {
      const res = await sendJson<{ mode: string; launchUrl?: string; downloadUrl?: string }>(
        `/api/vms/${data.vmId}/takeover`,
        "POST",
      );
      if (res.mode === "guacamole" && res.launchUrl) setDesktopUrl(res.launchUrl);
      else if (res.downloadUrl) window.open(res.downloadUrl, "_blank");
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function runAction(
    action: "cancel" | "resume" | "retry" | "retry_from_step" | "add_takeover_point",
  ) {
    setMessage(null);
    try {
      await sendJson(`/api/runs/${data!.id}/action`, "POST", {
        action,
        operatorNotes: notes || undefined,
      });
      if (action === "add_takeover_point") {
        setMessage("Takeover point added before the failed step — retry to use it.");
      }
      await run.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function answerAsk(action: "resume" | "cancel", answers?: Record<string, string>) {
    setMessage(null);
    try {
      if (openTakeover) {
        await sendJson(`/api/takeovers/${openTakeover.id}/resolve`, "POST", {
          action,
          answers,
          operatorNotes: notes || undefined,
        });
      } else {
        // Paused without a takeover row (older runs): just move the run along.
        await runAction(action === "resume" ? "resume" : "cancel");
      }
      await Promise.all([run.refresh(), takeovers.refresh()]);
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function reviewCriterion(criterion: string, verdict: "pass" | "fail") {
    setReviewed((r) => ({ ...r, [criterion]: verdict }));
    await sendJson("/api/evidence", "POST", {
      runId: data!.id,
      automationId: data!.automationId,
      type: "criteria_review",
      description: criterion,
      verdict,
    }).catch((e) => setMessage(String(e)));
    await evidence.refresh();
  }

  async function applyDraft(draft: AutomationDraft) {
    if (!automation) return;
    setMessage(null);
    try {
      await sendJson("/api/automations", "POST", {
        automation: { ...automation, ...draft.automation, id: automation.id, workflowId: automation.workflowId },
        workflow: { ...draft.workflow, id: automation.workflowId },
      });
      setMessage("Proposal applied. Rerun to test it.");
    } catch (e) {
      setMessage(String(e));
    }
  }

  const criteriaReviews = new Map(
    (evidence.data ?? [])
      .filter((e) => e.type === "criteria_review")
      .map((e) => [e.description, e.verdict] as const),
  );
  const checkResults = (evidence.data ?? []).filter((e) => e.type === "check");
  const diagnosis = data.status === "failed" ? diagnoseFailure(data) : undefined;

  return (
    <div className="page-pad wide">
      <div className="page-head">
        <div className="grow">
          <div className="hstack-w">
            <h1 className="t-display truncate">{automation?.name ?? data.workflowName}</h1>
            <Pill tone={runStatusTone(data.status)} live={live || data.status === "paused"}>
              {statusLabel(data.status)}
            </Pill>
          </div>
          <p>
            started {timeAgo(data.startedAt)} · {duration(data.startedAt, data.finishedAt)} ·{" "}
            {data.triggerSource ?? "manual"}
            {data.vmId ? ` · ${data.vmId}` : ""}
            {automation ? (
              <>
                {" · "}
                <Link href={`/automations/${automation.id}`} style={{ color: "var(--accent-hi)" }}>
                  open the automation
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="hstack">
          {live || data.status === "paused" ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => void openDesktop()}>
                <Monitor className="ico" aria-hidden="true" />
                {data.status === "paused" ? "Take over" : "Watch live"}
              </button>
            </>
          ) : null}
          {data.status === "failed" || data.status === "canceled" ? (
            <button type="button" className="btn btn-sm" onClick={() => void runAction("retry")}>
              <RefreshCw className="ico" aria-hidden="true" />
              Retry
            </button>
          ) : null}
          {automation ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                const next = await sendJson<WorkflowRun>(
                  `/api/automations/${automation.id}/run`,
                  "POST",
                  {},
                );
                router.push(`/runs/${next.id}`);
              }}
            >
              <Play className="ico" aria-hidden="true" />
              Rerun
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p className="t-sm" style={{ color: "var(--danger)", marginBottom: 12 }}>
          {message}
        </p>
      ) : null}

      <div
        className="grid-2"
        style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", alignItems: "start", gap: 18 }}
      >
        <div className="stack">
          {data.status === "paused" ? (
            <Banner
              tone="human"
              icon={<Hand className="ico" aria-hidden="true" />}
              title={openTakeover?.ask?.question ?? data.pausedReason ?? "This run needs a human"}
            >
              <p style={{ margin: 0 }}>
                <span className="strong">{openTakeover?.reason ?? "Paused"}</span>
                <span className="dim">
                  {" "}
                  — the desktop is held exactly where the agent stopped, so you land on the same
                  screen.
                </span>
              </p>
              <p className="t-xs faint" style={{ marginTop: 4 }}>
                {openTakeover ? `waiting ${duration(openTakeover.openedAt)}` : ""}
                {openTakeover?.notifiedAt ? ` · operator paged ${timeAgo(openTakeover.notifiedAt)}` : ""}
              </p>
              <div className="stack-s" style={{ marginTop: 10, maxWidth: 620 }}>
                <AskPanel
                  ask={parseAsk(
                    openTakeover?.ask ?? openTakeover?.requestedAction ?? data.pausedReason,
                    "This run needs a human.",
                  )}
                  onAnswer={(answers) => void answerAsk("resume", answers)}
                  onCancel={() => void answerAsk("cancel")}
                  onTakeOver={() => void openDesktop()}
                />
                <textarea
                  className="textarea"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Operator notes (optional — kept on the run record)"
                  aria-label="Operator notes"
                />
              </div>
            </Banner>
          ) : null}

          {data.status === "failed" ? (
            <Banner
              tone="danger"
              icon={<AlertTriangle className="ico" aria-hidden="true" />}
              title={`Failed${data.currentStep ? ` at “${data.currentStep}”` : ""}`}
            >
              <p style={{ margin: 0 }}>{data.resultSummary ?? diagnosis?.cause}</p>
              {diagnosis ? (
                <p className="t-xs faint" style={{ marginTop: 4 }}>
                  {diagnosis.confident ? "Likely cause: " : "No clear cause. "}
                  {diagnosis.confident ? diagnosis.cause : ""} {diagnosis.suggestion}
                </p>
              ) : null}
              <div className="hstack-w" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-sm" onClick={() => void runAction("retry")}>
                  Retry run
                </button>
                {data.currentStep ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void runAction("retry_from_step")}
                    >
                      Retry from the failed step
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void runAction("add_takeover_point")}
                    >
                      Add a takeover point here
                    </button>
                  </>
                ) : null}
                {automation ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setCopilotOpen((o) => !o)}
                  >
                    {copilotOpen ? "Hide copilot" : "Ask the copilot for a fix"}
                  </button>
                ) : null}
              </div>
            </Banner>
          ) : null}

          {data.status === "succeeded" ? (
            <Banner
              tone="ok"
              icon={<Check className="ico" aria-hidden="true" />}
              title={`Succeeded in ${duration(data.startedAt, data.finishedAt)}`}
              right={
                automation?.status === "draft" ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      try {
                        await sendJson(`/api/automations/${automation.id}`, "PATCH", {
                          status: "active",
                        });
                        setAutomation({ ...automation, status: "active" });
                        setMessage("Automation activated.");
                      } catch (e) {
                        setMessage(String(e));
                      }
                    }}
                  >
                    Activate automation
                  </button>
                ) : undefined
              }
            >
              {automation?.status === "draft"
                ? "Review the criteria against the evidence, then activate to make this repeatable."
                : data.resultSummary ?? "Evidence is attached to this run."}
            </Banner>
          ) : null}

          {desktopUrl && (live || data.status === "paused") ? (
            <Viewport
              iframeSrc={desktopUrl}
              tag={
                <Pill tone={data.status === "paused" ? "human" : "info"} live>
                  {data.status === "paused" ? "live · you can click in" : "live"}
                </Pill>
              }
              bar={
                <>
                  <span className="grow t-sm truncate">
                    {data.currentStep ? `At “${data.currentStep}”` : "Running"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void runAction("cancel")}
                  >
                    Stop
                  </button>
                </>
              }
            />
          ) : lastShot ? (
            <Viewport
              src={artifactUrl(fileName(lastShot.path))}
              alt={`Screenshot from ${data.workflowName}`}
              tag={
                <Pill tone={data.status === "failed" ? "danger" : "ok"}>
                  {data.status === "failed" ? "frozen at failure" : "final frame"}
                </Pill>
              }
              bar={
                <span className="grow t-sm truncate">
                  {data.currentStep ? `At “${data.currentStep}”` : "Last screenshot"}
                </span>
              }
            />
          ) : live ? (
            <Card>
              <Empty>
                {data.status === "queued"
                  ? "Waiting for a prepared desktop — the run starts as soon as one is free."
                  : "The agent is working. The first screenshot appears here as soon as it is captured."}
              </Empty>
            </Card>
          ) : null}

          <Card>
            <CardHead
              title="What it did"
              subtitle="Secrets are redacted before they are written."
              right={
                <Segmented
                  label="Log detail"
                  value={logView}
                  onChange={setLogView}
                  options={[
                    { key: "readable", label: "Readable" },
                    { key: "raw", label: "Raw" },
                  ]}
                />
              }
            />
            <div className="card-body">
              <div className="log">
                {data.events.length === 0 ? (
                  <span className="dimmer">No events yet.</span>
                ) : (
                  data.events
                    .filter((e) => logView === "raw" || e.level !== "info" || !/^Artifact:/.test(e.message))
                    .map((e) => (
                      <div key={e.id} className={`lv-${e.level === "error" ? "err" : e.level}`}>
                        <span className="ts">{new Date(e.timestamp).toLocaleTimeString()}</span>{" "}
                        {logView === "raw" ? `${e.level} ${e.message}` : e.message}
                      </div>
                    ))
                )}
                <div ref={logEnd} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Evidence" subtitle={`${artifacts.length} captured`} />
            <div className="card-body">
              {artifacts.length === 0 ? (
                <Empty>No artifacts captured.</Empty>
              ) : (
                <div className="evidence-grid">
                  {artifacts.map((a) => {
                    const name = fileName(a.path);
                    const url = artifactUrl(name);
                    return (
                      <a key={a.id} className="shot" href={url} target="_blank" rel="noreferrer">
                        {isImage(name) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={name} style={{ width: "100%", display: "block" }} />
                        ) : (
                          <div className="thumb" />
                        )}
                        <div className="cap truncate">{name}</div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="stack">
          {nodes.length > 0 ? (
            <Card>
              <CardHead
                title="Path through the graph"
                subtitle={`${doneCount} of ${nodes.length} nodes completed`}
              />
              <div className="card-body">
                <Meter value={(doneCount / nodes.length) * 100} tone="ok" />
                <div className="timeline" style={{ marginTop: 14 }}>
                  {nodes.map((n) => {
                    const state = states.get(n.id) ?? "idle";
                    return (
                      <div
                        key={n.id}
                        className={`tl-item ${
                          state === "ok"
                            ? "done"
                            : state === "fail"
                              ? "fail"
                              : state === "human"
                                ? "paused"
                                : state === "live"
                                  ? "active"
                                  : ""
                        }`}
                      >
                        <div className="tl-title">{n.name}</div>
                        <div className="tl-meta">
                          {state === "idle" ? "not reached" : statusLabel(state)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          ) : null}

          {outputs.length > 0 ? (
            <Card>
              <CardHead title="What it produced" subtitle="Files and data from this run." />
              <div className="rows">
                {outputs.map((a) => {
                  const name = fileName(a.path);
                  return (
                    <a
                      key={a.id}
                      className="row"
                      href={artifactUrl(name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="grow truncate t-sm">{name}</span>
                      <span className="btn btn-sm">Download</span>
                    </a>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {automation && automation.successCriteria.length > 0 ? (
            <Card>
              <CardHead
                title="Done means"
                subtitle="Reviewed against the screenshots and files above."
              />
              <div className="rows">
                {automation.successCriteria.map((c) => {
                  const verdict = reviewed[c] ?? criteriaReviews.get(c);
                  return (
                    <div className="row" key={c}>
                      <span
                        className={`mk-sm ${verdict === "pass" ? "ok" : verdict === "fail" ? "fail" : "info"}`}
                        aria-hidden="true"
                      >
                        {verdict === "pass" ? "✓" : verdict === "fail" ? "✕" : "?"}
                      </span>
                      <span className="grow t-sm">{c}</span>
                      {data.status === "succeeded" || data.status === "failed" ? (
                        <span className="hstack" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-label={`Mark passed: ${c}`}
                            aria-pressed={verdict === "pass"}
                            onClick={() => void reviewCriterion(c, "pass")}
                          >
                            pass
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-label={`Mark failed: ${c}`}
                            aria-pressed={verdict === "fail"}
                            onClick={() => void reviewCriterion(c, "fail")}
                          >
                            fail
                          </button>
                        </span>
                      ) : (
                        <Chip>pending</Chip>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {blastRadius && blastRadius.runs.length > 1 ? (
            <Card>
              <CardHead
                title="Blast radius"
                subtitle="Other runs broken the same way."
                right={<Pill tone="danger">{blastRadius.runs.length} runs</Pill>}
              />
              <div className="card-body stack-s">
                <div className="hstack">
                  <span className="t-sm dim grow">Automations affected</span>
                  <span className="t-sm strong">{blastRadius.automationIds.length || 1}</span>
                </div>
                <div className="hstack">
                  <span className="t-sm dim grow">First seen</span>
                  <span className="t-sm dim">{timeAgo(blastRadius.firstSeen)}</span>
                </div>
                <Link href="/" className="btn btn-sm">
                  Fix them together in the inbox
                </Link>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHead title="Context" />
            <div className="rows">
              {automation ? (
                <div className="row" style={{ padding: "9px 14px" }}>
                  <span className="t-sm dim grow">Automation</span>
                  <Link href={`/automations/${automation.id}`} className="t-sm strong truncate">
                    {automation.name}
                  </Link>
                </div>
              ) : null}
              <div className="row" style={{ padding: "9px 14px" }}>
                <span className="t-sm dim grow">Desktop</span>
                <span className="t-sm mono">{data.vmId ?? "—"}</span>
              </div>
              <div className="row" style={{ padding: "9px 14px" }}>
                <span className="t-sm dim grow">Triggered by</span>
                <span className="t-sm">{data.triggerSource ?? "manual"}</span>
              </div>
              <div className="row" style={{ padding: "9px 14px" }}>
                <span className="t-sm dim grow">Run id</span>
                <span className="t-sm mono truncate">{data.id}</span>
              </div>
              {data.branchRef || data.prRef ? (
                <div className="row" style={{ padding: "9px 14px" }}>
                  <span className="t-sm dim grow">Change</span>
                  <span className="t-sm mono truncate">{data.prRef ?? data.branchRef}</span>
                </div>
              ) : null}
            </div>
          </Card>

          {checkResults.length > 0 ? (
            <Card>
              <CardHead
                title="Automated checks"
                subtitle="Evaluated against this run's events and artifacts."
              />
              <div className="rows">
                {checkResults.map((c) => (
                  <div className="row" key={c.id}>
                    <span className="grow t-sm">{c.description}</span>
                    <Pill tone={c.verdict === "pass" ? "ok" : "danger"}>{c.verdict}</Pill>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {copilotOpen && automation ? (
        <div style={{ marginTop: 18, height: 480, display: "grid", gridTemplateColumns: "380px" }}>
          <AutomationCopilot
            automation={automation}
            workflow={workflow}
            run={data}
            onApplyDraft={applyDraft}
            title="Run copilot"
          />
        </div>
      ) : null}
    </div>
  );
}
