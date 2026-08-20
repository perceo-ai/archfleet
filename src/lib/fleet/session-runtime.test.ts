import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "./db/db";
import { saveEnvironment } from "./db/environments-repo";
import { getWorkflow } from "./db/workflows-repo";
import { getRun, saveRun } from "./db/runs-repo";
import { getSession } from "./db/sessions-repo";
import { createMemoryLeaseStore, type LeaseStore } from "./vm-daemon/lease-store";
import type { VmDaemon } from "./vm-daemon/daemon";
import type { ExecResult } from "./computer-use";
import type { FleetVm, PreparedEnvironment } from "./types";
import {
  actOnSession,
  closeSession,
  getSessionView,
  isSessionError,
  openSession,
  sweepExpiredSessions,
} from "./session-runtime";

const T0 = "2026-08-20T10:00:00.000Z";
const now = () => T0;

function environment(over: Partial<PreparedEnvironment> = {}): PreparedEnvironment {
  return {
    id: "env_portal",
    name: "Portal — logged in",
    description: "",
    labels: ["linux-desktop", "browser", "profile:portal"],
    profileRef: "portal",
    health: "ready",
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/** A daemon that leases for real (so exclusion is exercised) but never touches
 * libvirt. Records reverts so "did we wipe the desktop?" is assertable. */
function fakeDaemonFactory(opts: { leases?: LeaseStore; reverts?: string[][] } = {}) {
  const leases = opts.leases ?? createMemoryLeaseStore();
  const reverts = opts.reverts ?? [];
  const factory = (vms: FleetVm[], clock: () => string) =>
    ({
      managedVms: () => vms,
      isAssigned: (vm: FleetVm) => Boolean(vm.domain && leases.get(vm.domain, clock())),
      renew: (vm: FleetVm, holder: string, forMs: number) =>
        vm.domain
          ? leases.renew(
              vm.domain,
              holder,
              new Date(new Date(clock()).getTime() + forMs).toISOString(),
              clock(),
            )
          : false,
      acquire: async (input: { requiredLabels: string[]; runId: string; keepState?: boolean; ttlMs?: number }) => {
        const at = clock();
        const held = new Set(leases.heldDomains(at));
        const vm = vms.find(
          (v) => v.domain && !held.has(v.domain) && input.requiredLabels.every((l) => v.labels.includes(l)),
        );
        if (!vm?.domain) return { ok: false as const, reason: "no_matching_vm" as const };
        const expiresAt = new Date(new Date(at).getTime() + (input.ttlMs ?? 60_000)).toISOString();
        if (!leases.claim(vm.domain, input.runId, expiresAt, at)) {
          return { ok: false as const, reason: "no_matching_vm" as const };
        }
        if (!input.keepState) reverts.push([vm.domain, vm.warmSnapshot ?? "golden-warm"]);
        return { ok: true as const, vm: { ...vm, status: "assigned" as const, assignedRunId: input.runId }, xrdp: vm.xrdp };
      },
      release: async (vm: FleetVm, o: { holder?: string; keepState?: boolean } = {}) => {
        if (!vm.domain) return;
        leases.release(vm.domain, o.holder ?? vm.assignedRunId);
        if (!o.keepState) reverts.push([vm.domain, vm.warmSnapshot ?? "golden-warm"]);
      },
      health: async () => "idle" as const,
      xrdpMeta: (vm: FleetVm) => vm.xrdp,
      sweepExpiredLeases: () => leases.sweepExpired(clock()),
    }) as unknown as VmDaemon;
  return { factory, leases, reverts };
}

const reportExec = (report: unknown) =>
  vi.fn(async (): Promise<ExecResult> => ({ code: 0, stdout: JSON.stringify(report), stderr: "" }));

const okFetch = vi.fn(async (): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }));

let db: Db;
let priorFleet: string | undefined;
let priorArtifactDir: string | undefined;

beforeEach(() => {
  db = openDb(":memory:");
  saveEnvironment(db, environment());
  priorFleet = process.env.CUF_FLEET_JSON;
  priorArtifactDir = process.env.CUF_ARTIFACT_DIR;
  // The lease/persist paths read the configured fleet directly.
  process.env.CUF_FLEET_JSON = JSON.stringify([
    { domain: "dom-a", profile: "portal", sshPort: 10022, rdpPort: 13389 },
  ]);
  process.env.CUF_ARTIFACT_DIR = mkdtempSync(join(tmpdir(), "cuf-sessions-"));
});

