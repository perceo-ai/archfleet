"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Play, RotateCcw, SquareStack, WandSparkles } from "lucide-react";

type SetupResponse = {
  workflow?: { id: string; name: string };
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
  running: "border-blue-200 bg-blue-50 text-blue-800",
  waiting_for_capture: "border-amber-200 bg-amber-50 text-amber-900",
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-800",
};

export function ProfileSetupPanel() {
  const [profile, setProfile] = useState("");
  const [task, setTask] = useState("");
  const [clones, setClones] = useState(2);
  const [agentPassword, setAgentPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
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

  async function draftWorkflow() {
    setBusy("draft");
    setMessage("");
    try {
      const workflowId = await saveSetupWorkflow();
      setMessage(`Drafted ${workflowId}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "setup workflow failed");
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
  const canDraft = canStart && Boolean(task.trim());

  return (
    <section className="border-t border-zinc-200 bg-white">
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-0">
        <div className="px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WandSparkles className="h-4 w-4 text-zinc-700" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-950">Task Profile</h2>
            </div>
            {message ? <span className="truncate text-xs font-medium text-zinc-600">{message}</span> : null}
          </div>

          <div className="grid grid-cols-[150px_86px_150px_minmax(0,1fr)] gap-2">
            <label className="grid gap-1 text-xs font-medium text-zinc-700">
              Profile
              <input
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder="bank"
                className="h-9 rounded border border-zinc-300 px-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-zinc-700">
              Clones
              <input
                type="number"
                min={0}
                max={20}
                value={clones}
                onChange={(e) => setClones(Number(e.target.value))}
                className="h-9 rounded border border-zinc-300 px-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-zinc-700">
              Agent password
              <input
                type="password"
                value={agentPassword}
                onChange={(e) => setAgentPassword(e.target.value)}
                placeholder="env fallback"
                className="h-9 rounded border border-zinc-300 px-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-zinc-700">
              Task
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Log into the portal and prepare statement download"
                className="h-9 rounded border border-zinc-300 px-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={draftWorkflow}
              disabled={busy !== null || !canDraft}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-zinc-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Draft workflow
            </button>
            <button
              type="button"
              onClick={() => void startOperation("prepare")}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Start setup
            </button>
            <button
              type="button"
              onClick={() => void startOperation("update")}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              <SquareStack className="h-3.5 w-3.5" aria-hidden="true" />
              Update clones
            </button>
            <button
              type="button"
              onClick={() => void startOperation("recover")}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Recover
            </button>
            <button
              type="button"
              onClick={() => void startOperation("recover", true)}
              disabled={busy !== null || !canStart}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Repair
            </button>
          </div>
        </div>

        <div className="border-l border-zinc-200 bg-zinc-50 p-3">
          {activeOperation ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase text-zinc-500">{activeOperation.action}</div>
                  <div className="font-mono text-xs text-zinc-700">{activeOperation.id}</div>
                </div>
                <span className={`rounded border px-2 py-1 text-[11px] font-semibold ${statusTone[activeOperation.status]}`}>
                  {activeOperation.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void openSourceDesktop(activeOperation)}
                  disabled={!activeOperation.sourceVm || busy !== null}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded bg-zinc-950 px-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open source
                </button>
                <button
                  type="button"
                  onClick={() => void continueOperation(activeOperation)}
                  disabled={activeOperation.status !== "waiting_for_capture" || busy !== null}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-400"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Capture
                </button>
              </div>
              <pre className="h-28 overflow-auto rounded border border-zinc-200 bg-white p-2 text-[11px] leading-5 text-zinc-700">
                {activeOperation.logs.slice(-80).join("\n") || "Starting..."}
              </pre>
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded border border-dashed border-zinc-300 text-xs text-zinc-500">
              No profile operation
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
