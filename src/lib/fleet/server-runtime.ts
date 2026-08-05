// Server-only entry that runs the REAL orchestrator: wires the libvirt daemon
// (spawning virsh) + SSH guest transport + env-configured fleet, then executes a
// workflow. Node runtime only — never import from a client component.
//
// With no real VM configured (no CUF_GOLDEN_DOMAIN, seed VMs have no domain), the
// daemon has nothing to acquire and the run comes back `queued` — the honest state
// until `build-golden.sh` has produced a warm VM.

import { createVmDaemon } from "./vm-daemon/daemon";
import { createVirshClient } from "./vm-daemon/virsh";
import { execVirshRunner } from "./vm-daemon/exec-runner";
import { realVmsFromEnv } from "./vm-daemon/fleet-config";
import { spawnExecRunner } from "./ssh-exec";
import { runWorkflow } from "./orchestrator";
import type { FleetState, Workflow, WorkflowRun } from "./types";

let runCounter = 0;

/** Guest-runner env forwarded from the controller process (planner + grounding). */
function guestEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const keys = [
    "OPENROUTER_API_KEY",
    "CUF_PLANNER_MODEL",
    "CUF_OPENROUTER_BASE_URL",
    "CUF_GROUNDING_MODEL",
    "CUF_GROUNDING_BASE_URL",
    "CUF_GROUNDING_API_KEY",
  ];
  return Object.fromEntries(
    keys.filter((k) => env[k] != null).map((k) => [k, env[k] as string]),
  );
}

export async function executeManualRun(
  state: FleetState,
  workflow: Workflow,
  now: () => string = () => new Date().toISOString(),
): Promise<WorkflowRun> {
  const uri = process.env.CUF_LIBVIRT_URI ?? "qemu:///session";
  const client = createVirshClient(execVirshRunner(), uri);
  // Real domain-bound VMs (from env) first, then mock seed VMs for display.
  const daemon = createVmDaemon(client, [...realVmsFromEnv(), ...state.vms]);
  const runId = `run_${runCounter++}_${now()}`;

  return runWorkflow(
    { workflow, secrets: state.secrets, params: state.params, runId },
    { daemon, exec: spawnExecRunner, now, env: guestEnv() },
  );
}