afterEach(() => {
  if (priorFleet === undefined) delete process.env.CUF_FLEET_JSON;
  else process.env.CUF_FLEET_JSON = priorFleet;
  if (priorArtifactDir === undefined) delete process.env.CUF_ARTIFACT_DIR;
  else process.env.CUF_ARTIFACT_DIR = priorArtifactDir;
  db.close();
});

describe("openSession — task mode", () => {
  it("compiles the request to a run bound to the environment", async () => {
    const session = await openSession(
      { environmentId: "env_portal", mode: "task", task: "Book a room at the Ace for Tuesday" },
      { db, now },
    );
    if (isSessionError(session)) throw new Error(session.error);

    expect(session.runId).toBeTruthy();
    const run = getRun(db, session.runId!);
    expect(run?.status).toBe("queued");
    // The whole point of the binding: the ad-hoc run is tied to the signed-in
    // environment, not to whatever desktop happens to be free.
    expect(run?.environmentId).toBe("env_portal");

    const wf = getWorkflow(db, run!.workflowId);
    const node = wf?.nodes.find((n) => n.type === "computer_use_task");
    expect(node?.config.prompt).toBe("Book a room at the Ace for Tuesday");
    expect(node?.config.requiredLabels).toEqual(["profile:portal"]);
  });

  it("holds no desktop itself — the run acquires one when the worker gets to it", async () => {
    const { factory, leases } = fakeDaemonFactory();
    const session = await openSession(
      { environmentId: "env_portal", mode: "task", task: "do a thing" },
      { db, now, daemonFor: factory },
    );
    if (isSessionError(session)) throw new Error(session.error);
    expect(session.vmId).toBeUndefined();
    expect(leases.heldDomains(T0)).toEqual([]);
  });

  it("refuses an empty task rather than queuing a run that cannot mean anything", async () => {
    const res = await openSession({ environmentId: "env_portal", mode: "task", task: "   " }, { db, now });
    expect(isSessionError(res) && res.status).toBe(400);
  });

  it("refuses an unknown environment", async () => {
    const res = await openSession({ environmentId: "nope", mode: "task", task: "x" }, { db, now });
    expect(isSessionError(res) && res.status).toBe(404);
  });
});

describe("openSession — lease mode", () => {
  it("holds a desktop carrying the environment's profile", async () => {
    const { factory, leases, reverts } = fakeDaemonFactory();
    const session = await openSession(
      { environmentId: "env_portal", mode: "lease", openedBy: "hermes" },
      { db, now, daemonFor: factory },
    );
    if (isSessionError(session)) throw new Error(session.error);

    expect(session.status).toBe("active");
    expect(session.domain).toBe("dom-a");
    expect(leases.heldDomains(T0)).toEqual(["dom-a"]);
    // A plain lease starts clean.
    expect(reverts).toEqual([["dom-a", "golden-warm"]]);
  });

  it("a second agent cannot take the same desktop", async () => {
    const { factory } = fakeDaemonFactory();
    const first = await openSession({ environmentId: "env_portal", mode: "lease" }, { db, now, daemonFor: factory });
    expect(isSessionError(first)).toBe(false);
    const second = await openSession({ environmentId: "env_portal", mode: "lease" }, { db, now, daemonFor: factory });
    expect(isSessionError(second) && second.status).toBe(409);
  });

  it("names the profile it could not find a desktop for", async () => {
    saveEnvironment(db, environment({ id: "env_other", name: "Other", profileRef: "nowhere" }));
    const { factory } = fakeDaemonFactory();
    const res = await openSession({ environmentId: "env_other", mode: "lease" }, { db, now, daemonFor: factory });
    expect(isSessionError(res) && res.error).toContain("profile:nowhere");
  });
});

describe("openSession — persist mode", () => {
  it("takes the source desktop without wiping it", async () => {
    const { factory, reverts } = fakeDaemonFactory();
    const session = await openSession(
      { environmentId: "env_portal", mode: "persist" },
      { db, now, daemonFor: factory },
    );
    if (isSessionError(session)) throw new Error(session.error);
    expect(session.mode).toBe("persist");
    // Reverting here would throw away the sign-in the session exists to create.
    expect(reverts).toEqual([]);
  });

  it("refuses an environment with no profile to capture back into", async () => {
    saveEnvironment(db, environment({ id: "env_bare", name: "Bare", profileRef: undefined }));
    const res = await openSession({ environmentId: "env_bare", mode: "persist" }, { db, now });
    expect(isSessionError(res) && res.status).toBe(400);
  });
});

