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
import {
  saveRun,
  getRun,
  claimQueuedRun,
  deferRun,
  setRunProgress,
  appendRunEvent,
  appendRunArtifact,
} from "./db/runs-repo";
import { getWorkflow } from "./db/workflows-repo";
import { getAutomation, getAutomationByWorkflowId } from "./db/automations-repo";
import { evaluateEvidenceChecks } from "./evidence-checks";
import { touchEnvironment } from "./db/environments-repo";
import { addEvidence } from "./db/evidence-repo";
import {
  getOpenTakeoverForRun,
  openTakeover,
  markTakeoverNotified,
  markTakeoverEscalated,
  listStaleOpenTakeovers,
} from "./db/takeovers-repo";
import { loadSecrets } from "./db/secrets-repo";
import { recordRunMetric } from "./db/run-metrics-repo";
import { seedFleetState } from "./seed";
import { notifyRun, notifyTakeoverEscalation } from "./notify";
import { fetchEmailOtpImap } from "./email-imap";
import type { TriggerExecute } from "./triggers/triggers-runtime";
import type { FleetState, TriggerSource, Workflow, WorkflowRun } from "./types";

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
    "CUF_GROUNDING_ENGINE_TYPE",
    "CUF_AGENT_BACKEND",
  ];
  const forwarded = Object.fromEntries(
    keys.filter((k) => env[k] != null).map((k) => [k, env[k] as string]),
  );
  // pyautogui must talk to the guest's autologin X session (xhost +local: on the
  // guest grants access; XAUTHORITY is a fallback if the session uses a cookie).
  return {
    DISPLAY: env.CUF_GUEST_DISPLAY ?? ":0",
    XAUTHORITY: env.CUF_GUEST_XAUTHORITY ?? "/home/agent/.Xauthority",
    PLAYWRIGHT_BROWSERS_PATH: env.CUF_PLAYWRIGHT_BROWSERS_PATH ?? "/opt/agent/pw-browsers",
    ...forwarded,
  };
}

export type ExecuteOptions = {
  now?: () => string;
  db?: Db;
  triggerId?: string;
  /** Run-level params (e.g. a webhook payload) — override workflow/global params. */
  params?: Record<string, string | number | boolean | null>;
  /** Automation this run belongs to. Resolved from the workflow when omitted. */
  automationId?: string;
  environmentId?: string;
  triggerSource?: TriggerSource;
  /** Branch/PR association for semantic tests and Archductor-triggered runs. */
  branchRef?: string;
  prRef?: string;
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
  // Production execution should only see configured/persisted real VMs. The
  // demo seed VMs have no libvirt domain and must not show up as capacity.
  const configuredVms = realVmsFromEnv();
  const daemon = createVmDaemon(client, configuredVms.length ? configuredVms : state.vms);
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
    httpFetch: fetch,
    emailOtp: fetchEmailOtpImap,
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
  // An automation must run ITS workflow — falling back to the seed workflow would
  // execute an unrelated task while attributing the run + evidence to the automation.
  if (opts.automationId && workflowId && workflow.id !== workflowId) {
    throw new Error(`workflow ${workflowId} not found for automation ${opts.automationId}`);
  }
  // Link the run to its automation (and inherit the prepared environment) so run
  // history, evidence, and health all attach to the user-facing object.
  const automation = opts.automationId ? undefined : getAutomationByWorkflowId(db, workflow.id);
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
    automationId: opts.automationId ?? automation?.id,
    environmentId: opts.environmentId ?? automation?.environmentId,
    triggerSource: opts.triggerSource,
    branchRef: opts.branchRef,
    prRef: opts.prRef,
  };
  saveRun(db, run);
  if (opts.params && Object.keys(opts.params).length) {
    db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run(JSON.stringify(opts.params), run.id);
  }
  return run;
}

