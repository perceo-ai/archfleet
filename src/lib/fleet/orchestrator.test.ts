import { describe, expect, it, vi } from "vitest";
import { createVmDaemon } from "./vm-daemon/daemon";
import { createMemoryLeaseStore } from "./vm-daemon/lease-store";
import type { DomainState, VirshClient } from "./vm-daemon/virsh";
import { runWorkflow, planExecution } from "./orchestrator";
import type { ExecResult, ExecRunner } from "./computer-use";
import type { AgentCommand } from "./agent-adapters";
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

function testDaemon(client: VirshClient) {
  return createVmDaemon(client, [testVm()], { waitForTcp: vi.fn(async () => {}) });
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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

  it("condition can ask a CLI model to choose the success branch", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const agentExec = vi.fn(async (_cmd: AgentCommand) => {
      void _cmd;
      return {
        code: 0,
        stdout: '{"type":"result","result":{"outcome":"success","reason":"portal is ready"}}',
        stderr: "",
      };
    });
    const wf: Workflow = {
      id: "wf_decide",
      name: "Decide",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "probe", type: "cli_agent_task", name: "Probe", position: { x: 1, y: 0 }, config: { prompt: "inspect state" } },
        {
          id: "decide",
          type: "condition",
          name: "Ready?",
          position: { x: 2, y: 0 },
          config: { prompt: "Is the portal ready to submit?", provider: "claude-code" },
        },
        { id: "ok", type: "end", name: "OK", position: { x: 3, y: 0 }, config: {} },
        { id: "fail", type: "human_takeover", name: "Human", position: { x: 3, y: 1 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "probe", condition: "always" },
        { id: "e2", from: "probe", to: "decide", condition: "success" },
        { id: "e3", from: "decide", to: "ok", condition: "success" },
        { id: "e4", from: "decide", to: "fail", condition: "failure" },
      ],
    };

    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), agentExec, now: now() },
    );

    expect(run.status).toBe("succeeded");
    expect(agentExec).toHaveBeenCalledTimes(2);
    const decisionCommand = agentExec.mock.calls.at(1)?.[0];
    expect(decisionCommand?.stdin ?? "").toContain("Is the portal ready to submit?");
    expect(decisionCommand?.stdin ?? "").toContain("Probe: done");
  });

  it("condition treats explicit failure as failure even when the reason says not ready", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const agentExec = vi.fn(async (_cmd: AgentCommand) => {
      void _cmd;
      return {
        code: 0,
        stdout: '{"type":"result","result":{"outcome":"failure","reason":"portal is not ready"}}',
        stderr: "",
      };
    });
    const wf: Workflow = {
      id: "wf_decide_fail",
      name: "Decide Fail",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        {
          id: "decide",
          type: "condition",
          name: "Ready?",
          position: { x: 1, y: 0 },
          config: { prompt: "Is the portal ready to submit?", provider: "claude-code" },
        },
        { id: "ok", type: "end", name: "OK", position: { x: 2, y: 0 }, config: {} },
        { id: "fail", type: "human_takeover", name: "Human", position: { x: 2, y: 1 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "decide", condition: "always" },
        { id: "e2", from: "decide", to: "ok", condition: "success" },
        { id: "e3", from: "decide", to: "fail", condition: "failure" },
      ],
    };

    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), agentExec, now: now() },
    );

    expect(run.status).toBe("paused");
    expect(run.events.some((e) => e.message.includes("model decision -> failure"))).toBe(true);
  });

  it("condition treats a failed agent execution as failure even with structured success output", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const agentExec = vi.fn(async (_cmd: AgentCommand) => {
      void _cmd;
      return {
        code: 1,
        stdout: '{"type":"result","result":{"outcome":"success","reason":"looks ready"}}',
        stderr: "agent failed",
      };
    });
    const wf: Workflow = {
      id: "wf_decide_exec_fail",
      name: "Decide Exec Fail",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        {
          id: "decide",
          type: "condition",
          name: "Ready?",
          position: { x: 1, y: 0 },
          config: { prompt: "Is the portal ready to submit?", provider: "claude-code" },
        },
        { id: "ok", type: "end", name: "OK", position: { x: 2, y: 0 }, config: {} },
        { id: "fail", type: "human_takeover", name: "Human", position: { x: 2, y: 1 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "decide", condition: "always" },
        { id: "e2", from: "decide", to: "ok", condition: "success" },
        { id: "e3", from: "decide", to: "fail", condition: "failure" },
      ],
    };

    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), agentExec, now: now() },
    );

    expect(run.status).toBe("paused");
    expect(run.events.some((e) => e.message.includes("agent execution failed"))).toBe(true);
  });

  it("condition fails closed when the agent emits no parseable decision", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const agentExec = vi.fn(async (_cmd: AgentCommand) => {
      void _cmd;
      return {
        code: 0,
        stdout: '{"type":"result","result":{"reason":"looked at the page"}}',
        stderr: "",
      };
    });
    const wf: Workflow = {
      id: "wf_decide_missing",
      name: "Decide Missing",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        {
          id: "decide",
          type: "condition",
          name: "Ready?",
          position: { x: 1, y: 0 },
          config: { prompt: "Is the portal ready to submit?", provider: "claude-code" },
        },
        { id: "ok", type: "end", name: "OK", position: { x: 2, y: 0 }, config: {} },
        { id: "fail", type: "human_takeover", name: "Human", position: { x: 2, y: 1 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "decide", condition: "always" },
        { id: "e2", from: "decide", to: "ok", condition: "success" },
        { id: "e3", from: "decide", to: "fail", condition: "failure" },
      ],
    };

    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "r" },
      { daemon, exec: async () => ({ code: 0, stdout: "", stderr: "" }), agentExec, now: now() },
    );

    expect(run.status).toBe("paused");
    expect(run.events.some((e) => e.message.includes("model decision -> failure"))).toBe(true);
  });

  it("retry_wait re-runs the preceding task until it succeeds", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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

  it("starts from startNodeId (checkpoint retry) instead of the start node", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    let execCalls = 0;
    const exec: ExecRunner = async () => {
      execCalls++;
      return { code: 0, stdout: JSON.stringify({ status: "succeeded", reason: "done", steps: 1, artifacts: [] }), stderr: "" } as ExecResult;
    };
    const wf = workflow();
    wf.nodes.splice(2, 0, {
      id: "task2",
      type: "computer_use_task",
      name: "Download report",
      position: { x: 1.5, y: 0 },
      config: { prompt: "Download the report", requiredLabels: ["browser"] },
    });
    wf.edges = [
      { id: "e1", from: "start", to: "task1", condition: "always" },
      { id: "e2", from: "task1", to: "task2", condition: "success" },
      { id: "e3", from: "task2", to: "end", condition: "success" },
    ];
    const run = await runWorkflow(
      { workflow: wf, secrets, params, runId: "run_ckpt", startNodeId: "task2" },
      { daemon, exec, now: now() },
    );
    expect(run.status).toBe("succeeded");
    expect(execCalls).toBe(1); // task1 skipped — only the resumed step ran
    expect(run.events.some((e) => e.message.includes('Resuming from "Download report"'))).toBe(true);
  });

  it("drives the guest over the SSH port, not the XRDP port", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    const daemon = testDaemon(client);
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
    // Says what was missing, not just that the lookup failed.
    expect(run.events.some((e) => e.message.includes("no desktop available"))).toBe(true);
    expect(run.events.some((e) => e.message.includes("browser"))).toBe(true);
  });

  it("fails the run when the guest transport errors", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
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

describe("run progress + pause metadata", () => {
  function takeoverWorkflow(): Workflow {
    return {
      id: "wf_tk",
      name: "Needs Human",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "h1",
          type: "human_takeover",
          name: "Manual MFA",
          position: { x: 1, y: 0 },
          config: { prompt: "Complete the MFA challenge, then resume" },
        },
        { id: "end", type: "end", name: "End", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "h1", condition: "always" },
        { id: "e2", from: "h1", to: "end", condition: "success" },
      ],
    };
  }

  it("reports each node via onProgress and records the current step", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const seen: string[] = [];
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      {
        daemon,
        exec: execReturning({ status: "succeeded", reason: "done", steps: 1, artifacts: [] }),
        now: now(),
        onProgress: (_id, name) => seen.push(name),
      },
    );
    expect(seen).toEqual(["Start", "Log into portal", "End"]);
    expect(run.currentStep).toBe("End");
    expect(run.status).toBe("succeeded");
  });

  it("paused run carries pausedReason and the pausing step", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const run = await runWorkflow(
      { workflow: takeoverWorkflow(), secrets, params, runId: "run_1" },
      { daemon, exec: execReturning({ status: "succeeded", reason: "d", steps: 1, artifacts: [] }), now: now() },
    );
    expect(run.status).toBe("paused");
    expect(run.currentStep).toBe("Manual MFA");
    expect(run.pausedReason).toBe("Complete the MFA challenge, then resume");
  });

  it("guest needs_human pause uses the guest report reason", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = testDaemon(client);
    const run = await runWorkflow(
      { workflow: workflow(), secrets, params, runId: "run_1" },
      {
        daemon,
        exec: execReturning({ status: "needs_human", reason: "login page shows a captcha", steps: 3, artifacts: [] }),
        now: now(),
      },
    );
    expect(run.status).toBe("paused");
    expect(run.pausedReason).toBe("login page shows a captcha");
  });
});

