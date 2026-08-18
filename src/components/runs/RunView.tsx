"use client";

// State-dependent run view (spec "Run UX"):
//   running   -> optimize for live watch + trust (desktop, current step, events)
//   paused    -> optimize for human takeover (reason, requested action, notes)
//   completed -> optimize for evidence + reuse (criteria review, screenshots)
//   failed    -> optimize for recovery (failure point, retry, edit, recover env)

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Play, RefreshCw, Square } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { duration, timeAgo } from "@/lib/ui/format";
import { runStatusTone, statusLabel } from "@/components/fleet/status-colors";
import { AutomationCopilot } from "@/components/automations/AutomationCopilot";
import { diagnoseFailure } from "@/lib/fleet/run-diagnosis";
import { formatEvidenceChecks, parseEvidenceChecks } from "@/lib/fleet/evidence-checks";
import type { AutomationDraft } from "@/lib/fleet/automation-draft";
import type { Automation, EvidenceItem, HumanTakeover, Workflow, WorkflowRun } from "@/lib/fleet/types";

const btnGhost =
  "inline-flex h-9 items-center gap-2 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50";

function isImage(name: string | undefined): boolean {
  return !!name && /\.(png|jpe?g)$/i.test(name);
}

export function RunView({ id }: { id: string }) {
  const router = useRouter();
  const run = usePolling<WorkflowRun>(`/api/runs/${id}`, 2000);
  const evidence = usePolling<EvidenceItem[]>(`/api/evidence?runId=${id}`, 5000);
  const takeovers = usePolling<HumanTakeover[]>(`/api/takeovers?status=open`, 5000);
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [automationEdit, setAutomationEdit] = useState<Automation | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [workflowEdit, setWorkflowEdit] = useState<Workflow | null>(null);
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, "pass" | "fail">>({});
  const eventsEnd = useRef<HTMLDivElement>(null);

  const data = run.data;
  const automationId = data?.automationId;
  useEffect(() => {
    if (!automationId) return;
    fetch(`/api/automations/${automationId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d) => {
        if (!d?.automation) return;
        setAutomation(d.automation as Automation);
        setAutomationEdit((prev) => prev ?? (d.automation as Automation));
        if (d.workflow) {
          setWorkflow(d.workflow as Workflow);
          setWorkflowEdit((prev) => prev ?? (d.workflow as Workflow));
        }
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
    eventsEnd.current?.scrollIntoView?.({ block: "end" });
  }, [data?.events.length]);

  const openTakeover = useMemo(
    () => (takeovers.data ?? []).find((t) => t.runId === id),
    [takeovers.data, id],
  );

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-6xl px-5 py-10 md:px-12">
        <p className="text-sm text-white/45">{run.error ?? "Loading run…"}</p>
      </main>
    );
  }

  const artifacts = data.artifacts ?? [];
  const screenshots = artifacts.filter((a) => isImage(a.path));
  const lastShot = screenshots[screenshots.length - 1];
  const artifactUrl = (name: string) => `/api/runs/${data.id}/artifacts/${encodeURIComponent(name)}`;
  const fileName = (path: string) => path.split("/").pop() ?? path;

  async function openDesktop() {
    if (!data?.vmId) {
      setMessage("No VM attached to this run.");
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

  async function saveAutomationInline(): Promise<boolean> {
    if (!automationEdit) return false;
    setMessage(null);
    try {
      if (workflowEdit) {
        await sendJson("/api/automations", "POST", {
          automation: automationEdit,
          workflow: workflowEdit,
        });
        setWorkflow(workflowEdit);
      } else {
        await sendJson(`/api/automations/${automationEdit.id}`, "PATCH", automationEdit);
      }
      setAutomation(automationEdit);
      setMessage("Automation saved.");
      return true;
    } catch (e) {
      setMessage(String(e));
      return false;
    }
  }

  async function saveAndRerun() {
    if (!automationEdit) return;
    const ok = await saveAutomationInline();
    if (!ok) return;
    const next = await sendJson<WorkflowRun>(`/api/automations/${automationEdit.id}/run`, "POST", {});
    router.push(`/runs/${next.id}`);
  }

  const patchAutomation = (fields: Partial<Automation>) =>
    setAutomationEdit((a) => (a ? { ...a, ...fields } : a));

  function applyCopilotDraft(draft: AutomationDraft) {
    if (!automationEdit) return;
    const proposedAutomation: Automation = {
      ...automationEdit,
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
    };
    setAutomationEdit(proposedAutomation);
    setWorkflowEdit({
      ...draft.workflow,
      id: automationEdit.workflowId,
      name: draft.workflow.name || automationEdit.name,
    });
    setMessage("Copilot proposal applied. Review it, then save or save and rerun.");
  }

  const criteriaReviews = new Map(
    (evidence.data ?? [])
      .filter((e) => e.type === "criteria_review")
      .map((e) => [e.description, e.verdict] as const),
  );
  const checkResults = (evidence.data ?? []).filter((e) => e.type === "check");

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-6 md:px-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-white">
              {data.workflowName}
            </h1>
            <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${runStatusTone(data.status)}`}>
              {statusLabel(data.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            started {timeAgo(data.startedAt)} · {duration(data.startedAt, data.finishedAt)}
            {data.currentStep ? ` · step: ${data.currentStep}` : ""}
            {automation ? (
              <>
                {" · "}
                <Link href={`/automations/${automation.id}`} className="text-[#c4b5fd] hover:text-white">
                  {automation.name}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live || data.status === "paused" ? (
            <>
              <button type="button" onClick={() => void openDesktop()} className={btnGhost}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {data.status === "paused" ? "Open desktop to take over" : "Watch live desktop"}
              </button>
              <button type="button" onClick={() => void runAction("cancel")} className={btnGhost}>
                <Square className="h-4 w-4" aria-hidden="true" />
                Cancel
              </button>
            </>
          ) : null}
          {data.status === "failed" || data.status === "canceled" ? (
            <button type="button" onClick={() => void runAction("retry")} className={btnGhost}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </button>
          ) : null}
          {data.status === "succeeded" && automation ? (
            <button
              type="button"
              onClick={async () => {
                const next = await sendJson<WorkflowRun>(`/api/automations/${automation.id}/run`, "POST", {});
                router.push(`/runs/${next.id}`);
              }}
              className="perceo-primary inline-flex h-9 items-center gap-2 rounded-[5px] px-3 text-xs font-semibold"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Rerun
            </button>
          ) : null}
        </div>
      </div>

      {message ? <p className="mt-3 text-sm text-[#fca5a5]">{message}</p> : null}

      {data.status === "paused" ? (
        <section className="glass-border mt-5 rounded-[5px] border border-[#8b5cf6]/40 bg-[#8b5cf6]/10 p-4">
          <h2 className="text-sm font-semibold text-[#c4b5fd]">A human needs to take over</h2>
          <p className="mt-2 text-sm text-white">
            {data.pausedReason ?? openTakeover?.requestedAction ?? "The run paused for manual input."}
          </p>
          {openTakeover ? (
            <p className="mt-1 text-xs text-white/55">
              {openTakeover.reason} · waiting for a human for {duration(openTakeover.openedAt)}
            </p>
          ) : null}
          {openTakeover ? (
            <p className="mt-1 text-xs text-white/55">
              {openTakeover.escalatedAt
                ? `Operator paged ${timeAgo(openTakeover.notifiedAt ?? openTakeover.openedAt)} · reminder sent ${timeAgo(openTakeover.escalatedAt)}`
                : openTakeover.notifiedAt
                  ? `Operator paged ${timeAgo(openTakeover.notifiedAt)}`
                  : "No operator page sent — set CUF_NOTIFY_WEBHOOK to get paged for takeovers."}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-white/55">
            The desktop is held exactly where the agent stopped — open it, finish the blocked step
            (login, MFA, captcha), then resume.
          </p>
          <div className="mt-3 grid gap-2 md:max-w-xl">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Operator notes (what you did, for the run record)"
              className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAction("resume")}
                className="perceo-primary inline-flex h-9 items-center rounded-[5px] px-4 text-xs font-semibold"
              >
                Done — resume run
              </button>
              <button type="button" onClick={() => void openDesktop()} className={btnGhost}>
                Open desktop
              </button>
              <button type="button" onClick={() => void runAction("cancel")} className={btnGhost}>
                Cancel run
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {data.status === "succeeded" && automation ? (
        <section className="glass-border mt-5 rounded-[5px] border border-[#4ade80]/30 bg-[#4ade80]/10 p-4">
          <h2 className="text-sm font-semibold text-[#8add84]">Succeeded</h2>
          <p className="mt-2 text-sm text-white/85">
            {automation.status === "draft"
              ? "Review the success criteria against the evidence, then activate the automation to make this repeatable."
              : "Evidence is attached to the automation's history. Update the spec if the site changed."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {automation.status === "draft" ? (
              <button
                type="button"
                onClick={async () => {
                  setMessage(null);
                  try {
                    await sendJson(`/api/automations/${automation.id}`, "PATCH", { status: "active" });
                    setAutomation({ ...automation, status: "active" });
                    setMessage("Automation activated.");
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
                className="perceo-primary inline-flex h-9 items-center rounded-[5px] px-3 text-xs font-semibold"
              >
                Activate automation
              </button>
            ) : null}
            <Link href={`/automations/${automation.id}`} className={btnGhost}>
              {automation.status === "draft" ? "Edit automation" : "Update automation"}
            </Link>
          </div>
        </section>
      ) : null}

      {data.status === "failed" ? (
        <section className="glass-border mt-5 rounded-[5px] border border-[#f87171]/40 bg-[#f87171]/10 p-4">
          <h2 className="text-sm font-semibold text-[#fca5a5]">
            Failed{data.currentStep ? ` at "${data.currentStep}"` : ""}
          </h2>
          {data.resultSummary ? <p className="mt-2 text-sm text-white">{data.resultSummary}</p> : null}
          {(() => {
            const diagnosis = diagnoseFailure(data);
            return (
              <div className="mt-2 text-sm">
                <p className="text-white/85">
                  <span className="font-semibold text-white">
                    {diagnosis.confident ? "Likely cause:" : "No clear cause found."}
                  </span>{" "}
                  {diagnosis.cause}
                </p>
                <p className="mt-1 text-xs text-white/55">{diagnosis.suggestion}</p>
              </div>
            );
          })()}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void runAction("retry")} className={btnGhost}>
              Retry run
            </button>
            {data.currentStep ? (
              <button type="button" onClick={() => void runAction("retry_from_step")} className={btnGhost}>
                Retry from failed step
              </button>
            ) : null}
            {data.currentStep ? (
              <button type="button" onClick={() => void runAction("add_takeover_point")} className={btnGhost}>
                Add takeover point before this step
              </button>
            ) : null}
            {automation ? (
              <Link href={`/automations/${automation.id}`} className={btnGhost}>
                Edit automation
              </Link>
            ) : null}
            <Link href="/environments" className={btnGhost}>
              Recover environment
            </Link>
          </div>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          {desktopUrl && (live || data.status === "paused") ? (
            <section className="glass glass-border overflow-hidden rounded-[5px]">
              <div className="border-b border-white/[0.08] px-4 py-2 text-xs text-white/55">
                Live desktop — you can take over at any time.
              </div>
              <iframe src={desktopUrl} title="Runner desktop" className="h-[420px] w-full bg-black" />
            </section>
          ) : null}

          {lastShot ? (
            <section className="glass glass-border rounded-[5px]">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-sm font-semibold text-white">
                  {live
                    ? "Live view — latest screenshot"
                    : data.status === "failed"
                      ? "Screenshot at failure"
                      : "Last screenshot"}
                </h2>
                {live ? (
                  <span className="text-xs text-white/45">
                    {data.currentStep ? `step: ${data.currentStep} · ` : ""}updates as the agent works
                  </span>
                ) : null}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artifactUrl(fileName(lastShot.path))}
                alt={`Screenshot from ${data.workflowName}`}
                className="w-full"
              />
            </section>
          ) : null}

          {live && !lastShot && !desktopUrl ? (
            <section className="glass glass-border rounded-[5px] px-4 py-8 text-center">
              <p className="text-sm text-white/60">
                {data.status === "queued"
                  ? "Waiting for a prepared environment — the run starts as soon as one is free."
                  : "The agent is working — the first screenshot appears here as soon as it's captured."}
              </p>
              <p className="mt-2 text-xs text-white/40">
                Want the real desktop? Use “Watch live desktop” above to open an interactive view.
              </p>
            </section>
          ) : null}

          <section className="glass glass-border rounded-[5px]">
            <div className="border-b border-white/[0.08] px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Events</h2>
            </div>
            <div className="max-h-[360px] overflow-auto bg-[#161616] px-4 py-3 font-mono text-xs leading-5">
              {data.events.length === 0 ? (
                <p className="text-white/40">No events yet.</p>
              ) : (
                data.events.map((e) => (
                  <div key={e.id} className={e.level === "error" ? "text-[#fca5a5]" : e.level === "warn" ? "text-[#c4b5fd]" : "text-white/70"}>
                    {e.level} {e.message}
                  </div>
                ))
              )}
              <div ref={eventsEnd} />
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-5">
          {automationEdit ? (
            <>
              <AutomationCopilot
                automation={automationEdit}
                workflow={workflowEdit ?? workflow}
                run={data}
                onApplyDraft={applyCopilotDraft}
                title="Run copilot"
              />
              <section className="glass glass-border rounded-[5px]">
                <div className="border-b border-white/[0.08] px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Review changes</h2>
                  <p className="mt-1 text-xs text-white/45">Tune the applied proposal here, then rerun from this screen.</p>
                </div>
                <div className="grid gap-3 p-4 text-xs text-white/60">
                  <label className="grid gap-1">
                    <span className="font-semibold text-white/80">Goal</span>
                    <input
                      value={automationEdit.goal}
                      onChange={(e) => patchAutomation({ goal: e.target.value })}
                      className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="font-semibold text-white/80">Steps</span>
                    <textarea
                      rows={6}
                      value={automationEdit.specMarkdown}
                      onChange={(e) => patchAutomation({ specMarkdown: e.target.value })}
                      className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="font-semibold text-white/80">Success criteria</span>
                    <textarea
                      rows={3}
                      value={automationEdit.successCriteria.join("\n")}
                      onChange={(e) =>
                        patchAutomation({ successCriteria: e.target.value.split("\n").filter(Boolean) })
                      }
                      className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="font-semibold text-white/80">Automated checks</span>
                    <textarea
                      rows={3}
                      value={formatEvidenceChecks(automationEdit.evidenceChecks ?? [])}
                      onChange={(e) => patchAutomation({ evidenceChecks: parseEvidenceChecks(e.target.value) })}
                      className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="font-semibold text-white/80">Human takeover points</span>
                    <input
                      value={automationEdit.takeoverPolicy}
                      onChange={(e) => patchAutomation({ takeoverPolicy: e.target.value })}
                      className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void saveAutomationInline()} className={btnGhost}>
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveAndRerun()}
                      className="perceo-primary inline-flex h-9 items-center gap-2 rounded-[5px] px-3 text-xs font-semibold"
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      Save and rerun
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {data.status === "succeeded" && artifacts.some((a) => !isImage(a.path)) ? (
            <section className="glass glass-border rounded-[5px]">
              <div className="border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Extracted outputs</h2>
                <p className="mt-1 text-xs text-white/45">Files and data this run produced.</p>
              </div>
              <ul className="divide-y divide-white/[0.08]">
                {artifacts
                  .filter((a) => !isImage(a.path))
                  .map((a) => {
                    const name = fileName(a.path);
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-3">
                        <span className="truncate text-sm text-white/85">{name}</span>
                        <a
                          href={artifactUrl(name)}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs font-semibold text-white/70 hover:text-white"
                        >
                          Download
                        </a>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ) : null}

          {automation && automation.successCriteria.length > 0 ? (
            <section className="glass glass-border rounded-[5px]">
              <div className="border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Success criteria</h2>
                <p className="mt-1 text-xs text-white/45">
                  Review each against the screenshots and artifacts below.
                </p>
              </div>
              <ul className="divide-y divide-white/[0.08]">
                {automation.successCriteria.map((c) => {
                  const verdict = reviewed[c] ?? criteriaReviews.get(c);
                  return (
                    <li key={c} className="flex items-center justify-between gap-2 px-4 py-3">
                      <span className="text-sm text-white/85">{c}</span>
                      {data.status === "succeeded" || data.status === "failed" ? (
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            aria-label={`Mark passed: ${c}`}
                            onClick={() => void reviewCriterion(c, "pass")}
                            className={`rounded-[5px] px-2 py-1 text-xs font-semibold ${
                              verdict === "pass"
                                ? "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30"
                                : "bg-white/[0.05] text-white/50 hover:text-white"
                            }`}
                          >
                            pass
                          </button>
                          <button
                            type="button"
                            aria-label={`Mark failed: ${c}`}
                            onClick={() => void reviewCriterion(c, "fail")}
                            className={`rounded-[5px] px-2 py-1 text-xs font-semibold ${
                              verdict === "fail"
                                ? "bg-[#f87171]/20 text-[#fca5a5] ring-1 ring-[#f87171]/30"
                                : "bg-white/[0.05] text-white/50 hover:text-white"
                            }`}
                          >
                            fail
                          </button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {checkResults.length > 0 ? (
            <section className="glass glass-border rounded-[5px]">
              <div className="border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Automated checks</h2>
                <p className="mt-1 text-xs text-white/45">
                  Evaluated against this run&apos;s events and artifacts.
                </p>
              </div>
              <ul className="divide-y divide-white/[0.08]">
                {checkResults.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <span className="text-sm text-white/85">{c.description}</span>
                    <span
                      className={`shrink-0 rounded-[5px] px-2 py-0.5 text-xs font-semibold ${
                        c.verdict === "pass"
                          ? "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30"
                          : "bg-[#f87171]/20 text-[#fca5a5] ring-1 ring-[#f87171]/30"
                      }`}
                    >
                      {c.verdict}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="glass glass-border rounded-[5px]">
            <div className="border-b border-white/[0.08] px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Evidence</h2>
              <p className="mt-1 text-xs text-white/45">Screenshots and artifacts from this run.</p>
            </div>
            {artifacts.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/45">No artifacts captured.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {artifacts.map((a) => {
                  const name = fileName(a.path);
                  return isImage(name) ? (
                    <a key={a.id} href={artifactUrl(name)} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={artifactUrl(name)} alt={name} className="rounded-[5px] border border-white/[0.08]" />
                      <span className="mt-1 block truncate text-xs text-white/45">{name}</span>
                    </a>
                  ) : (
                    <a
                      key={a.id}
                      href={artifactUrl(name)}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-2 text-xs text-white/70 hover:text-white"
                    >
                      {name}
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