/** Merge run-level params (from params_json) over the workflow/global seed params. */
function resolveParams(db: Db, state: FleetState, runId: string): FleetState["params"] {
  const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(runId) as
    | { params_json: string }
    | undefined;
  const runParams = row ? (JSON.parse(row.params_json || "{}") as Record<string, unknown>) : {};
  const byName = new Map(state.params.map((p) => [p.name, p]));
  for (const [name, value] of Object.entries(runParams)) {
    byName.set(name, { id: `param_${name}`, name, scope: "run", value: value as FleetState["params"][number]["value"] });
  }
  return [...byName.values()];
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
  // Checkpoint retry / takeover resume: `__resumeFrom` in the run params names the
  // node to start from (set by POST /api/runs/:id/action, consumed once here).
  const paramRow = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(runId) as
    | { params_json: string }
    | undefined;
  const resumeFrom = (JSON.parse(paramRow?.params_json || "{}") as Record<string, unknown>).__resumeFrom;
  const run = await runWorkflow(
    {
      workflow,
      secrets: resolveSecrets(db, state),
      params: resolveParams(db, state, runId),
      runId,
      startNodeId: typeof resumeFrom === "string" ? resumeFrom : undefined,
    },
    {
      ...buildRunDeps(state, now),
      onProgress: (_nodeId, nodeName) => setRunProgress(db, runId, nodeName),
      // Stream events + artifacts into the db as they happen so the run view is a
      // live "watch it run" surface, not a post-hoc report. Same ids as the final
      // saveRun, so the settle-time write replaces these rows.
      onEvent: (event, seq) => appendRunEvent(db, runId, event, seq),
      onArtifact: (artifact) => appendRunArtifact(db, artifact),
    },
  );
  // Carry linkage the orchestrator doesn't know about, and summarize settled runs.
  const settled = run.status !== "queued";
  const lastEvent = run.events[run.events.length - 1];
  const merged: WorkflowRun = {
    ...run,
    triggerId: existing.triggerId,
    automationId: existing.automationId,
    environmentId: existing.environmentId,
    triggerSource: existing.triggerSource,
    branchRef: existing.branchRef,
    prRef: existing.prRef,
    resultSummary: settled ? `${run.status}${lastEvent ? ` — ${lastEvent.message}` : ""}` : undefined,
  };
  saveRun(db, merged);
  recordRunSideEffects(db, merged, now);
  // Telemetry for later optimization (queue wait + execution time). existing
  // .startedAt is the enqueue time; run.startedAt is when execution began.
  if (settled) {
    const enqueuedAt = new Date(existing.startedAt).getTime();
    const execStart = new Date(run.startedAt).getTime();
    const execEnd = run.finishedAt ? new Date(run.finishedAt).getTime() : undefined;
    recordRunMetric(db, {
      runId,
      automationId: merged.automationId,
      environmentId: merged.environmentId,
      vmId: merged.vmId,
      status: merged.status,
      queuedMs: Number.isFinite(execStart - enqueuedAt) ? Math.max(0, execStart - enqueuedAt) : undefined,
      executionMs: execEnd != null && Number.isFinite(execEnd - execStart) ? Math.max(0, execEnd - execStart) : undefined,
      createdAt: now(),
    });
  }
  // No VM available -> stays queued; back off so the worker retries later instead
  // of spinning on it.
  if (run.status === "queued") {
    const backoffMs = Number(process.env.CUF_RUN_BACKOFF_MS ?? "30000");
    deferRun(db, runId, new Date(Date.now() + backoffMs).toISOString());
  }
  // Page an operator when a human is needed (or on failure), and record on the
  // takeover that the page actually went out (shown in the paused run view).
  const vm = realVmsFromEnv().find((v) => v.id === run.vmId);
  const notified = await notifyRun(run, { xrdp: vm?.xrdp });
  if (notified && merged.status === "paused") {
    const takeover = getOpenTakeoverForRun(db, runId);
    if (takeover) markTakeoverNotified(db, takeover.id, now());
  }
}

