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
import { getDb, type Db } from "./db/db";
import { saveRun } from "./db/runs-repo";
import { loadSecrets } from "./db/secrets-repo";
import { seedFleetState } from "./seed";
import type { TriggerExecute } from "./triggers/triggers-runtime";
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

export type ExecuteOptions = {
  now?: () => string;
  db?: Db;
  triggerId?: string;
};

/** Prefer encrypted secrets from the db (production); fall back to seed secrets
 * when no CUF_SECRET_KEY is configured (dev). Db secrets override seed by name. */
function resolveSecrets(db: Db, state: FleetState): FleetState["secrets"] {
  if (!process.env.CUF_SECRET_KEY) return state.secrets;
  try {
    const dbSecrets = loadSecrets(db);
    const byName = new Map(state.secrets.map((s) => [s.name, s]));
    for (const s of dbSecrets) byName.set(s.name, s);
    return [...byName.values()];
  } catch {
    return state.secrets; // never fail a run on secret-store issues; redaction still applies
  }
}

export async function executeManualRun(
  state: FleetState,
  workflow: Workflow,
  opts: ExecuteOptions = {},
): Promise<WorkflowRun> {
  const now = opts.now ?? (() => new Date().toISOString());
  const db = opts.db ?? getDb();
  const uri = process.env.CUF_LIBVIRT_URI ?? "qemu:///session";
  const client = createVirshClient(execVirshRunner(), uri);
  // Real domain-bound VMs (from env) first, then mock seed VMs for display.
  const daemon = createVmDaemon(client, [...realVmsFromEnv(), ...state.vms]);
  const runId = `run_${runCounter++}_${now()}`;

  const run = await runWorkflow(
    { workflow, secrets: resolveSecrets(db, state), params: state.params, runId },
    { daemon, exec: spawnExecRunner, now, env: guestEnv() },
  );
  saveRun(db, opts.triggerId ? { ...run, triggerId: opts.triggerId } : run);
  return run;
}

/** Executor for schedule/webhook triggers: resolves the trigger's workflow from
 * seed state and runs it, tagging the run with the trigger id. */
export function makeTriggerExecute(db?: Db): TriggerExecute {
  return async (trigger) => {
    const state = seedFleetState();
    const workflow = state.workflows.find((w) => w.id === trigger.workflowId) ?? state.workflows[0];
    return executeManualRun(state, workflow, { db, triggerId: trigger.id });
  };
}
