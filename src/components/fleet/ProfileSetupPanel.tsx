"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Play, RotateCcw, Route, Sparkles, SquareStack } from "lucide-react";
import type { Workflow } from "@/lib/fleet/types";

type SetupResponse = {
  workflow?: { id: string; name: string };
  error?: string;
};

type PlanResponse = {
  workflow?: Workflow;
  errors?: string[];
  error?: string;
};

type LaunchResponse =
  | { mode: "guacamole"; launchUrl: string }
  | { mode: "rdp_file"; downloadUrl: string; reason?: string }
  | { error?: string };

type ProfileOperation = {
  id: string;
  action: "prepare" | "update" | "recover";
  profile: string;
  clones: number;
  status: "running" | "waiting_for_capture" | "succeeded" | "failed";
  logs: string[];
  sourceVm?: { id: string; xrdp: { host: string; port: number; username: string } };
};

type OperationResponse = {
  operation?: ProfileOperation;
  operations?: ProfileOperation[];
  error?: string;
};

const statusTone: Record<ProfileOperation["status"], string> = {
  running: "border-[#60a5fa]/30 bg-[#60a5fa]/20 text-[#9ec5fb]",
  waiting_for_capture: "border-[#8b5cf6]/30 bg-[#8b5cf6]/20 text-[#c4b5fd]",
  succeeded: "border-[#4ade80]/30 bg-[#4ade80]/20 text-[#8add84]",
  failed: "border-[#f87171]/30 bg-[#f87171]/20 text-[#fca5a5]",
};

