"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  History,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Save,
  Send,
  Square,
  TerminalSquare,
} from "lucide-react";
import type { RunSummary } from "./RunPanel";
import { ProfileSetupPanel } from "./ProfileSetupPanel";
import { SecretsParamsPanel } from "./SecretsParamsPanel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { getRunTimeline } from "@/lib/fleet/runtime";
import { seedFleetState } from "@/lib/fleet/seed";
import { runStatusTone } from "./status-colors";
import type { FleetVm, Workflow, WorkflowRun } from "@/lib/fleet/types";

type TaskMode = "home" | "workspace";
type WorkbenchTab = "versions" | "profile" | "inputs";

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

type ChatMessage = {
  id: string;
  role: "operator" | "system";
  text: string;
  createdAt: string;
};

type WorkspaceVersion = {
  id: string;
  name: string;
  createdAt: string;
  taskName: string;
  profileName: string;
  objective: string;
  messages: ChatMessage[];
};

const STORAGE_KEY = "archfleet.workspace.v1";
const MIN_CHAT_WIDTH = 220;
const MIN_GRAPH_WIDTH = 380;
const MIN_DESKTOP_WIDTH = 340;
const MIN_WORKBENCH_HEIGHT = 180;
const MAX_WORKBENCH_HEIGHT = 420;

