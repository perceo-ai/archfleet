// Real run orchestrator: walks a workflow's happy path, acquires a VM via the
// daemon, runs each computer_use_task on the guest over SSH, redacts secrets from
// events, and releases the VM. All I/O (VM control, guest exec) is injected so the
// orchestrator is unit tested end-to-end with fakes and no real infrastructure.
//
// The mock `createManualRun` in runtime.ts remains the UI demo path; this module
// is the real execution engine that replaces it once VMs are live.

import { redactSecrets } from "./redaction";
import { runComputerUseTask, type ExecRunner, type GuestReport, type GuestConnection } from "./computer-use";
import { runCliAgent, type AgentExec, type AgentRunResult } from "./cli-agent-runner";
import type { AgentProvider } from "./types";
import type { VmDaemon } from "./vm-daemon/daemon";
import type {
  RunArtifact,
  RunEvent,
  RunStatus,
  Secret,
  Workflow,
  WorkflowNode,
  WorkflowParam,
  WorkflowRun,
} from "./types";

export type OrchestratorDeps = {
  daemon: VmDaemon;
  exec: ExecRunner;
  /** Monotonic-ish timestamp source (ISO strings). Injected for deterministic tests. */
  now: () => string;
  /** Extra env passed to the guest runner (e.g. planner base URL). */
  env?: Record<string, string>;
  /** SSH private key for the guest transport (key-based auth). */
  sshIdentityFile?: string;
  /** Executor for CLI-agent nodes (claude/codex). Controller-side, no VM. */
  agentExec?: AgentExec;
  /** Fetch guest artifact files back to the controller. Returns local RunArtifacts. */
  fetchArtifacts?: (
    conn: GuestConnection,
    remotePaths: string[],
    runId: string,
    nodeId: string,
  ) => Promise<RunArtifact[]>;
  /** Run a shell_task command (controller-side). Absent = shell disabled. */
  shellExec?: (
    command: string,
    opts?: { env?: Record<string, string> },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
};

/** A node's branch outcome, used to pick the next edge. */
type Outcome = "success" | "failure" | "paused";

export type RunWorkflowInput = {
  workflow: Workflow;
  secrets: Secret[];
  params: WorkflowParam[];
  runId: string;
};

/** Walk the happy path (success/always edges) from the start node. */
export function planExecution(workflow: Workflow): WorkflowNode[] {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const start = workflow.nodes.find((n) => n.type === "start");
  if (!start) return [];

  const order: WorkflowNode[] = [];
  const seen = new Set<string>();
  let current: WorkflowNode | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    order.push(current);
    const edge = workflow.edges.find(
      (e) => e.from === current!.id && (e.condition === "success" || e.condition === "always"),
    );
    current = edge ? byId.get(edge.to) : undefined;
  }
  return order;
}

function reportToStatus(status: GuestReport["status"]): RunStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "needs_human":
      return "paused";
    case "failed":
    case "timed_out":
    default:
      return "failed";
  }
}

/** Map secret names to UPPER_SNAKE env for per-process injection on the guest. */
function secretEnv(secrets: Secret[]): Record<string, string> {
  return Object.fromEntries(
    secrets.map((s) => [
      s.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase(),
      s.value,
    ]),
  );
}

