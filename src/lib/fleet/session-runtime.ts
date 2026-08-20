// Server side of computer-use sessions: the I/O the pure `sessions.ts` core does
// not do. Node runtime only — libvirt + ssh + the database.
//
// This is the surface outside agents (OpenClaw, Hermes) drive archfleet through.
// It deliberately does NOT reimplement the engine: task mode compiles to a
// workflow and goes through the same runner an automation does, so an agent's
// ad-hoc request gets takeover, evidence, secrets and redaction for free.

import { basename } from "node:path";
import { mkdirSync } from "node:fs";
import { getDb, type Db } from "./db/db";
import { getEnvironment } from "./db/environments-repo";
import { getSession, listExpiredSessions, listSessions, saveSession, updateSession } from "./db/sessions-repo";
import { saveWorkflow } from "./db/workflows-repo";
import { getRun, cancelRun } from "./db/runs-repo";
import { getOpenTakeoverForRun } from "./db/takeovers-repo";
import { enqueueManualRun, environmentLabels, fleetDaemon, fleetVms } from "./server-runtime";
import { profileSourceVm, startProfileOperation } from "./profile-ops";
import { runComputerUseTask, type ExecRunner, type GuestConnection, type GuestReport } from "./computer-use";
import type { VmDaemon } from "./vm-daemon/daemon";
import { spawnExecRunner, scpFetch } from "./ssh-exec";
import {
  DESKTOP_RUNNER_PATH,
  clampTtlMs,
  compileTaskWorkflow,
  isOpen,
  serializeActions,
  statusFromRun,
  validateActions,
  type DesktopAction,
  type Session,
  type SessionMode,
} from "./sessions";
import type { FleetVm, RunArtifact } from "./types";

let sessionCounter = 0;
const newSessionId = (now: string) => `sess_${sessionCounter++}_${now}`;

export type OpenSessionInput = {
  environmentId: string;
  mode: SessionMode;
  /** task mode: what the agent wants done, in plain language. */
  task?: string;
  ttlMs?: number;
  openedBy?: string;
};

export type SessionError = { error: string; status: number };

/** Everything that touches the outside world, injected — so the whole surface
 * unit-tests without libvirt, ssh, or a real fleet. Same shape the orchestrator
 * already uses for its own dependencies. */
export type SessionDeps = {
  db?: Db;
  now?: () => string;
  /** How to build a daemon over a set of desktops. Defaults to the real fleet. */
  daemonFor?: (vms: FleetVm[], now: () => string, db: Db) => VmDaemon;
  exec?: ExecRunner;
  fetchFile?: typeof scpFetch;
};

const fail = (status: number, error: string): SessionError => ({ error, status });
const isError = (v: unknown): v is SessionError =>
  typeof v === "object" && v !== null && "error" in v && "status" in v;

export { isError as isSessionError };

/** Open a session on a prepared environment. */
export async function openSession(
  input: OpenSessionInput,
  opts: SessionDeps = {},
): Promise<Session | SessionError> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();

  const environment = getEnvironment(db, input.environmentId);
  if (!environment) return fail(404, `environment ${input.environmentId} not found`);
  if (input.mode === "task" && !input.task?.trim()) {
    return fail(400, "task is required for a task session");
  }
  if (input.mode === "persist" && !environment.profileRef) {
    // Without a profile there is no source desktop to sign in on, and nothing to
    // capture back into.
    return fail(400, `environment "${environment.name}" has no fleet profile to persist into`);
  }

  const ttlMs = clampTtlMs(input.ttlMs);
  const id = newSessionId(at);
  const base: Session = {
    id,
    environmentId: environment.id,
    environmentName: environment.name,
    mode: input.mode,
    status: "starting",
    task: input.task?.trim(),
    openedBy: input.openedBy,
    expiresAt: new Date(new Date(at).getTime() + ttlMs).toISOString(),
    openedAt: at,
    updatedAt: at,
  };

  if (input.mode === "task") {
    const { labels, name } = environmentLabels(db, environment.id);
    const workflow = compileTaskWorkflow({
      sessionId: id,
      task: base.task!,
      environmentName: name,
      requiredLabels: labels,
    });
    saveWorkflow(db, workflow);
    try {
      const run = enqueueManualRun(workflow.id, {
        db,
        environmentId: environment.id,
        triggerSource: "api",
      });
      saveSession(db, { ...base, runId: run.id });
    } catch (e) {
      return fail(500, e instanceof Error ? e.message : String(e));
    }
    return getSession(db, id)!;
  }

  // lease / persist: hold a desktop directly.
  const target = await acquireDesktop(db, environment.profileRef, input.mode, id, ttlMs, now, opts);
  if (isError(target)) return target;
  saveSession(db, {
    ...base,
    status: "active",
    vmId: target.vm.id,
    domain: target.vm.domain,
  });
  return getSession(db, id)!;
}

