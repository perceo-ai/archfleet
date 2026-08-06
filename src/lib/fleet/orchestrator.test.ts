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

describe("outcome-driven engine", () => {
  it("follows a failure edge to a recovery node (run recovers to succeeded)", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const wf: Workflow = {
      id: "wf_recover",
      name: "Recover",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "cu", type: "computer_use_task", name: "Try", position: { x: 1, y: 0 }, config: { requiredLabels: [] } },
        { id: "rec", type: "cli_agent_task", name: "Recover", position: { x: 2, y: 0 }, config: { prompt: "fix" } },
        { id: "end", type: "end", name: "E", position: { x: 3, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "cu", condition: "always" },
        { id: "e2", from: "cu", to: "rec", condition: "failure" },
        { id: "e3", from: "cu", to: "end", condition: "success" },
        { id: "e4", from: "rec", to: "end", condition: "success" },
      ],
    };
    const agentExec = vi.fn(async () => ({ code: 0, stdout: '{"result":"fixed"}', stderr: "" }));
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      {
        daemon,
        exec: execReturning({ status: "failed", reason: "boom", steps: 1, artifacts: [] }),
        agentExec,
        now: now(),
      },
    );
    expect(run.status).toBe("succeeded"); // failure handled by recovery branch
    expect(agentExec).toHaveBeenCalledTimes(1);
    expect(client.reverts).toHaveLength(2); // acquire + release
  });

  it("pauses at a human_takeover node and holds the VM", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const wf: Workflow = {
      id: "wf_ht",
      name: "HT",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "cu", type: "computer_use_task", name: "Try", position: { x: 1, y: 0 }, config: { requiredLabels: [] } },
        { id: "ht", type: "human_takeover", name: "Takeover", position: { x: 2, y: 0 }, config: {} },
        { id: "end", type: "end", name: "E", position: { x: 3, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "cu", condition: "always" },
        { id: "e2", from: "cu", to: "ht", condition: "always" },
        { id: "e3", from: "ht", to: "end", condition: "success" },
      ],
    };
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: execReturning({ status: "succeeded", reason: "ok", steps: 1, artifacts: [] }), now: now() },
    );
    expect(run.status).toBe("paused");
    expect(client.reverts).toHaveLength(1); // held, not released
  });

  it("script_task drives the guest via the desktop_runner (no LLM)", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    let remoteCmd = "";
    const capturingExec: ExecRunner = async (_e, args) => {
      remoteCmd = args[args.length - 1];
      return { code: 0, stdout: '{"status":"succeeded","reason":"script_done","steps":2,"artifacts":[]}', stderr: "" };
    };
    const wf: Workflow = {
      id: "wf_s", name: "Script", description: "", enabled: true, triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "sc", type: "script_task", name: "Click", position: { x: 1, y: 0 }, config: { prompt: '[{"click":[10,20]}]', requiredLabels: [] } },
        { id: "end", type: "end", name: "E", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "sc", condition: "always" }, { id: "e2", from: "sc", to: "end", condition: "success" }],
    };
    const run = await runWorkflow({ workflow: wf, secrets, params, runId: "r" }, { daemon, exec: capturingExec, now: now() });
    expect(run.status).toBe("succeeded");
    expect(remoteCmd).toContain("desktop_runner.py"); // used the scripted runner, not cli.py
  });

  it("otp_email fetches a code into a param that a later node types", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const emailOtp = vi.fn(async () => "654321");
    let instruction = "";
    const capturingExec: ExecRunner = async (_e, _a, stdin) => {
      instruction = JSON.parse(stdin).instruction;
      return { code: 0, stdout: '{"status":"succeeded","reason":"done","steps":1,"artifacts":[]}', stderr: "" };
    };
    const wf: Workflow = {
      id: "wf_otp", name: "OTP", description: "", enabled: true, triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "otp", type: "otp_email", name: "Get code", position: { x: 1, y: 0 }, config: { prompt: '{"host":"imap.x","user":"u","pass":"p"}' } },
        { id: "cu", type: "computer_use_task", name: "Enter code", position: { x: 2, y: 0 }, config: { prompt: "type {{param.otp}}", requiredLabels: [] } },
        { id: "end", type: "end", name: "E", position: { x: 3, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "otp", condition: "always" },
        { id: "e2", from: "otp", to: "cu", condition: "success" },
        { id: "e3", from: "cu", to: "end", condition: "success" },
      ],
    };
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: capturingExec, emailOtp, now: now() },
    );
    expect(run.status).toBe("succeeded");
    expect(emailOtp).toHaveBeenCalledOnce();
    expect(instruction).toContain("654321"); // OTP flowed into the next node
  });

  it("api_call node succeeds on 2xx, fails otherwise (no VM)", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const httpFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const wf: Workflow = {
      id: "wf_api", name: "API", description: "", enabled: true, triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "a", type: "api_call", name: "Ping", position: { x: 1, y: 0 }, config: { prompt: '{"url":"https://x/health","method":"GET"}' } },
        { id: "end", type: "end", name: "E", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "a", condition: "always" }, { id: "e2", from: "a", to: "end", condition: "success" }],
    };
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), httpFetch: httpFetch as unknown as typeof fetch, now: now() },
    );
    expect(run.status).toBe("succeeded");
    expect(run.vmId).toBeUndefined(); // api_call needs no VM
    expect(httpFetch).toHaveBeenCalledOnce();
  });

  it("retry_wait re-runs the preceding task until it succeeds", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    // shell fails first call, succeeds second — retry_wait (maxAttempts 3) recovers.
    let calls = 0;
    const shellExec = vi.fn(async () => ({ code: calls++ === 0 ? 1 : 0, stdout: "", stderr: "" }));
    const wf: Workflow = {
      id: "wf_retry",
      name: "Retry",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "sh", type: "shell_task", name: "Flaky", position: { x: 1, y: 0 }, config: { prompt: "flaky" } },
        { id: "rw", type: "retry_wait", name: "Retry", position: { x: 2, y: 0 }, config: { maxAttempts: 3 } },
        { id: "end", type: "end", name: "E", position: { x: 3, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "sh", condition: "always" },
        { id: "e2", from: "sh", to: "end", condition: "success" },
        { id: "e3", from: "sh", to: "rw", condition: "failure" },
        { id: "e4", from: "rw", to: "end", condition: "success" },
      ],
    };
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), shellExec, now: now() },
    );
    expect(run.status).toBe("succeeded"); // failed once, retried, succeeded
    expect(shellExec).toHaveBeenCalledTimes(2);
  });

  it("runs a shell_task node and branches on exit code", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const wf: Workflow = {
      id: "wf_sh",
      name: "Sh",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "sh", type: "shell_task", name: "Echo", position: { x: 1, y: 0 }, config: { prompt: "echo hi" } },
        { id: "end", type: "end", name: "E", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "sh", condition: "always" },
        { id: "e2", from: "sh", to: "end", condition: "success" },
      ],
    };
    const shellExec = vi.fn(async () => ({ code: 0, stdout: "hi", stderr: "" }));
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), shellExec, now: now() },
    );
    expect(run.status).toBe("succeeded");
    expect(run.vmId).toBeUndefined(); // shell-only, no VM
    expect(shellExec).toHaveBeenCalledOnce();
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

  it("templates {{secret.x}} into the guest instruction but redacts it from logs", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const wf = workflow();
    wf.nodes[1].config.prompt = "log in and type {{secret.portal_password}}";
    let seenStdin = "";
    const capturingExec: ExecRunner = async (_e, _a, stdin) => {
      seenStdin = stdin;
      return { code: 0, stdout: '{"status":"succeeded","reason":"done","steps":1,"artifacts":[]}', stderr: "" };
    };
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "run_1" },
      { daemon, exec: capturingExec, now: now() },
    );
    expect(run.status).toBe("succeeded");
    // resolved secret reaches the guest task (agent must type it)...
    expect(JSON.parse(seenStdin).instruction).toContain("swordfish");
    // ...but never appears in persisted events
    expect(run.events.map((e) => e.message).join("\n")).not.toContain("swordfish");
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

  it("fetches guest artifacts back to the controller when a fetcher is provided", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = createVmDaemon(client, [testVm()]);
    const fetchArtifacts = vi.fn(async (_c, paths: string[], runId: string, nodeId: string) =>
      paths.map((p, i) => ({
        id: `art_${i}`,
        runId,
        nodeId,
        type: "file",
        path: `/local/${runId}/${p.split("/").pop()}`,
        createdAt: "t",
      })),
    );
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      {
        daemon,
        exec: execReturning({ status: "succeeded", reason: "done", steps: 1, artifacts: ["/opt/agent/a/shot.png"] }),
        now: now(),
        fetchArtifacts,
      },
    );
    expect(run.status).toBe("succeeded");
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(run.artifacts?.[0].path).toBe("/local/run_1/shot.png"); // local, not guest path
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