export async function runWorkflow(
  input: RunWorkflowInput,
  deps: OrchestratorDeps,
): Promise<WorkflowRun> {
  const { workflow, secrets, params, runId } = input;
  const events: RunEvent[] = [];
  let seq = 0;
  const emit = (level: RunEvent["level"], message: string) => {
    events.push({
      id: `evt_${runId}_${seq++}`,
      level,
      timestamp: deps.now(),
      message: redactSecrets(message, secrets),
    });
  };

  const needsVm = workflow.nodes.some((n) => n.type === "computer_use_task");
  const startedAt = deps.now();

  // Acquire a VM only when a computer-use node needs one. CLI-agent-only
  // workflows run entirely on the controller.
  let acquired: Awaited<ReturnType<typeof deps.daemon.acquire>> | undefined;
  if (needsVm) {
    const requiredLabels =
      workflow.nodes.find((n) => n.type === "computer_use_task")?.config.requiredLabels ?? [];
    acquired = await deps.daemon.acquire({ requiredLabels, runId });
    if (!acquired.ok) {
      emit("warn", `Queued ${workflow.name}: ${acquired.reason}.`);
      return {
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: acquired.reason === "no_matching_vm" ? "queued" : "failed",
        startedAt,
        events,
      };
    }
    emit(
      "info",
      `Assigned ${workflow.name} to ${acquired.vm.name} (XRDP ${acquired.xrdp.host}:${acquired.xrdp.port}).`,
    );
  }
  const vm = acquired?.ok ? acquired.vm : undefined;

  const env = { ...secretEnv(secrets), ...(deps.env ?? {}) };
  const secretMap = Object.fromEntries(secrets.map((s) => [s.name, s.value]));
  const paramMap = Object.fromEntries(params.map((p) => [p.name, p.value]));
  const artifacts: RunArtifact[] = [];
  let pastWork = "";
  let finalStatus: RunStatus = "succeeded";

  const collectArtifacts = (nodeId: string, paths: string[]) => {
    for (const path of paths) {
      emit("info", `Artifact: ${path}.`);
      artifacts.push({ id: `art_${runId}_${artifacts.length}`, runId, nodeId, type: "file", path, createdAt: deps.now() });
    }
  };

  // Execute one node, returning a branch outcome. Emits events + collects
  // artifacts as side effects.
  const runNode = async (node: WorkflowNode): Promise<Outcome> => {
    switch (node.type) {
      case "start":
      case "end":
      case "artifact":
        return "success";
      case "retry_wait":
        emit("info", `Node "${node.name}": retry/wait.`);
        return "success";
      case "human_takeover":
        emit("warn", `Node "${node.name}": paused for human takeover.`);
        return "paused";
      case "condition": {
        // MVP: succeed if prior output contains config.prompt (else success when unset).
        const needle = node.config.prompt;
        const ok = !needle || pastWork.includes(needle);
        emit("info", `Condition "${node.name}" -> ${ok ? "success" : "failure"}.`);
        return ok ? "success" : "failure";
      }
      case "shell_task": {
        if (!deps.shellExec) {
          emit("error", `Node "${node.name}": shell execution not enabled.`);
          return "failure";
        }
        const res = await deps.shellExec(node.config.prompt ?? "", { env });
        emit(res.code === 0 ? "info" : "warn", `Shell "${node.name}" exited ${res.code}.`);
        pastWork += `\n${node.name}: exit ${res.code}`;
        return res.code === 0 ? "success" : "failure";
      }
      case "computer_use_task": {
        if (!vm) {
          emit("error", `Node "${node.name}": no VM available.`);
          return "failure";
        }
        emit("info", `Running node "${node.name}" on ${vm.name}.`);
        const baseConn = vm.ssh ?? { host: vm.xrdp.host, port: 22, username: vm.xrdp.username };
        const guestConn = { ...baseConn, identityFile: deps.sshIdentityFile };
        let report: GuestReport;
        try {
          report = await runComputerUseTask(
            guestConn,
            {
              instruction: node.config.prompt ?? node.name,
              pastWork,
              params: paramMap,
              limits: node.config.timeoutMs ? { timeoutS: node.config.timeoutMs / 1000 } : undefined,
            },
            deps.exec,
            { ...env, CUF_RUN_ID: runId },
          );
        } catch (e) {
          emit("error", `Node "${node.name}" transport error: ${String(e)}`);
          return "failure";
        }
        emit(report.status === "succeeded" ? "info" : "warn", `Node "${node.name}" ${report.status} (${report.reason}) after ${report.steps} steps.`);
        if (report.artifacts.length && deps.fetchArtifacts) {
          try {
            const fetched = await deps.fetchArtifacts(guestConn, report.artifacts, runId, node.id);
            artifacts.push(...fetched);
            for (const f of fetched) emit("info", `Artifact: ${f.path}.`);
          } catch (e) {
            emit("warn", `Artifact fetch failed for "${node.name}": ${String(e)}`);
            collectArtifacts(node.id, report.artifacts);
          }
        } else {
          collectArtifacts(node.id, report.artifacts);
        }
        if (report.status === "succeeded") {
          pastWork += `\n${node.name}: ${report.reason}`;
          return "success";
        }
        return reportToStatus(report.status) === "paused" ? "paused" : "failure";
      }
      case "cli_agent_task": {
        emit("info", `Running CLI-agent node "${node.name}".`);
        if (!deps.agentExec) {
          emit("error", `Node "${node.name}": no CLI-agent executor configured.`);
          return "failure";
        }
        let result: AgentRunResult;
        try {
          result = await runCliAgent(
            {
              provider: (node.config.provider as AgentProvider) ?? "claude-code",
              prompt: pastWork ? `${node.config.prompt ?? node.name}\n\nContext:\n${pastWork}` : node.config.prompt ?? node.name,
              secrets: secretMap,
              allowApiFallback: false,
            },
            deps.agentExec,
            secrets,
          );
        } catch (e) {
          emit("error", `Node "${node.name}" agent error: ${String(e)}`);
          return "failure";
        }
        emit(result.status === "succeeded" ? "info" : "warn", `Node "${node.name}" ${result.status}.`);
        collectArtifacts(node.id, result.artifacts);
        if (result.status !== "succeeded") return "failure";
        pastWork += `\n${node.name}: ${typeof result.structuredOutput === "string" ? result.structuredOutput : "done"}`;
        return "success";
      }
      default:
        return "success";
    }
  };

  // Outcome-driven traversal: follow the edge matching each node's outcome
  // (success / failure), or an 'always' edge. Supports failure branches, pause,
  // and recovery paths — not just a linear happy path.
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  let current: WorkflowNode | undefined =
    workflow.nodes.find((n) => n.type === "start") ?? workflow.nodes[0];
  const maxSteps = workflow.nodes.length * 4 + 10;
  let steps = 0;
  try {
    while (current && steps++ < maxSteps) {
      const node = current;
      const outcome = await runNode(node);
      if (outcome === "paused") {
        finalStatus = "paused";
        break;
      }
      if (node.type === "end") {
        finalStatus = "succeeded";
        break;
      }
      const outEdges = workflow.edges.filter((e) => e.from === node.id);
      const edge =
        outEdges.find((e) => e.condition === outcome) ??
        outEdges.find((e) => e.condition === "always");
      if (!edge) {
        // Dead end: an unhandled failure fails the run; success just stops.
        if (outcome === "failure") finalStatus = "failed";
        break;
      }
      current = byId.get(edge.to);
    }
    if (steps >= maxSteps) {
      emit("error", "Workflow exceeded max steps (possible cycle).");
      finalStatus = "failed";
    }
  } finally {
    if (vm) {
      if (finalStatus !== "paused") {
        await deps.daemon.release(vm);
        emit("info", `Released ${vm.name}.`);
      } else {
        emit("warn", `${vm.name} held for human takeover over XRDP ${vm.xrdp.host}:${vm.xrdp.port}.`);
      }
    }
  }

  return {
    id: runId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: finalStatus,
    vmId: vm?.id,
    startedAt,
    finishedAt: deps.now(),
    events,
    artifacts,
  };
}