/** Re-page the operator for takeovers nobody responded to within
 * CUF_TAKEOVER_ESCALATE_MIN (default 30) minutes. Called from the worker loop;
 * each takeover escalates at most once. Returns how many reminders were sent. */
export async function escalateStaleTakeovers(
  db: Db = getDb(),
  now = () => new Date().toISOString(),
): Promise<number> {
  const minutes = Number(process.env.CUF_TAKEOVER_ESCALATE_MIN ?? "30");
  const cutoff = new Date(new Date(now()).getTime() - minutes * 60_000).toISOString();
  let escalated = 0;
  for (const takeover of listStaleOpenTakeovers(db, cutoff)) {
    const waitedMinutes = Math.round(
      (new Date(now()).getTime() - new Date(takeover.openedAt).getTime()) / 60_000,
    );
    if (await notifyTakeoverEscalation(takeover, waitedMinutes)) {
      markTakeoverEscalated(db, takeover.id, now());
      escalated++;
    }
  }
  return escalated;
}

/** Post-run bookkeeping: evidence rows from artifacts, a takeover record when the
 * run paused for a human, and environment usage tracking. */
function recordRunSideEffects(db: Db, run: WorkflowRun, now: () => string): void {
  if (run.status === "queued") return;
  const imageExt = /\.(png|jpe?g)$/i;
  (run.artifacts ?? []).forEach((a, i) => {
    addEvidence(db, {
      id: `ev_${run.id}_${i}`,
      runId: run.id,
      automationId: run.automationId,
      type: imageExt.test(a.path) ? "screenshot" : "file",
      artifactRef: basename(a.path),
      stepId: a.nodeId,
      description: `Captured by "${run.workflowName}"`,
      createdAt: a.createdAt,
    });
  });
  // Machine-evaluated evidence checks (text found, URL reached, files, screenshots).
  const automation = run.automationId ? getAutomation(db, run.automationId) : undefined;
  if (automation?.evidenceChecks?.length && (run.status === "succeeded" || run.status === "failed")) {
    evaluateEvidenceChecks(automation.evidenceChecks, run).forEach((result, i) => {
      addEvidence(db, {
        id: `ev_check_${run.id}_${i}`,
        runId: run.id,
        automationId: run.automationId,
        type: "check",
        description: `${result.check.type}${result.check.value ? `: ${result.check.value}` : ""} — ${result.detail}`,
        verdict: result.verdict,
        createdAt: now(),
      });
    });
  }
  if (run.status === "paused" && !getOpenTakeoverForRun(db, run.id)) {
    openTakeover(db, {
      id: `tk_${run.id}_${now()}`,
      runId: run.id,
      environmentId: run.environmentId,
      vmId: run.vmId,
      reason: `Paused at "${run.currentStep ?? "unknown step"}"`,
      requestedAction: run.pausedReason ?? "Open the desktop and finish the blocked step, then resume.",
      status: "open",
      openedAt: now(),
    });
  }
  if (run.environmentId) touchEnvironment(db, run.environmentId, now());
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
  // Piggyback on the worker cadence: remind the operator about takeovers nobody
  // has picked up. Best-effort — never fails the queue drain.
  await escalateStaleTakeovers(db).catch(() => undefined);
  return processed;
}

/** Trigger executor: enqueue a run (worker processes it). Keeps triggers fast +
 * hostable. */
export function makeTriggerExecute(db?: Db): TriggerExecute {
  return async (trigger, payload) =>
    enqueueManualRun(trigger.workflowId, {
      db,
      triggerId: trigger.id,
      params: payload as ExecuteOptions["params"],
      triggerSource: trigger.type === "schedule" ? "schedule" : trigger.type === "webhook" ? "webhook" : "manual",
      // Webhook payloads (e.g. from Archductor or CI) can associate the run with
      // a branch/PR so its evidence is retrievable from review.
      branchRef: typeof payload?.branch === "string" ? payload.branch : undefined,
      prRef: payload?.pr != null ? String(payload.pr) : undefined,
    });
}