// `automation.environmentId` used to be stored, threaded into the run, and then
// ignored at acquire time — so an automation bound to a signed-in desktop could
// land on any free one. These lock that link shut.
describe("environment binding", () => {
  function labelledFleet(client: VirshClient, labels: string[]) {
    return createVmDaemon(client, [{ ...testVm(), labels }], { waitForTcp: vi.fn(async () => {}) });
  }

  function oneVmTask(): Workflow {
    return {
      id: "wf_env",
      name: "Env Bound",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "cu",
          type: "computer_use_task",
          name: "Do it",
          position: { x: 1, y: 0 },
          config: { requiredLabels: ["browser"] },
        },
        { id: "end", type: "end", name: "End", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "cu", condition: "always" },
        { id: "e2", from: "cu", to: "end", condition: "success" },
      ],
    };
  }

  const okExec: ExecRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({ status: "succeeded", reason: "ok", steps: 1, artifacts: [] }),
    stderr: "",
  });

  it("runs on a desktop carrying the environment's profile label", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = labelledFleet(client, ["linux-desktop", "browser", "profile:portal"]);
    const run = await runWorkflow(
      {
        workflow: oneVmTask(),
        secrets: [],
        params: [],
        runId: "r",
        requiredLabels: ["profile:portal"],
        environmentName: "Portal — logged in",
      },
      { daemon, exec: okExec, now: () => "2026-08-20T10:00:00.000Z" },
    );
    expect(run.status).toBe("succeeded");
  });

  it("will not borrow a desktop that lacks the environment's profile", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    // A perfectly good desktop — just not the signed-in one.
    const daemon = labelledFleet(client, ["linux-desktop", "browser"]);
    const run = await runWorkflow(
      {
        workflow: oneVmTask(),
        secrets: [],
        params: [],
        runId: "r",
        requiredLabels: ["profile:portal"],
        environmentName: "Portal — logged in",
      },
      { daemon, exec: okExec, now: () => "2026-08-20T10:00:00.000Z" },
    );
    expect(run.status).toBe("queued");
    // Nothing was reverted: we never touched an unrelated desktop.
    expect(client.reverts).toEqual([]);
    // And the reason names the environment rather than saying "no_matching_vm".
    expect(run.events.at(-1)?.message).toContain("Portal — logged in");
    expect(run.events.at(-1)?.message).toContain("profile:portal");
  });

  it("unions environment labels with the node's own rather than replacing them", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    // Has the profile but not the capability the node demands.
    const daemon = labelledFleet(client, ["linux-desktop", "profile:portal"]);
    const run = await runWorkflow(
      { workflow: oneVmTask(), secrets: [], params: [], runId: "r", requiredLabels: ["profile:portal"] },
      { daemon, exec: okExec, now: () => "2026-08-20T10:00:00.000Z" },
    );
    expect(run.status).toBe("queued");
    expect(run.events.at(-1)?.message).toContain("browser");
  });

  it("an environment with no profile constrains nothing", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const daemon = labelledFleet(client, ["linux-desktop", "browser"]);
    const run = await runWorkflow(
      { workflow: oneVmTask(), secrets: [], params: [], runId: "r", requiredLabels: [] },
      { daemon, exec: okExec, now: () => "2026-08-20T10:00:00.000Z" },
    );
    expect(run.status).toBe("succeeded");
  });
});