describe("actOnSession", () => {
  async function leased() {
    const fake = fakeDaemonFactory();
    const session = await openSession(
      { environmentId: "env_portal", mode: "lease" },
      { db, now, daemonFor: fake.factory },
    );
    if (isSessionError(session)) throw new Error(session.error);
    return { session, ...fake };
  }

  it("sends the batch to the guest and returns its report", async () => {
    const { session, factory } = await leased();
    const exec = reportExec({ status: "succeeded", reason: "ok", steps: 2, artifacts: [] });
    const res = await actOnSession(db, session.id, [{ click: [10, 20] }, { type: "hello" }], {
      now,
      daemonFor: factory,
      exec,
      fetchFile: okFetch,
    });
    if (isSessionError(res)) throw new Error(res.error);
    expect(res.report.status).toBe("succeeded");

    // The guest is driven through the scripted-desktop runner, with the batch as
    // the JSON action array it parses.
    const [, args, stdin] = exec.mock.calls[0] as unknown as [string, string[], string];
    expect(args.join(" ")).toContain("desktop_runner.py");
    expect(JSON.parse(JSON.parse(stdin).instruction)).toEqual([{ click: [10, 20] }, { type: "hello" }]);
  });

  it("fetches screenshots back so the agent can see the screen", async () => {
    const { session, factory } = await leased();
    const exec = reportExec({
      status: "succeeded",
      reason: "ok",
      steps: 1,
      artifacts: ["/tmp/cuf-artifacts/x/step_0.png"],
    });
    const res = await actOnSession(db, session.id, [{ screenshot: true }], {
      now,
      daemonFor: factory,
      exec,
      fetchFile: okFetch,
    });
    if (isSessionError(res)) throw new Error(res.error);
    expect(res.artifacts).toHaveLength(1);
    expect(res.artifacts[0].type).toBe("screenshot");
  });

  it("rejects the whole batch when any action is unknown", async () => {
    const { session, factory } = await leased();
    const exec = reportExec({ status: "succeeded", reason: "ok", steps: 0, artifacts: [] });
    const res = await actOnSession(db, session.id, [{ click: [1, 2] }, { teleport: true }], {
      now,
      daemonFor: factory,
      exec,
      fetchFile: okFetch,
    });
    expect(isSessionError(res) && res.status).toBe(400);
    // Nothing ran: a half-applied batch would desync the agent's view of the screen.
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses to drive a task session", async () => {
    const session = await openSession(
      { environmentId: "env_portal", mode: "task", task: "x" },
      { db, now },
    );
    if (isSessionError(session)) throw new Error(session.error);
    const res = await actOnSession(db, session.id, [{ click: [1, 2] }], { now });
    expect(isSessionError(res) && res.status).toBe(400);
  });

  it("reports a lost lease instead of driving someone else's desktop", async () => {
    const { session, factory, leases } = await leased();
    // Somebody else took the desktop while this agent was thinking.
    leases.release("dom-a");
    leases.claim("dom-a", "other_holder", "2026-08-20T11:00:00.000Z", T0);

    const exec = reportExec({ status: "succeeded", reason: "ok", steps: 1, artifacts: [] });
    const res = await actOnSession(db, session.id, [{ click: [1, 2] }], {
      now,
      daemonFor: factory,
      exec,
      fetchFile: okFetch,
    });
    expect(isSessionError(res) && res.status).toBe(409);
    expect(exec).not.toHaveBeenCalled();
    expect(getSession(db, session.id)?.status).toBe("failed");
  });

  it("does not resurrect a session that was closed while the actions ran", async () => {
    const { session, factory } = await leased();
    // The agent (or the sweep) closes the session while the guest is working.
    const exec = vi.fn(async (): Promise<ExecResult> => {
      await closeSession(db, session.id, { db, now, daemonFor: factory });
      return {
        code: 0,
        stdout: JSON.stringify({ status: "succeeded", reason: "ok", steps: 1, artifacts: [] }),
        stderr: "",
      };
    });

    const res = await actOnSession(db, session.id, [{ click: [1, 2] }], {
      now,
      daemonFor: factory,
      exec,
      fetchFile: okFetch,
    });

    // Reporting success here would hand back a result for a desktop we no longer
    // hold, and leave an "active" session whose lease is gone.
    expect(isSessionError(res) && res.status).toBe(409);
    expect(getSession(db, session.id)?.status).toBe("closed");
  });

  it("keeps the lease when the guest call fails, so one flaky ssh does not cost the desktop", async () => {
    const { session, factory, leases } = await leased();
    const exec = vi.fn(async (): Promise<ExecResult> => ({ code: 255, stdout: "", stderr: "ssh: connect refused" }));
    const res = await actOnSession(db, session.id, [{ click: [1, 2] }], {
      now,
      daemonFor: factory,
      exec,
      fetchFile: okFetch,
    });
    expect(isSessionError(res) && res.status).toBe(502);
    expect(leases.heldDomains(T0)).toEqual(["dom-a"]);
    expect(getSession(db, session.id)?.status).toBe("active");
  });
});