export function ProfileSetupPanel() {
  const [profile, setProfile] = useState("");
  const [task, setTask] = useState("");
  const [clones, setClones] = useState(2);
  const [agentPassword, setAgentPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [plannedWorkflow, setPlannedWorkflow] = useState<Workflow>();
  const [planErrors, setPlanErrors] = useState<string[]>([]);
  const [operations, setOperations] = useState<ProfileOperation[]>([]);

  const activeOperation = useMemo(
    () => operations.find((op) => op.profile === profile.trim() && ["running", "waiting_for_capture"].includes(op.status)) ?? operations[0],
    [operations, profile],
  );

  async function saveSetupWorkflow(): Promise<string | undefined> {
    const res = await fetch("/api/profile-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: profile.trim(), task: task.trim(), save: true }),
    });
    const body = (await res.json().catch(() => ({}))) as SetupResponse;
    if (!res.ok || !body.workflow) throw new Error(body.error ?? "setup workflow failed");
    return body.workflow.id;
  }

  async function draftRunWorkflow() {
    setBusy("plan");
    setMessage("");
    setPlanErrors([]);
    try {
      const prompt = [
        `Task profile: ${profile.trim() || "default"}`,
        "Design the repeatable task workflow that should run after the golden VM is prepared.",
        "Use CLI-agent condition nodes when a model needs to decide whether to continue, retry, or ask for takeover.",
        "Include human_takeover only for login, 2FA, captcha, device trust, or other human-only steps.",
        "",
        task.trim(),
      ].join("\n");
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: prompt, save: true }),
      });
      const body = (await res.json().catch(() => ({}))) as PlanResponse;
      if (!res.ok || !body.workflow) throw new Error(body.error ?? "LLM planner failed");
      setPlannedWorkflow(body.workflow);
      setPlanErrors(body.errors ?? []);
      setMessage((body.errors ?? []).length ? "LLM draft needs review" : `LLM drafted ${body.workflow.name}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "LLM planner failed");
    } finally {
      setBusy(null);
    }
  }

  async function startOperation(action: ProfileOperation["action"], repair = false) {
    setBusy(action);
    setMessage("");
    try {
      let workflowId: string | undefined;
      if (action === "prepare" && task.trim()) workflowId = await saveSetupWorkflow();
      const res = await fetch("/api/profile-ops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          profile: profile.trim(),
          task: task.trim(),
          clones,
          agentPassword: agentPassword || undefined,
          repair,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as OperationResponse;
      if (!res.ok || !body.operation) {
        setMessage(body.error ?? "profile operation failed");
        return;
      }
      setOperations((prev) => [body.operation as ProfileOperation, ...prev.filter((op) => op.id !== body.operation?.id)]);
      if (workflowId) setMessage(`Drafted ${workflowId}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "profile operation failed");
    } finally {
      setBusy(null);
    }
  }

  async function refreshOperations() {
    try {
      const res = await fetch("/api/profile-ops");
      if (!res.ok) return;
      const body = (await res.json()) as OperationResponse;
      setOperations(body.operations ?? []);
    } catch {
      // best-effort
    }
  }

  async function continueOperation(op: ProfileOperation) {
    setBusy("capture");
    try {
      const res = await fetch(`/api/profile-ops/${encodeURIComponent(op.id)}/continue`, { method: "POST" });
      const body = (await res.json()) as OperationResponse;
      if (body.operation) setOperations((prev) => [body.operation as ProfileOperation, ...prev.filter((item) => item.id !== op.id)]);
    } finally {
      setBusy(null);
    }
  }

  async function openSourceDesktop(op: ProfileOperation) {
    setBusy("desktop");
    setMessage("");
    try {
      const res = await fetch(`/api/profile-ops/${encodeURIComponent(op.id)}/takeover`, { method: "POST" });
      const body = (await res.json()) as LaunchResponse;
      if ("error" in body && body.error) throw new Error(body.error);
      if (!("mode" in body)) throw new Error("Invalid desktop launch response.");
      window.open(body.mode === "guacamole" ? body.launchUrl : body.downloadUrl, "_blank", "noopener,noreferrer");
      if (body.mode === "rdp_file" && body.reason) setMessage(`Downloaded .rdp: ${body.reason}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not open source desktop.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const initial = setTimeout(() => void refreshOperations(), 0);
    const timer = setInterval(() => void refreshOperations(), 2500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);

  const canStart = Boolean(profile.trim());
  const canDraft = Boolean(task.trim());
  const setupStage =
    activeOperation?.status === "waiting_for_capture"
      ? "capture"
      : activeOperation?.status === "running"
        ? "running"
        : plannedWorkflow
          ? "ready"
          : "brief";

  return (
    <section className="bg-[#232323]/70">
      <div className="grid gap-px bg-white/[0.08] lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="bg-[#232323]/70 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#8b5cf6]" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-white">LLM setup flow</h2>
              </div>
              <p className="mt-1 text-xs text-white/45">Describe the task, draft the run graph, then prepare and capture the golden VM.</p>
            </div>
            {message ? <span className="max-w-sm truncate text-xs font-medium text-white/60">{message}</span> : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(120px,150px)_86px] xl:grid-cols-[150px_86px_150px_minmax(0,1fr)]">
            <label className="grid gap-1 text-xs font-medium text-white/60">
              Profile
              <input
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder="bank"
                className="h-9 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-white/60">
              Clones
              <input
                type="number"
                min={0}
                max={20}
                value={clones}
                onChange={(e) => setClones(Number(e.target.value))}
                className="h-9 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-white/60 sm:col-span-2 xl:col-span-1">
              Agent password
              <input
                type="password"
                value={agentPassword}
                onChange={(e) => setAgentPassword(e.target.value)}
                placeholder="env fallback"
                className="h-9 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-white/60 sm:col-span-2 xl:col-span-1">
              Task brief for the model
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Log into the portal, navigate to statements, download the newest PDF, and stop for 2FA if prompted."
                rows={3}
                className="min-h-20 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={draftRunWorkflow}
              disabled={busy !== null || !canDraft}
              className="perceo-primary inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {busy === "plan" ? "Asking LLM" : "Draft with LLM"}
            </button>
            <button
              type="button"
              onClick={() => void startOperation("prepare")}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-3 text-xs font-semibold text-white/75 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-white/30"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Prepare golden VM
            </button>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-[5px] border border-white/[0.08] bg-white/[0.04] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Route className="h-3.5 w-3.5 text-[#8add84]" aria-hidden="true" />
                Setup path
              </div>
              <div className="mt-3 space-y-2 text-xs">
                {[
                  ["brief", "Write task brief"],
                  ["ready", "Review LLM graph"],
                  ["running", "Agent prepares VM"],
                  ["capture", "Manual login, then capture"],
                ].map(([id, label], index) => {
                  const active =
                    setupStage === id ||
                    (setupStage === "ready" && id === "ready") ||
                    (setupStage === "brief" && id === "brief");
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                          active ? "border-[#8add84]/50 bg-[#8add84]/20 text-[#8add84]" : "border-white/[0.1] text-white/35"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className={active ? "text-white" : "text-white/45"}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[5px] border border-white/[0.08] bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase text-white/45">LLM graph draft</h3>
                {plannedWorkflow ? <span className="truncate text-xs text-white/60">{plannedWorkflow.name}</span> : null}
              </div>
              {plannedWorkflow ? (
                <div className="mt-3 grid gap-2">
                  {planErrors.length ? (
                    <div className="rounded-[5px] border border-[#f87171]/25 bg-[#f87171]/10 px-2 py-1.5 text-xs text-[#fca5a5]">
                      {planErrors.join("; ")}
                    </div>
                  ) : null}
                  <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {plannedWorkflow.nodes.map((node) => (
                      <div key={node.id} className="rounded-[5px] border border-white/[0.08] bg-[#161616]/60 px-2 py-1.5">
                        <div className="truncate text-xs font-medium text-white">{node.name}</div>
                        <div className="mt-0.5 truncate text-[11px] text-white/40">{node.type.replaceAll("_", " ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-[5px] border border-dashed border-white/[0.12] bg-[#161616]/40 px-3 py-6 text-center text-xs text-white/45">
                  No graph yet. The model should draft the real task flow before you prepare clones.
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-3">
            <span className="text-xs font-semibold uppercase text-white/35">Maintenance</span>
            <button
              type="button"
              onClick={() => void startOperation("update")}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-3 text-xs font-semibold text-white/75 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-white/30"
            >
              <SquareStack className="h-3.5 w-3.5" aria-hidden="true" />
              Update clones
            </button>
            <button
              type="button"
              onClick={() => void startOperation("recover")}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-3 text-xs font-semibold text-white/75 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-white/30"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Recover
            </button>
            <button
              type="button"
              onClick={() => void startOperation("recover", true)}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-3 text-xs font-semibold text-white/75 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-white/30"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Repair
            </button>
          </div>
        </div>

        <div className="bg-[#161616]/60 p-3">
          {activeOperation ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase text-white/45">{activeOperation.action}</div>
                  <div className="font-mono text-xs text-white/70">{activeOperation.id}</div>
                </div>
                <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold ${statusTone[activeOperation.status]}`}>
                  {activeOperation.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void openSourceDesktop(activeOperation)}
                  disabled={!activeOperation.sourceVm || busy !== null}
                  className="perceo-primary inline-flex h-8 items-center justify-center gap-1.5 rounded-[5px] px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open source
                </button>
                <button
                  type="button"
                  onClick={() => void continueOperation(activeOperation)}
                  disabled={activeOperation.status !== "waiting_for_capture" || busy !== null}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-xs font-semibold text-white/75 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-white/30"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Capture
                </button>
              </div>
              <pre className="h-28 overflow-auto rounded-[5px] border border-white/[0.08] bg-[#161616] p-2 text-[11px] leading-5 text-zinc-300">
                {activeOperation.logs.slice(-80).join("\n") || "Starting..."}
              </pre>
            </div>
          ) : (
            <div className="grid min-h-28 place-items-center rounded-[5px] border border-dashed border-white/[0.12] bg-white/[0.05] text-xs text-white/45">
              Start a setup, update, recover, or repair operation.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