const initialMessage = (description: string): ChatMessage => ({
  id: "msg_initial",
  role: "system",
  text: description,
  createdAt: new Date(0).toISOString(),
});

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function FleetManager() {
  const state = useMemo(() => seedFleetState(), []);
  const workflow = state.workflows[0];
  const [mode, setMode] = useState<TaskMode>("home");
  const [latestRun, setLatestRun] = useState<WorkflowRun>();
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [vms, setVms] = useState<FleetVm[]>(state.vms);
  const [taskName, setTaskName] = useState("Portal login check");
  const [profileName, setProfileName] = useState("default");
  const [objective, setObjective] = useState(workflow.description);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage(workflow.description)]);
  const [chatDraft, setChatDraft] = useState("");
  const [versions, setVersions] = useState<WorkspaceVersion[]>([]);
  const [versionName, setVersionName] = useState("Initial setup");
  const [saveNote, setSaveNote] = useState<string>();
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [desktopUrl, setDesktopUrl] = useState<string>();
  const [desktopMessage, setDesktopMessage] = useState<string>();
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>();
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("versions");
  const [chatWidth, setChatWidth] = useState(300);
  const [graphWidth, setGraphWidth] = useState(620);
  const [workbenchHeight, setWorkbenchHeight] = useState(260);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (typeof window.localStorage?.getItem !== "function") return;
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            taskName?: string;
            profileName?: string;
            objective?: string;
            messages?: ChatMessage[];
            versions?: WorkspaceVersion[];
          };
          if (saved.taskName) setTaskName(saved.taskName);
          if (saved.profileName) setProfileName(saved.profileName);
          if (saved.objective) setObjective(saved.objective);
          if (saved.messages?.length) setMessages(saved.messages);
          if (saved.versions?.length) setVersions(saved.versions);
        }
      } catch {
        // local persistence is best-effort
      } finally {
        setStorageLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageLoaded) return;
    if (typeof window.localStorage?.setItem !== "function") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ taskName, profileName, objective, messages, versions }),
      );
    } catch {
      // local persistence is best-effort
    }
  }, [messages, objective, profileName, storageLoaded, taskName, versions]);

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
    void openDesktop(primaryVm, "Attaching Runner VM for this run...");
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
      name: taskName,
      description: objective,
      vm: primaryVm,
      workflow,
    },
  ];
  const healthyVms = vms.filter((vm) => vm.status !== "unhealthy" && vm.status !== "stopped").length;
  const vmCapacity = vms.reduce((sum, vm) => sum + vm.cpu, 0);
  const workspaceStats = [
    { label: "Runner Ready", value: idleVms },
    { label: "VMs Online", value: healthyVms },
    { label: "Steps", value: workflow.nodes.length },
    { label: "vCPU", value: vmCapacity },
  ];

  function startColumnResize(which: "chat" | "graph", event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startChatWidth = chatWidth;
    const startGraphWidth = graphWidth;

    function move(e: PointerEvent) {
      const delta = e.clientX - startX;
      if (which === "chat") {
        const nextChat = clamp(startChatWidth + delta, MIN_CHAT_WIDTH, 520);
        const graphDelta = nextChat - startChatWidth;
        setChatWidth(nextChat);
        setGraphWidth(clamp(startGraphWidth - graphDelta, MIN_GRAPH_WIDTH, 920));
        return;
      }
      setGraphWidth(clamp(startGraphWidth + delta, MIN_GRAPH_WIDTH, 980));
    }

    function stop() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startWorkbenchResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = workbenchHeight;

    function move(e: PointerEvent) {
      setWorkbenchHeight(clamp(startHeight - (e.clientY - startY), MIN_WORKBENCH_HEIGHT, MAX_WORKBENCH_HEIGHT));
    }

    function stop() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: `msg_${now}_operator`, role: "operator", text, createdAt: now },
      {
        id: `msg_${now}_system`,
        role: "system",
        text: "Saved to this workspace. Update the task fields or save a version when this should become a restore point.",
        createdAt: now,
      },
    ]);
    setObjective(text);
    setChatDraft("");
  }

  async function saveVersion() {
    const now = new Date().toISOString();
    const version: WorkspaceVersion = {
      id: `ver_${now}`,
      name: versionName.trim() || `Version ${versions.length + 1}`,
      createdAt: now,
      taskName,
      profileName,
      objective,
      messages,
    };
    setVersions((prev) => [version, ...prev]);
    setSaveNote("Saving...");
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...workflow, name: taskName, description: objective }),
    });
    setSaveNote(res.ok ? `Saved ${version.name}` : "Version saved locally; graph save failed.");
  }

  function restoreVersion(version: WorkspaceVersion) {
    setTaskName(version.taskName);
    setProfileName(version.profileName);
    setObjective(version.objective);
    setMessages(version.messages);
    setSaveNote(`Restored ${version.name}`);
  }

  async function openDesktop(vm?: FleetVm, pendingMessage = "Connecting to the Runner VM...") {
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
        setDesktopMessage("Runner VM attached");
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
    if (vm.status === "idle") return "Runner Ready";
    return vm.status.replaceAll("_", " ");
  }

  if (mode === "home") {
    return (
      <main className="grid-lines relative min-h-screen overflow-hidden bg-[#312F2F] text-white">
        <div className="dot-pattern dot-pattern-fade z-0" aria-hidden="true" />
        <header className="relative z-10 border-b border-white/[0.08] bg-[#312f2f]/70 backdrop-blur-xl">
          <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-12">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-gradient-to-b from-[#8b5cf6] to-[#7848e6] text-[11px] font-semibold uppercase text-white shadow-sm">
                pe
              </span>
              <div>
                <div className="font-serif text-xl font-bold italic tracking-tight text-white">Perceo Archfleet</div>
                <div className="text-xs text-white/50">Computer-use runs on isolated Runner VMs</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/60">
              <Link
                href="/users"
                className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 py-2 font-semibold text-white hover:bg-white/[0.08]"
              >
                Users
              </Link>
              <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 py-2">{activeRuns} Active Run</span>
            </div>
          </div>
        </header>

        <section className="relative z-10 mx-auto grid max-w-7xl gap-5 px-5 py-6 md:px-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Task Launcher</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">Run browser workflows on Runner VMs.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Choose a task, attach the Runner VM when human login is needed, edit the workflow graph, then run it and keep the trace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMode("workspace")}
              className="perceo-primary inline-flex h-10 items-center gap-2 rounded-[5px] px-4 text-sm font-semibold"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Open Workspace
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {workspaceStats.map((stat) => (
              <div key={stat.label} className="glass rounded-[5px] p-4">
                <div className="text-2xl font-semibold text-white">{stat.value}</div>
                <div className="mt-1 text-xs text-white/45">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_360px]">
            <section className="glass glass-border rounded-[5px]">
              <div className="border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Tasks</h2>
                <p className="mt-1 text-xs text-white/45">Select the workflow you want to operate.</p>
              </div>
              <div className="divide-y divide-white/[0.08]">
                {taskCards.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setMode("workspace")}
                    className="grid w-full gap-4 px-4 py-4 text-left transition hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/50 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CircleDot className="h-4 w-4 text-[#8add84]" aria-hidden="true" />
                        <h3 className="truncate text-base font-semibold text-white">{task.name}</h3>
                      </div>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{task.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-[5px] border border-[#4ade80]/30 bg-[#4ade80]/15 px-2 py-1 text-[#8add84]">
                          {statusLabel(task.vm)}
                        </span>
                        <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-white/65">
                          {task.workflow.nodes.length} steps
                        </span>
                        <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-white/65">
                          {workflow.triggerKinds.join(" / ")}
                        </span>
                      </div>
                    </div>
                    <span className="perceo-primary inline-flex h-9 items-center justify-center rounded-[5px] px-3 text-xs font-semibold">
                      Open
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <aside className="grid gap-3">
              <section className="glass rounded-[5px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Runner VM</h2>
                    <p className="mt-1 text-xs text-white/45">{primaryVm?.name ?? "No VM available"}</p>
                  </div>
                  <span className="rounded-[5px] bg-[#4ade80]/20 px-2 py-1 text-xs font-semibold text-[#8add84]">
                    {statusLabel(primaryVm)}
                  </span>
                </div>
                {primaryVm ? (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-white/55">
                    <div>
                      <div className="text-white">{primaryVm.cpu}</div>
                      <div>CPU</div>
                    </div>
                    <div>
                      <div className="text-white">{primaryVm.memoryGb} GB</div>
                      <div>Memory</div>
                    </div>
                    <div>
                      <div className="text-white">{primaryVm.diskGb} GB</div>
                      <div>Disk</div>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="glass rounded-[5px] p-4">
                <h2 className="text-sm font-semibold text-white">Next Setup Action</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Prepare or refresh the Golden Profile when credentials, MFA trust, or browser state expires.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode("workspace");
                    setWorkbenchTab("profile");
                  }}
                  className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08]"
                >
                  Open Profile Setup
                </button>
              </section>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid-lines flex min-h-screen flex-col bg-[#312F2F] text-white xl:h-screen xl:overflow-hidden">
      <header className="border-b border-white/[0.08] bg-[#312f2f]/70 backdrop-blur-xl">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMode("home")}
              title="Back to tasks"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] text-white/70 hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div>
              <h1 className="truncate text-[15px] font-semibold leading-tight">{taskName}</h1>
              <p className="text-xs text-white/45">
                {profileName} · {primaryVm?.name ?? "No VM"} · {statusLabel(primaryVm)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/users"
              className="inline-flex h-8 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08]"
            >
              Users
            </Link>
            <button
              type="button"
              onClick={() => void openDesktop(primaryVm)}
              disabled={desktopBusy || !primaryVm}
              className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
            >
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              {desktopBusy ? "Connecting" : "Connect Runner VM"}
            </button>
            <button
              type="button"
              onClick={runWorkflow}
              disabled={running}
              className="perceo-primary inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-semibold disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {running ? "Running" : "Run"}
            </button>
          </div>
        </div>
      </header>

      <div
        className="grid min-h-[620px] flex-1 bg-white/[0.08] [grid-template-columns:1fr] xl:min-h-0 xl:[grid-template-columns:minmax(var(--min-chat-width),var(--chat-width))_6px_minmax(var(--min-graph-width),var(--graph-width))_6px_minmax(var(--min-desktop-width),1fr)]"
        style={
          {
            "--chat-width": `${chatWidth}px`,
            "--graph-width": `${graphWidth}px`,
            "--min-chat-width": `${MIN_CHAT_WIDTH}px`,
            "--min-graph-width": `${MIN_GRAPH_WIDTH}px`,
            "--min-desktop-width": `${MIN_DESKTOP_WIDTH}px`,
          } as React.CSSProperties
        }
      >
        <section className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)_56px] bg-[#232323]/70">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3">
            <div>
              <h2 className="text-sm font-semibold">Chat</h2>
              <p className="text-xs text-white/45">Actual task notes and instructions.</p>
            </div>
            <MessageSquare className="h-4 w-4 text-white/35" aria-hidden="true" />
          </div>
          <div className="min-h-0 space-y-3 overflow-y-auto p-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-md border px-3 py-2 text-xs leading-5 ${
                  message.role === "operator"
                    ? "border-[#8b5cf6]/40 bg-[#8b5cf6]/20 text-white"
                    : "border-white/[0.08] bg-white/[0.05] text-zinc-300"
                }`}
              >
                <div className={message.role === "operator" ? "text-white/50" : "text-white/40"}>
                  {message.role === "operator" ? "You" : "Archfleet"}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{message.text}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-white/[0.08] px-3">
            <input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              aria-label="Message"
              placeholder="Update the objective or leave an operator note"
              className="h-9 min-w-0 flex-1 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
            />
            <button
              type="button"
              title="Send"
              onClick={sendChat}
              className="perceo-primary inline-flex h-9 w-9 items-center justify-center rounded-[5px]"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>

        <button
          type="button"
          aria-label="Resize chat and graph panels"
          onPointerDown={(event) => startColumnResize("chat", event)}
          className="group hidden cursor-col-resize bg-white/[0.08] transition hover:bg-[#8b5cf6]/35 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/60 xl:block"
        >
          <span className="mx-auto block h-full w-px bg-white/10 transition group-hover:bg-white/45" />
        </button>

        <div className="min-h-0 bg-[#232323]/70">
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

        <button
          type="button"
          aria-label="Resize graph and Runner VM panels"
          onPointerDown={(event) => startColumnResize("graph", event)}
          className="group hidden cursor-col-resize bg-white/[0.08] transition hover:bg-[#8b5cf6]/35 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/60 xl:block"
        >
          <span className="mx-auto block h-full w-px bg-white/10 transition group-hover:bg-white/45" />
        </button>

        <section className="grid min-h-[420px] grid-rows-[48px_minmax(0,1fr)] bg-[#161616] text-white xl:min-h-0">
          <div className="flex items-center justify-between border-b border-white/10 px-3">
            <div>
              <h2 className="text-sm font-semibold">Runner VM</h2>
              <p className="text-xs text-zinc-400">
                {desktopMessage ?? (desktopUrl ? "Connected" : "Opens automatically when you run")}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void runAction("cancel")}
                disabled={!latestRun || !["queued", "running", "paused"].includes(latestRun.status)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
              >
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                Stop
              </button>
              <button
                type="button"
                onClick={() => void runAction("resume")}
                disabled={!latestRun || !["paused", "failed", "canceled"].includes(latestRun.status)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Resume
              </button>
              <button
                type="button"
                onClick={() => void openDesktop(primaryVm)}
                disabled={desktopBusy || !primaryVm}
                title="Open Runner VM"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/10 text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {desktopUrl ? (
            <iframe
              title="Runner VM desktop"
              src={desktopUrl}
              className="h-full w-full border-0 bg-zinc-900"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <div className="grid place-items-center p-6 text-center">
              <div>
                <Monitor className="mx-auto h-8 w-8 text-zinc-500" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Connect to the Runner VM</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-400">
                  This viewer attaches automatically when a run starts. You can take over here at any time.
                </p>
                <button
                  type="button"
                  onClick={() => void openDesktop(primaryVm)}
                  disabled={desktopBusy || !primaryVm}
                  className="perceo-primary mt-4 inline-flex h-9 items-center gap-2 rounded-[5px] px-3 text-xs font-semibold disabled:opacity-50"
                >
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  {desktopBusy ? "Connecting" : "Connect Runner VM"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <button
        type="button"
        aria-label="Resize workbench"
        onPointerDown={startWorkbenchResize}
        className="group hidden h-2 cursor-row-resize border-y border-white/[0.08] bg-[#161616] transition hover:bg-[#8b5cf6]/35 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/60 xl:block"
      >
        <span className="mx-auto block h-px w-16 bg-white/15 transition group-hover:bg-white/55" />
      </button>

      <div
        className="border-t border-white/[0.08] bg-[#232323]/70 xl:h-[var(--workbench-height)] xl:min-h-0 xl:overflow-auto"
        style={{ "--workbench-height": `${workbenchHeight}px` } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#8add84]" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Workbench</h2>
          </div>
          <div className="flex rounded-[5px] border border-white/[0.08] bg-white/[0.05] p-0.5 text-xs">
            {[
              ["versions", "Versions"],
              ["profile", "Profile Setup"],
              ["inputs", "Parameters & Triggers"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setWorkbenchTab(id as WorkbenchTab)}
                className={`h-8 rounded px-3 font-semibold ${
                  workbenchTab === id ? "perceo-primary text-white" : "text-white/60 hover:bg-white/[0.08]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {workbenchTab === "versions" ? (
          <div className="grid gap-px bg-white/[0.08] lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="bg-[#232323]/70">
              <div className="grid gap-3 p-3 text-xs xl:grid-cols-[minmax(420px,1fr)_minmax(280px,0.45fr)]">
                <div className="rounded-[5px] border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Workspace Draft</h3>
                      <p className="mt-1 text-xs text-white/45">Edit the task metadata before saving a version.</p>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-[180px_180px_minmax(240px,1fr)]">
                    <label className="block">
                      <span className="font-medium text-white/45">Task</span>
                      <input
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
                      />
                    </label>
                    <label className="block">
                      <span className="font-medium text-white/45">Profile</span>
                      <input
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
                      />
                    </label>
                    <label className="block">
                      <span className="font-medium text-white/45">Current Objective</span>
                      <input
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-[5px] border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="mb-2">
                    <h3 className="text-sm font-semibold text-white">Save Version</h3>
                    <p className="mt-1 text-xs text-white/45">Capture the current chat, objective, and graph metadata.</p>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <label className="block">
                      <span className="font-medium text-white/45">Version Name</span>
                      <input
                        value={versionName}
                        onChange={(e) => setVersionName(e.target.value)}
                        className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveVersion()}
                      className="perceo-primary mt-5 inline-flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-xs font-semibold"
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      Save Version
                    </button>
                  </div>
                  <div className="mt-3 border-t border-white/[0.08] pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-semibold text-white/70">Version History</span>
                      {saveNote ? <span className="truncate text-white/45">{saveNote}</span> : null}
                    </div>
                    {versions.length ? (
                      <div className="flex gap-2 overflow-x-auto">
                        {versions.map((version) => (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => restoreVersion(version)}
                            className="shrink-0 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.08]"
                          >
                            <span className="block font-semibold text-white">Restore {version.name}</span>
                            <span className="block text-white/40">{new Date(version.createdAt).toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[5px] border border-dashed border-white/[0.12] px-3 py-2 text-white/40">
                        No saved versions yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid min-h-44 grid-rows-[44px_minmax(0,1fr)] bg-[#232323]/70">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-3">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="h-4 w-4 text-white/70" aria-hidden="true" />
                  <h2 className="text-sm font-semibold">Run</h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void runAction("cancel")}
                    disabled={!latestRun || !["queued", "running", "paused"].includes(latestRun.status)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-2 text-xs text-white/70 hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction("resume")}
                    disabled={!latestRun || !["paused", "failed", "canceled"].includes(latestRun.status)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-2 text-xs text-white/70 hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={runWorkflow}
                    disabled={running}
                    title="Run"
                    className="perceo-primary inline-flex h-8 w-8 items-center justify-center rounded-[5px] disabled:opacity-60"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 overflow-y-auto p-3">
                {latestRun ? (
                  <div className="space-y-2">
                    {actionMessage ? (
                      <div className="rounded-[5px] border border-[#8b5cf6]/30 bg-[#8b5cf6]/20 px-2 py-1.5 text-xs text-[#c4b5fd]">
                        {actionMessage}
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-white">{latestRun.workflowName}</span>
                      <span className={`rounded-[5px] px-2 py-1 text-[11px] font-medium ${runStatusTone(latestRun.status)}`}>
                        {latestRun.status}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {getRunTimeline(latestRun).map((event) => (
                        <div key={event.id} className="rounded-[5px] bg-[#161616] px-2 py-1.5 font-mono text-[11px] leading-5 text-zinc-100">
                          <span className="text-[#8add84]">{event.level}</span> {event.message}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid h-full place-items-center rounded-[5px] border border-dashed border-white/[0.12] text-xs text-white/45">
                    Trigger a run to see logs.
                  </div>
                )}
                {runs.length ? (
                  <div className="mt-3 border-t border-white/[0.08] pt-2">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-white/45">
                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                      Recent
                    </div>
                    <div className="flex gap-1 overflow-x-auto">
                      {runs.slice(0, 5).map((run) => (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => void loadRun(run.id)}
                          className="shrink-0 rounded-[5px] border border-white/[0.08] px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.08]"
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
        ) : null}

        {workbenchTab === "profile" ? <ProfileSetupPanel /> : null}
        {workbenchTab === "inputs" ? (
          <SecretsParamsPanel params={state.params} secrets={state.secrets} workflowId={workflow.id} />
        ) : null}
      </div>
    </main>
  );
}
