"use client";

import { useMemo, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { FleetSidebar } from "./FleetSidebar";
import { RunPanel } from "./RunPanel";
import { SecretsParamsPanel } from "./SecretsParamsPanel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { seedFleetState } from "@/lib/fleet/seed";
import { createManualRun } from "@/lib/fleet/runtime";
import type { WorkflowRun } from "@/lib/fleet/types";

export function FleetManager() {
  const state = useMemo(() => seedFleetState(), []);
  const workflow = state.workflows[0];
  const [latestRun, setLatestRun] = useState<WorkflowRun>();

  function runWorkflow() {
    setLatestRun(
      createManualRun({
        workflow,
        vms: state.vms,
        params: state.params,
        secrets: state.secrets,
      }),
    );
  }

  const idleVms = state.vms.filter((vm) => vm.status === "idle").length;
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
        <FleetSidebar vms={state.vms} />
        <div className="grid min-h-0 grid-rows-[1fr_auto]">
          <WorkflowCanvas workflow={workflow} />
          <SecretsParamsPanel params={state.params} secrets={state.secrets} />
        </div>
        <RunPanel latestRun={latestRun} secrets={state.secrets} onRun={runWorkflow} />
      </div>
    </main>
  );
}