/** Take a desktop for a lease. `persist` targets the profile's source desktop and
 * keeps its state; `lease` takes a clean clone from the pool. */
async function acquireDesktop(
  db: Db,
  profileRef: string | undefined,
  mode: SessionMode,
  sessionId: string,
  ttlMs: number,
  now: () => string,
  opts: SessionDeps,
): Promise<{ vm: FleetVm } | SessionError> {
  const requiredLabels = profileRef ? [`profile:${profileRef}`] : [];
  // The source desktop is not part of the run pool, so it is introduced to the
  // daemon explicitly. Everything else — leasing, expiry, exclusion — is the same.
  const vms = mode === "persist" ? [profileSourceVm(profileRef!, sessionId)] : fleetVms();
  const daemon = (opts.daemonFor ?? fleetDaemon)(vms, now, db);
  const acquired = await daemon.acquire({
    requiredLabels: mode === "persist" ? [] : requiredLabels,
    runId: sessionId,
    keepState: mode === "persist",
    ttlMs,
  });
  if (!acquired.ok) {
    if (acquired.reason === "no_matching_vm") {
      const wanted = requiredLabels.length ? ` matching ${requiredLabels.join(" + ")}` : "";
      return fail(409, `no desktop available${wanted} — every one is busy or none is prepared yet`);
    }
    return fail(503, `could not prepare a desktop: ${acquired.detail ?? acquired.reason}`);
  }
  return { vm: acquired.vm };
}

export type SessionView = Session & {
  /** task mode: live run state the agent polls. */
  run?: {
    id: string;
    status: string;
    currentStep?: string;
    resultSummary?: string;
    events: { level: string; timestamp: string; message: string }[];
    artifacts: { type: string; path: string }[];
  };
  /** task mode: what a paused run is asking a human for. */
  ask?: unknown;
  /** lease/persist: where a human can watch or take over. */
  desktop?: { vmId: string; domain?: string };
};

/** Session plus whatever it is a view onto. For a task session that is the run,
 * so an agent polls one object rather than correlating two. */
export function getSessionView(db: Db, id: string): SessionView | undefined {
  const session = getSession(db, id);
  if (!session) return undefined;
  if (session.mode !== "task" || !session.runId) {
    return session.vmId ? { ...session, desktop: { vmId: session.vmId, domain: session.domain } } : session;
  }
  const run = getRun(db, session.runId);
  if (!run) return session;
  const takeover = getOpenTakeoverForRun(db, run.id);
  return {
    ...session,
    // The run is the source of truth for a task session's status — it advances
    // in a worker, not in whatever request last touched the session row.
    status: isOpen(session) ? statusFromRun(run.status) : session.status,
    run: {
      id: run.id,
      status: run.status,
      currentStep: run.currentStep,
      resultSummary: run.resultSummary,
      events: run.events.map((e) => ({ level: e.level, timestamp: e.timestamp, message: e.message })),
      artifacts: (run.artifacts ?? []).map((a) => ({ type: a.type, path: a.path })),
    },
    ask: takeover?.ask,
  };
}

