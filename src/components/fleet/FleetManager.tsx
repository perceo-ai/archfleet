"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { FleetSidebar } from "./FleetSidebar";
import { RunPanel, type RunSummary } from "./RunPanel";
import { SecretsParamsPanel } from "./SecretsParamsPanel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { seedFleetState } from "@/lib/fleet/seed";
import type { FleetVm, WorkflowRun } from "@/lib/fleet/types";

export function FleetManager() {
  const state = useMemo(() => seedFleetState(), []);
  const workflow = state.workflows[0];
  const [latestRun, setLatestRun] = useState<WorkflowRun>();
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [vms, setVms] = useState<FleetVm[]>(state.vms);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return (
    <main className="grid min-h-screen grid-rows-[auto_1fr] bg-zinc-100 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="flex h-16 items-center justify-between px-5">
          <div>
            <h1 className="text-lg font-semibold tracking-normal">Computer Use Fleet</h1>
            <p className="text-xs text-zinc-500">
              Local VM orchestration, visual workflows, XRDP takeover, and CLI-first agents.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2.5 py-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {idleVms} idle VMs
            </div>
            <div className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2.5 py-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              {activeRuns} active runs
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)_360px]">
        <FleetSidebar vms={vms} />
        <div className="grid min-h-0 grid-rows-[1fr_auto]">
          <WorkflowCanvas
            workflow={workflow}
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
          <SecretsParamsPanel params={state.params} secrets={state.secrets} workflowId={workflow.id} />
        </div>
        <RunPanel
          latestRun={latestRun}
          secrets={state.secrets}
          onRun={runWorkflow}
          running={running}
          runs={runs}
          onSelectRun={loadRun}
        />
      </div>
    </main>
  );
}
