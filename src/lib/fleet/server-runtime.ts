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
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { spawnExecRunner, spawnAgentExec, scpFetch, spawnShellExec } from "./ssh-exec";
import { runWorkflow, type OrchestratorDeps } from "./orchestrator";
import type { GuestConnection } from "./computer-use";
import type { RunArtifact } from "./types";
import { getDb, type Db } from "./db/db";
import { saveRun, getRun, claimQueuedRun, deferRun } from "./db/runs-repo";
import { getWorkflow } from "./db/workflows-repo";
import { loadSecrets } from "./db/secrets-repo";
import { seedFleetState } from "./seed";
import type { TriggerExecute } from "./triggers/triggers-runtime";
import type { FleetState, Workflow, WorkflowRun } from "./types";

let runCounter = 0;
const newRunId = (now: () => string) => `run_${runCounter++}_${now()}`;

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
  const forwarded = Object.fromEntries(
    keys.filter((k) => env[k] != null).map((k) => [k, env[k] as string]),
  );
  // pyautogui must talk to the guest's autologin X session (xhost +local: on the
  // guest grants access; XAUTHORITY is a fallback if the session uses a cookie).
  return {
    DISPLAY: env.CUF_GUEST_DISPLAY ?? ":0",
    XAUTHORITY: env.CUF_GUEST_XAUTHORITY ?? "/home/agent/.Xauthority",
    ...forwarded,
  };
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

/** Assemble the real orchestrator dependencies (libvirt daemon + SSH transport). */
function buildRunDeps(state: FleetState, now: () => string): OrchestratorDeps {
  const uri = process.env.CUF_LIBVIRT_URI ?? "qemu:///session";
  const client = createVirshClient(execVirshRunner(), uri);
  // Real domain-bound VMs (from env) first, then mock seed VMs for display.
  const daemon = createVmDaemon(client, [...realVmsFromEnv(), ...state.vms]);
  return {
    daemon,
    exec: spawnExecRunner,
    agentExec: spawnAgentExec,
    now,
    env: guestEnv(),
    sshIdentityFile: process.env.CUF_SSH_KEY,
    fetchArtifacts: makeFetchArtifacts(now),
    // shell_task is off unless explicitly enabled (runs arbitrary controller commands).
    shellExec: process.env.CUF_ALLOW_SHELL === "1" ? spawnShellExec : undefined,
  };
}

/** scp guest artifact files into ./data/artifacts/<runId>/ (or CUF_ARTIFACT_DIR). */
function makeFetchArtifacts(now: () => string): OrchestratorDeps["fetchArtifacts"] {
  return async (conn: GuestConnection, remotePaths, runId, nodeId) => {
    const baseDir = process.env.CUF_ARTIFACT_DIR ?? `${process.cwd()}/data/artifacts`;
    const destDir = `${baseDir}/${runId}`;
    mkdirSync(destDir, { recursive: true });
    const out: RunArtifact[] = [];
    for (const remote of remotePaths) {
      const local = `${destDir}/${basename(remote)}`;
      const res = await scpFetch(conn, remote, local);
      out.push({
        id: `art_${runId}_${out.length}`,
        runId,
        nodeId,
        type: "file",
        path: res.code === 0 ? local : remote, // fall back to guest path if scp failed
        metadata: res.code === 0 ? undefined : { fetchError: res.stderr.trim() },
        createdAt: now(),
      });
    }
    return out;
  };
}

/** Run a workflow synchronously to completion + persist. (Direct/testing path.) */
export async function executeManualRun(
  state: FleetState,
  workflow: Workflow,
  opts: ExecuteOptions = {},
): Promise<WorkflowRun> {
  const now = opts.now ?? (() => new Date().toISOString());
  const db = opts.db ?? getDb();
  const run = await runWorkflow(
    { workflow, secrets: resolveSecrets(db, state), params: state.params, runId: newRunId(now) },
    buildRunDeps(state, now),
  );
  saveRun(db, opts.triggerId ? { ...run, triggerId: opts.triggerId } : run);
  return run;
}

// --------------------------------------------------------------------------- //
// Async / durable queue — POST returns immediately, a worker executes later.
// Makes the system hostable: long computer-use runs never block a request, and
// claims are atomic so multiple worker instances are safe.
// --------------------------------------------------------------------------- //

/** Persist a queued run and return it immediately (no execution). */
export function enqueueManualRun(
  workflowId: string | undefined,
  opts: ExecuteOptions = {},
): WorkflowRun {
  const now = opts.now ?? (() => new Date().toISOString());
  const db = opts.db ?? getDb();
  const state = seedFleetState();
  const workflow =
    (workflowId ? getWorkflow(db, workflowId) : undefined) ??
    state.workflows.find((w) => w.id === workflowId) ??
    state.workflows[0];
  const run: WorkflowRun = {
    id: newRunId(now),
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: "queued",
    triggerId: opts.triggerId,
    startedAt: now(),
    events: [
      { id: `evt_enqueue_${now()}`, level: "info", timestamp: now(), message: `Queued ${workflow.name}.` },
    ],
  };
  saveRun(db, run);
  return run;
}

/** Execute a persisted run by id (claimed by the worker). */
export async function executeRunById(db: Db, runId: string, now = () => new Date().toISOString()): Promise<void> {
  const existing = getRun(db, runId);
  if (!existing) return;
  const state = seedFleetState();
  const workflow =
    getWorkflow(db, existing.workflowId) ??
    state.workflows.find((w) => w.id === existing.workflowId) ??
    state.workflows[0];
  const run = await runWorkflow(
    { workflow, secrets: resolveSecrets(db, state), params: state.params, runId },
    buildRunDeps(state, now),
  );
  saveRun(db, existing.triggerId ? { ...run, triggerId: existing.triggerId } : run);
  // No VM available -> stays queued; back off so the worker retries later instead
  // of spinning on it.
  if (run.status === "queued") {
    const backoffMs = Number(process.env.CUF_RUN_BACKOFF_MS ?? "30000");
    deferRun(db, runId, new Date(Date.now() + backoffMs).toISOString());
  }
}

/** Process up to `max` queued runs. Returns how many were executed. Call from a
 * worker loop (instrumentation) or an external cron (POST /api/runs/process). */
export async function processPendingRuns(db: Db = getDb(), max = 5): Promise<number> {
  let processed = 0;
  for (let i = 0; i < max; i++) {
    const runId = claimQueuedRun(db);
    if (!runId) break;
    await executeRunById(db, runId);
    processed++;
  }
  return processed;
}

/** Trigger executor: enqueue a run (worker processes it). Keeps triggers fast +
 * hostable. */
export function makeTriggerExecute(db?: Db): TriggerExecute {
  return async (trigger) =>
    enqueueManualRun(trigger.workflowId, { db, triggerId: trigger.id });
}
