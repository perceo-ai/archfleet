import { describe, expect, it, vi } from "vitest";
import { createVmDaemon } from "./vm-daemon/daemon";
import type { DomainState, VirshClient } from "./vm-daemon/virsh";
import { runWorkflow, planExecution } from "./orchestrator";
import type { ExecResult, ExecRunner } from "./computer-use";
import type { FleetVm, Secret, Workflow, WorkflowParam } from "./types";

function fakeClient(states: Record<string, DomainState>): VirshClient & { reverts: string[][] } {
  const reverts: string[][] = [];
  return {
    reverts,
    isReachable: vi.fn(async () => true),
    listDomains: vi.fn(async () => Object.keys(states)),
    domainState: vi.fn(async (n: string) => states[n] ?? "running"),
    start: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    revertSnapshot: vi.fn(async (n: string, s: string) => {
      reverts.push([n, s]);
    }),
    listSnapshots: vi.fn(async () => ["golden-warm"]),
  };
}

function testVm(): FleetVm {
  return {
    id: "vm1",
    name: "cuf-worker-1",
    status: "idle",
    labels: ["linux-desktop", "browser"],
    cpu: 5,
    memoryGb: 4,
    diskGb: 25,
    xrdp: { host: "127.0.0.1", port: 13389, username: "agent", credentialSource: "secret:vm_pw" },
    ssh: { host: "127.0.0.1", port: 10022, username: "agent" },
    lastHealthAt: "2026-08-04T16:00:00.000Z",
    domain: "dom-vm1",
    warmSnapshot: "golden-warm",
  };
}

function workflow(): Workflow {
  return {
    id: "wf1",
    name: "Portal Login Check",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      {
        id: "task1",
        type: "computer_use_task",
        name: "Log into portal",
        position: { x: 1, y: 0 },
        config: { prompt: "Open portal and log in", requiredLabels: ["browser"], timeoutMs: 60000 },
      },
      { id: "end", type: "end", name: "End", position: { x: 2, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", from: "start", to: "task1", condition: "always" },
      { id: "e2", from: "task1", to: "end", condition: "success" },
    ],
  };
}

const secrets: Secret[] = [
  { id: "s1", name: "portal_password", scope: "workflow", value: "swordfish" },
];
const params: WorkflowParam[] = [{ id: "p1", name: "portal_url", scope: "workflow", value: "https://x" }];

const now = () => {
  let n = 0;
  return () => `2026-08-04T16:10:${String(n++).padStart(2, "0")}.000Z`;
};

function execReturning(report: object): ExecRunner {
  return async () => ({ code: 0, stdout: JSON.stringify(report), stderr: "" }) as ExecResult;
}

function cliWorkflow(): Workflow {
  return {
    id: "wf_cli",
    name: "CLI Only",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      {
        id: "c1",
        type: "cli_agent_task",
        name: "Summarize",
        position: { x: 1, y: 0 },
        config: { prompt: "summarize the repo", provider: "claude-code" },
      },
      { id: "end", type: "end", name: "End", position: { x: 2, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", from: "start", to: "c1", condition: "always" },
      { id: "e2", from: "c1", to: "end", condition: "success" },
    ],
  };
}

describe("cli_agent workflows (no VM)", () => {
  it("runs a CLI-agent node on the controller without acquiring a VM", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const agentExec = vi.fn(async () => ({
      code: 0,
      stdout: '{"type":"result","result":"summary done"}',
      stderr: "",
    }));
    const run = await runWorkflow(
      { workflow: cliWorkflow(), secrets, params, runId: "run_cli" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), agentExec, now: now() },
    );
    expect(run.status).toBe("succeeded");
    expect(run.vmId).toBeUndefined(); // no VM used
    expect(client.reverts).toHaveLength(0); // never touched the fleet
    expect(agentExec).toHaveBeenCalledTimes(1);
  });

  it("fails a CLI-agent node when no executor is configured", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const run = await runWorkflow(
      { workflow: cliWorkflow(), secrets, params, runId: "run_cli" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), now: now() },
    );
    expect(run.status).toBe("failed");
  });
});

describe("planExecution", () => {
  it("walks success/always edges from start", () => {
    const order = planExecution(workflow()).map((n) => n.id);
    expect(order).toEqual(["start", "task1", "end"]);
  });
});

describe("runWorkflow", () => {
  it("runs the task, succeeds, and releases the VM", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      {
        daemon,
        exec: execReturning({ status: "succeeded", reason: "done", steps: 4, artifacts: ["shot.png"] }),
        now: now(),
      },
    );
    expect(run.status).toBe("succeeded");
    expect(run.vmId).toBe("vm1");
    // acquire revert + release revert
    expect(client.reverts).toHaveLength(2);
    expect(run.events.some((e) => e.message.includes("Released"))).toBe(true);
  });

  it("drives the guest over the SSH port, not the XRDP port", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    let seenArgs: string[] = [];
    const capturingExec: ExecRunner = async (_e, args) => {
      seenArgs = args;
      return { code: 0, stdout: '{"status":"succeeded","reason":"d","steps":1,"artifacts":[]}', stderr: "" };
    };
    await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      { daemon, exec: capturingExec, now: now() },
    );
    expect(seenArgs).toContain("10022"); // ssh port
    expect(seenArgs).not.toContain("13389"); // not the RDP port
  });

  it("redacts secrets that leak into a report reason", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      {
        daemon,
        exec: execReturning({ status: "succeeded", reason: "typed swordfish", steps: 1, artifacts: [] }),
        now: now(),
      },
    );
    const joined = run.events.map((e) => e.message).join("\n");
    expect(joined).not.toContain("swordfish");
    expect(joined).toContain("[REDACTED:portal_password]");
  });

  it("pauses and HOLDS the VM when the guest reports needs_human", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      {
        daemon,
        exec: execReturning({ status: "needs_human", reason: "captcha", steps: 12, artifacts: [] }),
        now: now(),
      },
    );
    expect(run.status).toBe("paused");
    // only the acquire revert — VM held for takeover, not released
    expect(client.reverts).toHaveLength(1);
    expect(run.events.some((e) => e.message.includes("human takeover"))).toBe(true);
  });

  it("queues when no VM matches the required labels", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const vm = { ...testVm(), labels: ["linux-desktop"] }; // no 'browser'
    const daemon = createVmDaemon(client, [vm]);
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      { daemon, exec: execReturning({ status: "succeeded", reason: "d", steps: 1, artifacts: [] }), now: now() },
    );
    expect(run.status).toBe("queued");
    expect(run.events.some((e) => e.message.includes("no_matching_vm"))).toBe(true);
  });

  it("fails the run when the guest transport errors", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const failingExec: ExecRunner = async () => ({ code: 255, stdout: "", stderr: "connection refused" });
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      { daemon, exec: failingExec, now: now() },
    );
    expect(run.status).toBe("failed");
    // failed -> VM released
    expect(client.reverts).toHaveLength(2);
  });
});
