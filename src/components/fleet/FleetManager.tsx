"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  History,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Send,
  Settings2,
  Square,
  TerminalSquare,
} from "lucide-react";
import type { RunSummary } from "./RunPanel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { getRunTimeline } from "@/lib/fleet/runtime";
import { seedFleetState } from "@/lib/fleet/seed";
import { runStatusTone } from "./status-colors";
import type { FleetVm, Workflow, WorkflowRun } from "@/lib/fleet/types";

type TaskMode = "home" | "workspace";

type LaunchResponse =
  | { mode: "guacamole"; launchUrl: string }
  | { mode: "rdp_file"; downloadUrl: string; reason?: string }
  | { error?: string };

type TaskCard = {
  id: string;
  name: string;
  description: string;
  vm?: FleetVm;
  workflow: Workflow;
};

export function FleetManager() {
  const state = useMemo(() => seedFleetState(), []);
  const workflow = state.workflows[0];
  const [mode, setMode] = useState<TaskMode>("home");
  const [latestRun, setLatestRun] = useState<WorkflowRun>();
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [vms, setVms] = useState<FleetVm[]>(state.vms);
  const [chatDraft, setChatDraft] = useState(workflow.description);
  const [desktopUrl, setDesktopUrl] = useState<string>();
  const [desktopMessage, setDesktopMessage] = useState<string>();
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>();

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (res.ok) setRuns((await res.json()) as RunSummary[]);
    } catch {
      // ignore — history is best-effort (e.g. no server in a unit test)
    }
  }, []);

  const refreshVms = useCallback(async () => {
    try {
      const res = await fetch("/api/vms");
      if (res.ok) {
        const live = (await res.json()) as FleetVm[];
        if (live.length) setVms(live);
      }
    } catch {
      // keep seed vms
    }
  }, []);

  useEffect(() => {
    // setState happens after awaited fetches, not synchronously — no cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRuns();
    void refreshVms();
    const t = setInterval(() => void refreshVms(), 8000);
    return () => clearInterval(t);
  }, [refreshRuns, refreshVms]);

  const loadRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/runs/${id}`);
      if (res.ok) setLatestRun((await res.json()) as WorkflowRun);
    } catch {
      // best-effort
    }
  }, []);

  async function runWorkflow() {
    setRunning(true);
    setActionMessage(undefined);
    void openDesktop(primaryVm, "Attaching live desktop for this run...");
    try {
      const res = await fetch("/api/runs", { method: "POST" });
      const queued = (await res.json()) as WorkflowRun;
      setLatestRun(queued);
      // Poll the async run until it reaches a terminal state.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await fetch(`/api/runs/${queued.id}`);
        if (!r.ok) break;
        const run = (await r.json()) as WorkflowRun;
        setLatestRun(run);
        if (!["queued", "running"].includes(run.status)) break;
      }
      void refreshRuns();
    } finally {
      setRunning(false);
    }
  }

  const idleVms = vms.filter((vm) => vm.status === "idle").length;
  const activeRuns = latestRun && latestRun.status !== "succeeded" ? 1 : 0;
  const primaryVm = vms[0];
  const taskCards: TaskCard[] = [
    {
      id: workflow.id,
      name: "Portal login check",
      description: "Use the task golden VM, verify the target site, and collect a run artifact.",
      vm: primaryVm,
      workflow,
    },
  ];

  async function openDesktop(vm?: FleetVm, pendingMessage = "Connecting to the golden VM...") {
    if (!vm) return;
    if (desktopUrl) return;
    setDesktopBusy(true);
    setDesktopMessage(pendingMessage);
    try {
      const res = await fetch(`/api/vms/${encodeURIComponent(vm.id)}/takeover`, { method: "POST" });
      const body = (await res.json()) as LaunchResponse;
      if ("error" in body && body.error) throw new Error(body.error);
      if (!("mode" in body)) throw new Error("Invalid desktop launch response.");
      if (body.mode === "guacamole") {
        setDesktopUrl(body.launchUrl);
        setDesktopMessage("Live desktop attached");
        return;
      }
      setDesktopMessage(body.reason ? `RDP file ready: ${body.reason}` : "RDP file downloaded.");
      window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setDesktopMessage(e instanceof Error ? e.message : "Could not open the desktop.");
    } finally {
      setDesktopBusy(false);
    }
  }

  async function runAction(action: "cancel" | "resume" | "retry") {
    if (!latestRun) return;
    setActionMessage(undefined);
    try {
      const res = await fetch(`/api/runs/${latestRun.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as WorkflowRun | { error?: string };
      if (!res.ok || "error" in body) {
        setActionMessage(("error" in body && body.error) || "Run action failed.");
        return;
      }
      setLatestRun(body as WorkflowRun);
      void refreshRuns();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Run action failed.");
    }
  }

  function statusLabel(vm?: FleetVm) {
    if (!vm) return "No VM";
    if (vm.status === "idle") return "Golden ready";
    return vm.status.replaceAll("_", " ");
  }

  if (mode === "home") {
    return (
      <main className="min-h-screen bg-[#f7f4ef] text-zinc-950">
        <header className="border-b border-stone-200 bg-[#fbfaf7]/90">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-sm bg-zinc-950 text-[11px] font-semibold uppercase text-white">
                pe
              </span>
              <div>
                <div className="text-sm font-semibold">Perceo Archfleet</div>
                <div className="text-xs text-zinc-500">Task golden VMs and repeatable browser workflows</div>
              </div>
            </div>
            <div className="flex items-center gap-5 text-xs text-zinc-600">
              <span>{idleVms} golden ready</span>
              <span>{activeRuns} active run</span>
            </div>
          </div>
        </header>

        <section className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="pt-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">Home</p>
            <h1 className="mt-3 max-w-sm text-4xl font-semibold leading-tight text-zinc-950">
              Pick a task, work in its golden VM, run it again.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-600">
              The main path is intentionally small: open the task, use the desktop when human login
              is needed, edit the graph, then trigger a run.
            </p>
          </div>

          <div className="grid content-start gap-3">
            {taskCards.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => setMode("workspace")}
                className="group grid min-h-36 grid-cols-[1fr_auto] gap-4 rounded-md border border-stone-200 bg-white p-5 text-left shadow-sm shadow-stone-200/70 transition hover:border-zinc-400"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <CircleDot className="h-4 w-4 text-[#b45f36]" aria-hidden="true" />
                    <h2 className="text-base font-semibold">{task.name}</h2>
                  </div>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">{task.description}</p>
                  <div className="mt-5 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-sm border border-stone-200 bg-[#f7f4ef] px-2 py-1 text-zinc-700">
                      {statusLabel(task.vm)}
                    </span>
                    <span className="rounded-sm border border-stone-200 bg-[#f7f4ef] px-2 py-1 text-zinc-700">
                      {task.workflow.nodes.length} steps
                    </span>
                    <span className="rounded-sm border border-stone-200 bg-[#f7f4ef] px-2 py-1 text-zinc-700">
                      XRDP ready
                    </span>
                  </div>
                </div>
                <span className="self-start rounded-sm bg-zinc-950 px-3 py-2 text-xs font-semibold text-white group-hover:bg-zinc-800">
                  Open
                </span>
              </button>
            ))}

            <div className="rounded-md border border-dashed border-stone-300 bg-[#fbfaf7] p-5 text-sm text-zinc-500">
              More tasks will appear here as profiles are prepared.
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid h-screen min-h-[760px] grid-rows-[56px_minmax(0,1fr)_180px] bg-[#f7f4ef] text-zinc-950">
      <header className="border-b border-stone-200 bg-[#fbfaf7]">
        <div className="flex h-full items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMode("home")}
              title="Back to tasks"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-zinc-700 hover:bg-stone-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div>
              <h1 className="truncate text-[15px] font-semibold leading-tight">
                Portal login check
              </h1>
              <p className="text-xs text-zinc-500">{primaryVm?.name ?? "No VM"} · {statusLabel(primaryVm)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openDesktop(primaryVm)}
              disabled={desktopBusy || !primaryVm}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-zinc-800 hover:bg-stone-50 disabled:opacity-50"
            >
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              {desktopBusy ? "Connecting" : "Connect XRDP"}
            </button>
            <button
              type="button"
              onClick={runWorkflow}
              disabled={running}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {running ? "Running" : "Run"}
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 gap-px bg-stone-200 lg:grid-cols-[minmax(420px,0.38fr)_minmax(520px,0.62fr)_420px]">
        <section className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)_56px] bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-3">
            <div>
              <h2 className="text-sm font-semibold">Chat editor</h2>
              <p className="text-xs text-zinc-500">Tell the agent what this task should do.</p>
            </div>
            <Settings2 className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            <div className="rounded-md border border-stone-200 bg-[#fbfaf7] p-3 text-sm leading-6 text-zinc-700">
              Open the prepared VM, confirm the site is already logged in, then run the workflow
              against a fresh clone. Ask for human takeover when the desktop state needs repair.
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase text-zinc-500">Task instruction</span>
              <textarea
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                className="mt-2 h-52 w-full resize-none rounded-md border border-stone-200 bg-white p-3 text-sm leading-6 text-zinc-900 outline-none focus:border-zinc-500"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 border-t border-stone-200 px-3">
            <input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              aria-label="Message"
              className="h-9 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-3 text-sm outline-none focus:border-zinc-500"
            />
            <button
              type="button"
              title="Send"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-950 text-white hover:bg-zinc-800"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>

        <div className="min-h-0 bg-white">
          <WorkflowCanvas
            workflow={workflow}
            className="h-full"
            onSave={async (wf) => {
              const res = await fetch("/api/workflows", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(wf),
              });
              if (res.ok) return { ok: true };
              const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
              return { ok: false, errors: body.errors };
            }}
          />
        </div>

        <section className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)] bg-zinc-950 text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-3">
            <div>
              <h2 className="text-sm font-semibold">XRDP viewer</h2>
              <p className="text-xs text-zinc-400">
                {desktopMessage ?? (desktopUrl ? "Connected" : "Opens automatically when you run")}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void runAction("cancel")}
                disabled={!latestRun || !["queued", "running", "paused"].includes(latestRun.status)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
              >
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                Pause / stop
              </button>
              <button
                type="button"
                onClick={() => void runAction("resume")}
                disabled={!latestRun || !["paused", "failed", "canceled"].includes(latestRun.status)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Resume
              </button>
              <button
                type="button"
                onClick={() => void openDesktop(primaryVm)}
                disabled={desktopBusy || !primaryVm}
                title="Open desktop"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {desktopUrl ? (
            <iframe
              title="XRDP desktop"
              src={desktopUrl}
              className="h-full w-full border-0 bg-zinc-900"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <div className="grid place-items-center p-6 text-center">
              <div>
                <Monitor className="mx-auto h-8 w-8 text-zinc-500" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Connect to the golden VM</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-400">
                  This viewer attaches automatically when a run starts. You can take over here at any time.
                </p>
                <button
                  type="button"
                  onClick={() => void openDesktop(primaryVm)}
                  disabled={desktopBusy || !primaryVm}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                >
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  {desktopBusy ? "Connecting" : "Connect XRDP"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid min-h-0 gap-px bg-stone-200 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="grid min-h-0 grid-rows-[44px_minmax(0,1fr)] bg-[#fbfaf7]">
          <div className="flex items-center justify-between border-b border-stone-200 px-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#b45f36]" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Profile</h2>
            </div>
            <div className="text-xs text-zinc-500">{primaryVm?.xrdp.username ?? "agent"} · {primaryVm?.xrdp.host}:{primaryVm?.xrdp.port}</div>
          </div>
          <div className="grid grid-cols-3 gap-3 overflow-hidden p-3 text-xs">
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="text-zinc-500">Golden VM</div>
              <div className="mt-1 truncate font-medium text-zinc-950">{primaryVm?.name ?? "Not configured"}</div>
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="text-zinc-500">State</div>
              <div className="mt-1 font-medium text-zinc-950">{statusLabel(primaryVm)}</div>
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="text-zinc-500">Workflow</div>
              <div className="mt-1 font-medium text-zinc-950">{workflow.nodes.length} steps</div>
            </div>
          </div>
        </section>

        <section className="grid min-h-0 grid-rows-[44px_minmax(0,1fr)] bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-3">
            <div className="flex items-center gap-2">
              <TerminalSquare className="h-4 w-4 text-zinc-700" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Run</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void runAction("cancel")}
                disabled={!latestRun || !["queued", "running", "paused"].includes(latestRun.status)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2 text-xs text-zinc-700 hover:bg-stone-50 disabled:opacity-40"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Pause / stop
              </button>
              <button
                type="button"
                onClick={() => void runAction("resume")}
                disabled={!latestRun || !["paused", "failed", "canceled"].includes(latestRun.status)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2 text-xs text-zinc-700 hover:bg-stone-50 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Resume
              </button>
              <button
                type="button"
                onClick={runWorkflow}
                disabled={running}
                title="Run"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto p-3">
            {latestRun ? (
              <div className="space-y-2">
                {actionMessage ? (
                  <div className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    {actionMessage}
                  </div>
                ) : null}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-950">{latestRun.workflowName}</span>
                  <span className={`rounded-sm px-2 py-1 text-[11px] font-medium ${runStatusTone(latestRun.status)}`}>
                    {latestRun.status}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {getRunTimeline(latestRun).map((event) => (
                    <div key={event.id} className="rounded-sm bg-zinc-950 px-2 py-1.5 font-mono text-[11px] leading-5 text-zinc-100">
                      <span className="text-[#f2b66d]">{event.level}</span> {event.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid h-full place-items-center rounded-md border border-dashed border-stone-300 text-xs text-zinc-500">
                Trigger a run to see logs.
              </div>
            )}
            {runs.length ? (
              <div className="mt-3 border-t border-stone-200 pt-2">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Recent
                </div>
                <div className="flex gap-1 overflow-x-auto">
                  {runs.slice(0, 5).map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => void loadRun(run.id)}
                      className="shrink-0 rounded-sm border border-stone-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-stone-50"
                    >
                      {run.status}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