// A run holds its desktop for as long as it is working, and a paused run holds it
// until a human arrives. Leases expire, so the holder has to keep saying it is
// alive — otherwise another worker reverts the desktop mid-run.
describe("lease renewal during a run", () => {
  function graph(nodes: Workflow["nodes"], edges: Workflow["edges"]): Workflow {
    return { id: "wf_renew", name: "Renewing", description: "", enabled: true, triggerKinds: ["manual"], nodes, edges };
  }

  const threeStep = () =>
    graph(
      [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "cu", type: "computer_use_task", name: "Do it", position: { x: 1, y: 0 }, config: {} },
        { id: "end", type: "end", name: "End", position: { x: 2, y: 0 }, config: {} },
      ],
      [
        { id: "e1", from: "start", to: "cu", condition: "always" },
        { id: "e2", from: "cu", to: "end", condition: "success" },
      ],
    );

  const okExec: ExecRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({ status: "succeeded", reason: "ok", steps: 1, artifacts: [] }),
    stderr: "",
  });

  it("renews the lease at every node, not just on acquire", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const base = createVmDaemon(client, [testVm()], { waitForTcp: vi.fn(async () => {}) });
    const renew = vi.fn((...args: Parameters<typeof base.renew>) => base.renew(...args));
    const daemon = { ...base, renew };

    const run = await runWorkflow(
      { workflow: threeStep(), secrets: [], params: [], runId: "run_1" },
      { daemon, exec: okExec, now: () => "2026-08-20T10:00:00.000Z" },
    );

    expect(run.status).toBe("succeeded");
    // start, computer_use_task, end — one renewal each.
    expect(renew).toHaveBeenCalledTimes(3);
    expect(renew.mock.calls.every(([, holder]) => holder === "run_1")).toBe(true);
  });

  it("keeps a desktop held past the original TTL while a run waits for a human", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const leases = createMemoryLeaseStore();
    let clock = "2026-08-20T10:00:00.000Z";
    const daemon = createVmDaemon(client, [testVm()], {
      leases,
      leaseTtlMs: 60_000,
      now: () => clock,
      waitForTcp: vi.fn(async () => {}),
    });
    const wf = graph(
      [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "cu", type: "computer_use_task", name: "Try", position: { x: 1, y: 0 }, config: {} },
        { id: "ht", type: "human_takeover", name: "Takeover", position: { x: 2, y: 0 }, config: {} },
        { id: "end", type: "end", name: "E", position: { x: 3, y: 0 }, config: {} },
      ],
      [
        { id: "e1", from: "start", to: "cu", condition: "always" },
        { id: "e2", from: "cu", to: "ht", condition: "always" },
        { id: "e3", from: "ht", to: "end", condition: "success" },
      ],
    );

    // The takeover node is reached 45s in — inside the original 60s lease.
    const run = await runWorkflow(
      { workflow: wf, secrets: [], params: [], runId: "run_1" },
      {
        daemon,
        exec: okExec,
        now: () => {
          clock = "2026-08-20T10:00:45.000Z";
          return clock;
        },
      },
    );

    expect(run.status).toBe("paused");
    // Had the lease not been renewed at the takeover node it would have lapsed at
    // 10:01:00, and another worker could revert the desktop the human is about to
    // land on.
    expect(leases.get("dom-vm1", "2026-08-20T10:01:30.000Z")?.holder).toBe("run_1");
  });

  it("stops rather than driving a desktop it no longer owns", async () => {
    const client = fakeClient({ "dom-vm1": "running" });
    const base = createVmDaemon(client, [testVm()], { waitForTcp: vi.fn(async () => {}) });
    // Acquire succeeds, then the hold is lost to another worker.
    const daemon = { ...base, renew: () => false };

    const exec = vi.fn(okExec);
    const run = await runWorkflow(
      { workflow: threeStep(), secrets: [], params: [], runId: "run_1" },
      { daemon, exec, now: () => "2026-08-20T10:00:00.000Z" },
    );

    expect(run.status).toBe("failed");
    expect(run.events.some((e) => e.message.includes("Lost the desktop"))).toBe(true);
    // Never touched the guest.
    expect(exec).not.toHaveBeenCalled();
  });
});
