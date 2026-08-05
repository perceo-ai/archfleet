// Real run orchestrator: walks a workflow's happy path, acquires a VM via the
// daemon, runs each computer_use_task on the guest over SSH, redacts secrets from
// events, and releases the VM. All I/O (VM control, guest exec) is injected so the
// orchestrator is unit tested end-to-end with fakes and no real infrastructure.
//
// The mock `createManualRun` in runtime.ts remains the UI demo path; this module
// is the real execution engine that replaces it once VMs are live.

import { redactSecrets } from "./redaction";
import { runComputerUseTask, type ExecRunner, type GuestReport } from "./computer-use";
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
};

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

  const plan = planExecution(workflow);
  const taskNodes = plan.filter(
    (n) => n.type === "computer_use_task" || n.type === "cli_agent_task",
  );
  const needsVm = taskNodes.some((n) => n.type === "computer_use_task");
  const startedAt = deps.now();

  // Acquire a VM only when a computer-use node needs one. CLI-agent-only
  // workflows run entirely on the controller.
  let acquired: Awaited<ReturnType<typeof deps.daemon.acquire>> | undefined;
  if (needsVm) {
    const requiredLabels =
      taskNodes.find((n) => n.type === "computer_use_task")?.config.requiredLabels ?? [];
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

  try {
    for (const node of taskNodes) {
      if (node.type === "computer_use_task") {
        emit("info", `Running node "${node.name}" on ${vm!.name}.`);
        const baseConn = vm!.ssh ?? { host: vm!.xrdp.host, port: 22, username: vm!.xrdp.username };
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
            env,
          );
        } catch (e) {
          emit("error", `Node "${node.name}" transport error: ${String(e)}`);
          finalStatus = "failed";
          break;
        }
        const level = report.status === "succeeded" ? "info" : "warn";
        emit(level, `Node "${node.name}" ${report.status} (${report.reason}) after ${report.steps} steps.`);
        collectArtifacts(node.id, report.artifacts);
        if (report.status !== "succeeded") {
          finalStatus = reportToStatus(report.status);
          break;
        }
        pastWork += `\n${node.name}: ${report.reason}`;
      } else {
        // cli_agent_task — controller-side CLI agent (claude / codex).
        emit("info", `Running CLI-agent node "${node.name}".`);
        if (!deps.agentExec) {
          emit("error", `Node "${node.name}": no CLI-agent executor configured.`);
          finalStatus = "failed";
          break;
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
          finalStatus = "failed";
          break;
        }
        emit(result.status === "succeeded" ? "info" : "warn", `Node "${node.name}" ${result.status}.`);
        collectArtifacts(node.id, result.artifacts);
        if (result.status !== "succeeded") {
          finalStatus = "failed";
          break;
        }
        pastWork += `\n${node.name}: ${typeof result.structuredOutput === "string" ? result.structuredOutput : "done"}`;
      }
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