export function listSessionViews(db: Db, opts: { open?: boolean; environmentId?: string } = {}): SessionView[] {
  return listSessions(db, opts)
    .map((s) => getSessionView(db, s.id))
    .filter((s): s is SessionView => Boolean(s));
}

export type ActResult = {
  report: GuestReport;
  /** Screenshots and files the batch produced, fetched back off the guest. */
  artifacts: { type: string; path: string }[];
  expiresAt: string;
};

/** Run a batch of desktop primitives on a leased desktop. */
export async function actOnSession(
  db: Db,
  id: string,
  actions: unknown,
  opts: SessionDeps = {},
): Promise<ActResult | SessionError> {
  const now = opts.now ?? (() => new Date().toISOString());
  const session = getSession(db, id);
  if (!session) return fail(404, `session ${id} not found`);
  if (session.mode === "task") {
    return fail(
      400,
      "a task session is driven by archfleet — poll it, or open a lease session to drive the desktop yourself",
    );
  }
  if (!isOpen(session)) return fail(409, `session is ${session.status}`);

  const errors = validateActions(actions);
  // Reject the whole batch: a half-applied one leaves the agent's model of the
  // screen silently wrong.
  if (errors.length) return fail(400, errors.join("; "));

  const vm = resolveSessionVm(db, session);
  if (!vm) return fail(410, "session has no desktop");

  // Renewing before the work means a long batch cannot have its desktop swept
  // out from under it mid-run.
  const at = now();
  const daemon = (opts.daemonFor ?? fleetDaemon)([vm], () => at, db);
  const ttlMs = new Date(session.expiresAt).getTime() - new Date(session.openedAt).getTime();
  if (!daemon.renew(vm, session.id, ttlMs)) {
    updateSession(db, id, { status: "failed", resultSummary: "lease lost", closedAt: at }, at);
    return fail(409, "lease lost — the desktop was reclaimed. Open a new session.");
  }
  const expiresAt = new Date(new Date(at).getTime() + ttlMs).toISOString();

  const conn = guestConn(vm);
  let report: GuestReport;
  try {
    report = await runComputerUseTask(
      conn,
      { instruction: serializeActions(actions as DesktopAction[]) },
      opts.exec ?? spawnExecRunner,
      { DISPLAY: process.env.CUF_GUEST_DISPLAY ?? ":0", CUF_RUN_ID: session.id },
    );
  } catch (e) {
    // Keep the lease: the agent should decide whether to retry or close, rather
    // than losing the desktop to one flaky ssh call.
    return fail(502, e instanceof Error ? e.message : String(e));
  }

  const artifacts = await fetchGuestArtifacts(
    conn,
    report.artifacts,
    session.id,
    at,
    opts.fetchFile ?? scpFetch,
  );
  updateSession(db, id, { status: "active", expiresAt }, at);
  return { report, artifacts: artifacts.map((a) => ({ type: a.type, path: a.path })), expiresAt };
}

/** Close a session and hand the desktop back. */
export async function closeSession(
  db: Db,
  id: string,
  opts: SessionDeps & { summary?: string } = {},
): Promise<Session | SessionError> {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const session = getSession(db, id);
  if (!session) return fail(404, `session ${id} not found`);
  if (!isOpen(session)) return session;

  if (session.mode === "task" && session.runId) {
    // Cancelling releases the desktop through the run's own path.
    cancelRun(db, session.runId);
  } else {
    const vm = resolveSessionVm(db, session);
    if (vm) {
      const daemon = (opts.daemonFor ?? fleetDaemon)([vm], () => at, db);
      // persist keeps whatever was done — that is the entire point of the mode.
      await daemon.release(vm, { holder: session.id, keepState: session.mode === "persist" });
    }
  }
  updateSession(
    db,
    id,
    { status: "closed", closedAt: at, resultSummary: opts.summary ?? session.resultSummary },
    at,
  );
  return getSession(db, id)!;
}