describe("closeSession", () => {
  it("hands a leased desktop back, clean", async () => {
    const { factory, leases, reverts } = fakeDaemonFactory();
    const session = await openSession({ environmentId: "env_portal", mode: "lease" }, { db, now, daemonFor: factory });
    if (isSessionError(session)) throw new Error(session.error);

    await closeSession(db, session.id, { db, now, daemonFor: factory });
    expect(leases.heldDomains(T0)).toEqual([]);
    expect(reverts).toHaveLength(2); // acquire + release
    expect(getSession(db, session.id)?.status).toBe("closed");
  });

  it("leaves a persist session's work in place", async () => {
    const { factory, reverts } = fakeDaemonFactory();
    const session = await openSession({ environmentId: "env_portal", mode: "persist" }, { db, now, daemonFor: factory });
    if (isSessionError(session)) throw new Error(session.error);

    await closeSession(db, session.id, { db, now, daemonFor: factory });
    // Never reverted: the new sign-in has to survive to be capturable.
    expect(reverts).toEqual([]);
  });

  it("cancels the run behind a task session", async () => {
    const session = await openSession({ environmentId: "env_portal", mode: "task", task: "x" }, { db, now });
    if (isSessionError(session)) throw new Error(session.error);
    await closeSession(db, session.id, { db, now });
    expect(getRun(db, session.runId!)?.status).toBe("canceled");
  });

  it("is idempotent", async () => {
    const { factory } = fakeDaemonFactory();
    const session = await openSession({ environmentId: "env_portal", mode: "lease" }, { db, now, daemonFor: factory });
    if (isSessionError(session)) throw new Error(session.error);
    await closeSession(db, session.id, { db, now, daemonFor: factory });
    const again = await closeSession(db, session.id, { db, now, daemonFor: factory });
    expect(isSessionError(again)).toBe(false);
  });
});

describe("sweepExpiredSessions", () => {
  it("reclaims desktops from agents that walked away", async () => {
    const { factory, leases } = fakeDaemonFactory();
    const session = await openSession(
      { environmentId: "env_portal", mode: "lease", ttlMs: 60_000 },
      { db, now, daemonFor: factory },
    );
    if (isSessionError(session)) throw new Error(session.error);

    const later = () => "2026-08-20T10:05:00.000Z";
    expect(await sweepExpiredSessions(db, later, { daemonFor: factory })).toBe(1);
    expect(getSession(db, session.id)?.status).toBe("closed");
    expect(leases.heldDomains(later())).toEqual([]);
  });

  it("leaves live sessions alone", async () => {
    const { factory } = fakeDaemonFactory();
    await openSession({ environmentId: "env_portal", mode: "lease", ttlMs: 60_000 }, { db, now, daemonFor: factory });
    expect(await sweepExpiredSessions(db, () => "2026-08-20T10:00:30.000Z", { daemonFor: factory })).toBe(0);
  });
});

describe("getSessionView", () => {
  it("reads a task session's status off its run", async () => {
    const session = await openSession({ environmentId: "env_portal", mode: "task", task: "x" }, { db, now });
    if (isSessionError(session)) throw new Error(session.error);

    const run = getRun(db, session.runId!)!;
    saveRun(db, { ...run, status: "paused", pausedReason: "needs a code" });

    const view = getSessionView(db, session.id);
    // The agent must be able to tell "a human is blocking me" from "still going".
    expect(view?.status).toBe("waiting_for_human");
    expect(view?.run?.status).toBe("paused");
  });

  it("exposes the desktop for a lease session", async () => {
    const { factory } = fakeDaemonFactory();
    const session = await openSession({ environmentId: "env_portal", mode: "lease" }, { db, now, daemonFor: factory });
    if (isSessionError(session)) throw new Error(session.error);
    expect(getSessionView(db, session.id)?.desktop?.domain).toBe("dom-a");
  });
});