/** Promote a persist session's desktop back into its profile: re-snapshot the
 * source and re-clone the pool, so every later run starts from the new sign-in.
 *
 * Returns the profile operation — it is long-running and streams its own logs,
 * and it stops for a human to confirm the capture, exactly as it does today. */
export function captureSession(
  db: Db,
  id: string,
  opts: { now?: () => string; clones?: number } = {},
): { session: Session; operationId: string } | SessionError {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const session = getSession(db, id);
  if (!session) return fail(404, `session ${id} not found`);
  if (session.mode !== "persist") {
    return fail(400, "only a persist session holds changes worth capturing");
  }
  if (!isOpen(session)) return fail(409, `session is ${session.status}`);
  const environment = getEnvironment(db, session.environmentId);
  if (!environment?.profileRef) return fail(400, "environment has no fleet profile");

  try {
    const op = startProfileOperation({
      action: "update",
      profile: environment.profileRef,
      clones: opts.clones ?? 2,
      task: session.task,
    });
    updateSession(db, id, { capturedAt: at, status: "closing" }, at);
    return { session: getSession(db, id)!, operationId: op.id };
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }
}

/** Close sessions whose holder walked away, handing their desktops back. Called
 * from the worker loop. Returns how many were reclaimed. */
export async function sweepExpiredSessions(
  db: Db,
  now: () => string = () => new Date().toISOString(),
  opts: SessionDeps = {},
): Promise<number> {
  const at = now();
  const expired = listExpiredSessions(db, at);
  for (const session of expired) {
    await closeSession(db, session.id, {
      ...opts,
      now,
      summary: "expired — no activity before the lease ran out",
    });
  }
  return expired.length;
}

// --------------------------------------------------------------------------- //

/** The desktop a session is holding.
 *
 * A pool desktop is looked up in the configured fleet. A persist session's
 * source desktop is not in that fleet at all, so it is rebuilt from the
 * environment's profile by the same helper that produced it at open time —
 * pinned to the domain actually recorded on the session, so a later change to
 * `CUF_GOLDEN_DOMAIN` cannot redirect an open session onto a different machine. */
function resolveSessionVm(db: Db, session: Session): FleetVm | undefined {
  if (session.mode !== "persist") {
    return fleetVms().find((v) => v.id === session.vmId);
  }
  const profileRef = getEnvironment(db, session.environmentId)?.profileRef;
  if (!profileRef || !session.vmId) return undefined;
  const vm = profileSourceVm(profileRef, session.id);
  return { ...vm, id: session.vmId, domain: session.domain ?? vm.domain };
}

function guestConn(vm: FleetVm): GuestConnection {
  const ssh = vm.ssh ?? { host: vm.xrdp.host, port: 22, username: vm.xrdp.username };
  return {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    identityFile: process.env.CUF_SSH_KEY,
    // Scripted primitives, not the LLM loop — same runner `script_task` uses.
    runnerPath: DESKTOP_RUNNER_PATH,
  };
}

/** scp a batch's screenshots/files back so the agent can actually see them. */
async function fetchGuestArtifacts(
  conn: GuestConnection,
  remotePaths: string[],
  sessionId: string,
  at: string,
  fetchFile: typeof scpFetch,
): Promise<RunArtifact[]> {
  if (!remotePaths.length) return [];
  const baseDir = process.env.CUF_ARTIFACT_DIR ?? `${process.cwd()}/data/artifacts`;
  const destDir = `${baseDir}/${sessionId}`;
  mkdirSync(destDir, { recursive: true });
  const out: RunArtifact[] = [];
  for (const remote of remotePaths) {
    const local = `${destDir}/${basename(remote)}`;
    const res = await fetchFile(conn, remote, local);
    out.push({
      id: `art_${sessionId}_${out.length}`,
      runId: sessionId,
      type: /\.(png|jpe?g)$/i.test(remote) ? "screenshot" : "file",
      path: res.code === 0 ? local : remote,
      metadata: res.code === 0 ? undefined : { fetchError: res.stderr.trim() },
      createdAt: at,
    });
  }
  return out;
}
