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
import { resolveTemplate } from "./templating";
import { evalExpr, evalRule, type ExprContext, type ExprValue } from "./expr";
import {
  evaluateSuccessExpr,
  missingRequiredFields,
  resolveFields,
  type CustomNodeType,
} from "./node-types";
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
  /** Sync the checked-in guest runner to the VM after snapshot revert. */
  syncGuestRunner?: (conn: GuestConnection) => Promise<string | undefined>;
  /** Run a shell_task command (controller-side). Absent = shell disabled. */
  shellExec?: (
    command: string,
    opts?: { env?: Record<string, string> },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** HTTP client for api_call nodes. Absent = fetch disabled. */
  httpFetch?: typeof fetch;
  /** Fetch an email OTP for otp_email nodes. Absent = email OTP disabled. */
  emailOtp?: (config: import("./otp-email").EmailOtpConfig) => Promise<string | null>;
  /** Called before each node executes — lets the caller persist live progress. */
  onProgress?: (nodeId: string, nodeName: string) => void;
  /** Called as each event is emitted — lets the caller stream events to the run view. */
  onEvent?: (event: RunEvent, seq: number) => void;
  /** Called as each artifact lands — lets the run view show screenshots while running. */
  onArtifact?: (artifact: RunArtifact) => void;
  /** Pause for `wait` nodes. Injected so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** User-defined node types, by id — how a `custom` node knows what to run. */
  customNodeTypes?: Record<string, CustomNodeType>;
  /** A param a node computed. The caller persists it so the value survives a
   * pause: a run that stops to ask a question and comes back must still know
   * what it worked out before it stopped. */
  onParam?: (name: string, value: string | number | boolean | null) => void;
};

/** A node's branch outcome, used to pick the next edge. */
type Outcome = "success" | "failure" | "paused";

/** Read a response once, as JSON when it parses, otherwise as text. Capped so a
 * huge download cannot end up in the run record. */
async function readResponseBody(res: Response): Promise<ExprValue> {
  try {
    const text = (await res.text()).slice(0, 100_000);
    try {
      return JSON.parse(text) as ExprValue;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

export type RunWorkflowInput = {
  workflow: Workflow;
  secrets: Secret[];
  params: WorkflowParam[];
  runId: string;
  /** Start traversal at this node instead of the start node — checkpoint retry
   * (re-run from the failed step) and resuming past a completed takeover. */
  startNodeId?: string;
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

function decisionOutcome(result: AgentRunResult): Outcome {
  const raw =
    typeof result.structuredOutput === "object" && result.structuredOutput
      ? ((result.structuredOutput as Record<string, unknown>).outcome ??
          (result.structuredOutput as Record<string, unknown>).decision ??
          (result.structuredOutput as Record<string, unknown>).result)
      : result.structuredOutput;
  const decision = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (decision === "success") return "success";
  if (decision === "failure") return "failure";

  const text = `${typeof raw === "string" ? raw : JSON.stringify(raw ?? "")}\n${result.stdout}`.toLowerCase();
  if (/\b(failure|fail|no|false|blocked|not ready)\b/.test(text)) return "failure";
  if (/\b(success|succeed|yes|true|pass|ready)\b/.test(text)) return "success";
  return "failure";
}

export async function runWorkflow(
  input: RunWorkflowInput,
  deps: OrchestratorDeps,
): Promise<WorkflowRun> {
  const { workflow, secrets, params, runId } = input;
  const events: RunEvent[] = [];
  let seq = 0;
  const emit = (level: RunEvent["level"], message: string) => {
    const event: RunEvent = {
      id: `evt_${runId}_${seq++}`,
      level,
      timestamp: deps.now(),
      message: redactSecrets(message, secrets),
    };
    events.push(event);
    deps.onEvent?.(event, seq - 1);
  };

  // computer_use + browser + scripted-desktop tasks all run on the VM's :0 desktop.
  const runsOnVm = (t: WorkflowNode["type"]) =>
    t === "computer_use_task" || t === "browser_task" || t === "script_task";
  const needsVm = workflow.nodes.some((n) => runsOnVm(n.type));
  const startedAt = deps.now();

  // Acquire a VM only when a node needs one. CLI-agent / shell-only workflows
  // run entirely on the controller.
  let acquired: Awaited<ReturnType<typeof deps.daemon.acquire>> | undefined;
  if (needsVm) {
    const requiredLabels =
      workflow.nodes.find((n) => runsOnVm(n.type))?.config.requiredLabels ?? [];
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
  // Resolve {{secret.x}}/{{param.x}} in a node prompt. Values reach the guest so
  // the agent can type them; events are still secret-redacted before persistence.
  // What every rule and template can see. `steps` accumulates each node's output
  // as it runs, so a later node can branch on what an earlier one produced.
  const stepOutputs: Record<string, ExprValue> = {};
  const runContext = (): ExprContext => ({
    params: paramMap as unknown as ExprValue,
    steps: stepOutputs as unknown as ExprValue,
    run: { id: runId, workflow: workflow.name, startedAt } as unknown as ExprValue,
  });
  const fillPrompt = (text: string, fields?: Record<string, string>) =>
    resolveTemplate(text, {
      secrets: secretMap,
      params: paramMap,
      fields,
      context: runContext(),
    });
  /** Record what a node produced, for `steps["Name"]` in later expressions. */
  const setOutput = (node: WorkflowNode, output: ExprValue) => {
    stepOutputs[node.name] = output;
  };
  const artifacts: RunArtifact[] = [];
  let pastWork = "";
  let finalStatus: RunStatus = "succeeded";
  // Why the run paused (human_takeover prompt / guest needs_human reason) — shown
  // to the operator, so it is secret-redacted like events.
  let pausedReason: string | undefined;
  // The resolved question, handed to whoever opens the takeover.
  let pausedAsk: import("./human-ask").HumanAsk | undefined;

  const addArtifact = (artifact: RunArtifact) => {
    artifacts.push(artifact);
    deps.onArtifact?.(artifact);
  };
  const collectArtifacts = (nodeId: string, paths: string[]) => {
    for (const path of paths) {
      emit("info", `Artifact: ${path}.`);
      addArtifact({ id: `art_${runId}_${artifacts.length}`, runId, nodeId, type: "file", path, createdAt: deps.now() });
    }
  };

  // The most recent executable task node — retry_wait re-runs it.
  let lastTaskNode: WorkflowNode | undefined;
  // Which labelled branch the last switch picked, for `case:<label>` edges.
  let switchChoice: string | undefined;

  // Execute one node, returning a branch outcome. Emits events + collects
  // artifacts as side effects.
  const runNode = async (node: WorkflowNode): Promise<Outcome> => {
    if (node.type === "computer_use_task" || node.type === "cli_agent_task" || node.type === "shell_task") {
      lastTaskNode = node;
    }
    switch (node.type) {
      case "start":
      case "end":
      case "artifact":
        return "success";
      case "retry_wait": {
        if (!lastTaskNode) {
          emit("info", `Node "${node.name}": nothing to retry.`);
          return "success";
        }
        const max = node.config.maxAttempts ?? 2;
        for (let attempt = 1; attempt <= max; attempt++) {
          emit("info", `Node "${node.name}": retry ${attempt}/${max} of "${lastTaskNode.name}".`);
          const out = await runNode(lastTaskNode);
          if (out === "paused") return "paused";
          if (out === "success") return "success";
        }
        emit("warn", `Node "${node.name}": retries exhausted.`);
        return "failure";
      }
      case "api_call": {
        if (!deps.httpFetch) {
          emit("error", `Node "${node.name}": HTTP not enabled.`);
          return "failure";
        }
        let spec: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown };
        try {
          spec = JSON.parse(fillPrompt(node.config.prompt ?? "{}"));
        } catch {
          emit("error", `Node "${node.name}": invalid api_call spec (needs JSON {url,method,...}).`);
          return "failure";
        }
        if (!spec.url) {
          emit("error", `Node "${node.name}": api_call needs a url.`);
          return "failure";
        }
        try {
          const res = await deps.httpFetch(spec.url, {
            method: spec.method ?? "GET",
            headers: spec.headers,
            body: spec.body != null ? JSON.stringify(spec.body) : undefined,
          });
          emit(res.ok ? "info" : "warn", `API ${spec.method ?? "GET"} ${spec.url} -> ${res.status}.`);
          pastWork += `\n${node.name}: HTTP ${res.status}`;
          setOutput(node, {
            status: res.status,
            ok: res.ok,
            body: await readResponseBody(res),
          });
          return res.ok ? "success" : "failure";
        } catch (e) {
          emit("error", `Node "${node.name}" api_call error: ${String(e)}`);
          return "failure";
        }
      }
      case "otp_email": {
        if (!deps.emailOtp) {
          emit("error", `Node "${node.name}": email OTP not enabled.`);
          return "failure";
        }
        let cfg: import("./otp-email").EmailOtpConfig;
        try {
          cfg = JSON.parse(fillPrompt(node.config.prompt ?? "{}"));
        } catch {
          emit("error", `Node "${node.name}": invalid otp_email config JSON.`);
          return "failure";
        }
        try {
          const code = await deps.emailOtp(cfg);
          if (!code) {
            emit("warn", `Node "${node.name}": no OTP found in mailbox.`);
            return "failure";
          }
          const param = cfg.param ?? "otp";
          paramMap[param] = code; // available to later nodes as {{param.<name>}}
          emit("info", `Node "${node.name}": fetched OTP into param "${param}".`); // value redacted
          return "success";
        } catch (e) {
          emit("error", `Node "${node.name}" email OTP error: ${String(e)}`);
          return "failure";
        }
      }
      case "human_takeover": {
        emit("warn", `Node "${node.name}": paused for human takeover.`);
        // The question the node actually asks wins over the legacy prompt: a
        // node authored with config.ask alone must not pause with boilerplate.
        // Templates in it are resolved here — the person answering should read
        // "Approve $2,480", not "Approve {{param.amount}}".
        const resolve = (text: string | undefined) =>
          text ? redactSecrets(fillPrompt(text), secrets) : text;
        const ask = node.config.ask;
        if (ask) {
          pausedAsk = {
            ...ask,
            question: resolve(ask.question) ?? ask.question,
            detail: resolve(ask.detail),
            fields: ask.fields?.map((f) => ({
              ...f,
              label: resolve(f.label) ?? f.label,
              placeholder: resolve(f.placeholder),
            })),
            options: ask.options?.map((o) => ({ ...o, label: resolve(o.label) ?? o.label })),
          };
        }
        pausedReason =
          pausedAsk?.question?.trim() ||
          redactSecrets(node.config.prompt || `Human takeover requested at "${node.name}".`, secrets);
        return "paused";
      }
      case "condition": {
        // A written rule beats asking a model: deterministic, free, and it can
        // read what earlier steps produced.
        if (node.config.expr?.trim()) {
          const { value, error } = evalRule(node.config.expr, runContext());
          if (error) emit("warn", `Condition "${node.name}": ${error} — treated as false.`);
          emit("info", `Condition "${node.name}" -> ${value ? "success" : "failure"}.`);
          setOutput(node, value);
          pastWork += `\n${node.name}: ${value}`;
          return value ? "success" : "failure";
        }
        if (node.config.provider) {
          if (!deps.agentExec) {
            emit("error", `Condition "${node.name}": no CLI-agent executor configured.`);
            return "failure";
          }
          const prompt = [
            "Decide whether this workflow should follow the success or failure edge.",
            'Return ONLY JSON: {"outcome":"success"|"failure","reason":"..."}',
            "",
            `Decision question: ${fillPrompt(node.config.prompt ?? node.name)}`,
            "",
            `Prior workflow context:\n${pastWork || "(none)"}`,
          ].join("\n");
          try {
            const result = await runCliAgent(
              {
                provider: node.config.provider,
                prompt,
                secrets: secretMap,
                allowApiFallback: false,
              },
              deps.agentExec,
              secrets,
            );
            if (result.status !== "succeeded") {
              emit("error", `Condition "${node.name}" agent execution failed.`);
              return "failure";
            }
            const out = decisionOutcome(result);
            emit("info", `Condition "${node.name}" model decision -> ${out}.`);
            pastWork += `\n${node.name}: ${out}`;
            return out;
          } catch (e) {
            emit("error", `Condition "${node.name}" agent error: ${String(e)}`);
            return "failure";
          }
        }
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
        const res = await deps.shellExec(fillPrompt(node.config.prompt ?? ""), { env });
        emit(res.code === 0 ? "info" : "warn", `Shell "${node.name}" exited ${res.code}.`);
        pastWork += `\n${node.name}: exit ${res.code}`;
        setOutput(node, { code: res.code, stdout: res.stdout, stderr: res.stderr });
        return res.code === 0 ? "success" : "failure";
      }
      case "browser_task":
      case "script_task":
      case "computer_use_task": {
        if (!vm) {
          emit("error", `Node "${node.name}": no VM available.`);
          return "failure";
        }
        // All three drive the guest :0 desktop via the same transport; only the
        // runner differs: LLM agent (cli.py) / Playwright / scripted pyautogui.
        const runnerByType: Partial<Record<WorkflowNode["type"], string>> = {
          browser_task: "/opt/agent/agent-runner/browser_runner.py",
          script_task: "/opt/agent/agent-runner/desktop_runner.py",
        };
        const kind =
          node.type === "browser_task" ? "browser" : node.type === "script_task" ? "script" : "computer-use";
        emit("info", `Running ${kind} node "${node.name}" on ${vm.name}.`);
        const baseConn = vm.ssh ?? { host: vm.xrdp.host, port: 22, username: vm.xrdp.username };
        let syncedRunnerDir: string | undefined;
        if (deps.syncGuestRunner) {
          try {
            syncedRunnerDir = await deps.syncGuestRunner({
              ...baseConn,
              identityFile: deps.sshIdentityFile,
            });
          } catch (e) {
            emit("warn", `Runner sync failed for "${node.name}": ${String(e)}.`);
          }
        }
        const runnerPath = syncedRunnerDir
          ? `${syncedRunnerDir}/${node.type === "browser_task" ? "browser_runner.py" : node.type === "script_task" ? "desktop_runner.py" : "cli.py"}`
          : runnerByType[node.type];
        const guestConn = {
          ...baseConn,
          identityFile: deps.sshIdentityFile,
          ...(runnerPath ? { runnerPath } : {}),
        };
        let report: GuestReport;
        try {
          report = await runComputerUseTask(
            guestConn,
            {
              instruction: fillPrompt(node.config.prompt ?? node.name),
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
            for (const f of fetched) {
              addArtifact(f);
              emit("info", `Artifact: ${f.path}.`);
            }
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
        if (reportToStatus(report.status) === "paused") {
          pausedReason = redactSecrets(
            report.reason || `Guest requested human help at "${node.name}".`,
            secrets,
          );
          return "paused";
        }
        return "failure";
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
              prompt: fillPrompt(pastWork ? `${node.config.prompt ?? node.name}\n\nContext:\n${pastWork}` : node.config.prompt ?? node.name),
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
      case "switch": {
        const cases = node.config.cases ?? [];
        for (const branch of cases) {
          const { value, error } = evalRule(branch.expr, runContext());
          if (error) emit("warn", `Switch "${node.name}" case "${branch.label}": ${error}.`);
          if (value) {
            emit("info", `Switch "${node.name}" -> "${branch.label}".`);
            setOutput(node, branch.label);
            pastWork += `\n${node.name}: ${branch.label}`;
            switchChoice = branch.label;
            return "success";
          }
        }
        emit("info", `Switch "${node.name}": no case matched.`);
        setOutput(node, null);
        switchChoice = undefined;
        return "failure";
      }
      case "wait": {
        const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
        const until = node.config.untilExpr?.trim();
        const step = Math.max(250, Math.min(node.config.waitMs ?? 1000, 30_000));
        if (!until) {
          const ms = Math.max(0, node.config.waitMs ?? 0);
          emit("info", `Waiting ${Math.round(ms / 1000)}s at "${node.name}".`);
          await sleep(ms);
          setOutput(node, { waitedMs: ms });
          return "success";
        }
        // "Wait until X" is only meaningful if something can change while we
        // wait, so the node re-runs a probe each interval and the rule reads the
        // probe's latest result: poll the export endpoint until it says ready.
        const probeSpec = node.config.prompt?.trim();
        const budget = node.config.timeoutMs ?? 300_000;
        let waited = 0;

        const probe = async (): Promise<void> => {
          if (!probeSpec) return;
          if (!deps.httpFetch) {
            emit("error", `Wait "${node.name}": HTTP not enabled, cannot poll.`);
            return;
          }
          try {
            const spec = JSON.parse(fillPrompt(probeSpec)) as {
              url?: string;
              method?: string;
              headers?: Record<string, string>;
              body?: unknown;
            };
            if (!spec.url) return;
            const res = await deps.httpFetch(spec.url, {
              method: spec.method ?? "GET",
              headers: spec.headers,
              body: spec.body != null ? JSON.stringify(spec.body) : undefined,
            });
            setOutput(node, { status: res.status, ok: res.ok, body: await readResponseBody(res) });
          } catch (e) {
            emit("warn", `Wait "${node.name}": probe failed — ${String(e)}`);
          }
        };

        for (;;) {
          await probe();
          const { value, error } = evalRule(until, runContext());
          if (error) emit("warn", `Wait "${node.name}": ${error} — treated as not yet true.`);
          if (value) {
            emit("info", `Wait "${node.name}": condition met after ${Math.round(waited / 1000)}s.`);
            return "success";
          }
          if (waited >= budget) {
            emit("warn", `Wait "${node.name}": timed out after ${Math.round(waited / 1000)}s.`);
            return "failure";
          }
          if (!probeSpec) {
            // Nothing to re-check: the answer can never change, so spinning for
            // the full timeout would just burn the run's clock.
            emit(
              "warn",
              `Wait "${node.name}": the condition is false and there is nothing to poll — add a probe request to re-check it.`,
            );
            return "failure";
          }
          await sleep(step);
          waited += step;
        }
      }
      case "set_params": {
        const assign = node.config.assign ?? {};
        const written: string[] = [];
        for (const [name, source] of Object.entries(assign)) {
          try {
            const value = evalExpr(source, runContext());
            const stored = value === null || typeof value === "object" ? JSON.stringify(value) : value;
            paramMap[name] = stored;
            // Expressions cannot read secrets, so a computed param is safe to
            // persist in the clear — unlike an answer marked secret, which goes
            // to the encrypted store instead.
            deps.onParam?.(name, stored);
            written.push(name);
          } catch (e) {
            emit("warn", `Set "${node.name}": ${name} — ${String(e)}`);
          }
        }
        emit("info", `Set "${node.name}": ${written.length ? written.join(", ") : "nothing to set"}.`);
        setOutput(node, Object.fromEntries(written.map((n) => [n, paramMap[n] as ExprValue])));
        return written.length === Object.keys(assign).length ? "success" : "failure";
      }
      case "custom":
        return runCustomNode(node);
      default:
        return "success";
    }
  };

  /** A user-defined node type: template its inputs, then run it on whichever
   * primitive it was built from. */
  const runCustomNode = async (node: WorkflowNode): Promise<Outcome> => {
    const type = deps.customNodeTypes?.[node.config.customTypeId ?? ""];
    if (!type) {
      emit("error", `Node "${node.name}": unknown node type "${node.config.customTypeId}".`);
      return "failure";
    }
    // Field values are themselves templates — someone writing "Total {{= steps.Fetch.body.total }}"
    // into a message box means it, so resolve those before rendering the type's
    // own template with them.
    const fields = Object.fromEntries(
      Object.entries(resolveFields(type, node.config.fields)).map(([name, value]) => [
        name,
        fillPrompt(value),
      ]),
    );
    const missing = missingRequiredFields(type, fields);
    if (missing.length) {
      emit("error", `Node "${node.name}": missing ${missing.join(", ")}.`);
      return "failure";
    }
    const rendered = fillPrompt(type.template, fields);

    const settle = (outcome: Outcome): Outcome => {
      const override = evaluateSuccessExpr(type, runContext());
      if (override === undefined || outcome === "paused") return outcome;
      return override ? "success" : "failure";
    };

    if (type.base === "expression") {
      try {
        const value = evalExpr(rendered, runContext()) as ExprValue;
        setOutput(node, value);
        emit("info", `Node "${node.name}" (${type.name}) computed a value.`);
        return settle(value === null || value === false ? "failure" : "success");
      } catch (e) {
        emit("error", `Node "${node.name}" (${type.name}): ${String(e)}`);
        return "failure";
      }
    }

    if (type.base === "shell") {
      if (!deps.shellExec) {
        emit("error", `Node "${node.name}" (${type.name}): shell execution not enabled.`);
        return "failure";
      }
      const res = await deps.shellExec(rendered, { env });
      emit(res.code === 0 ? "info" : "warn", `Node "${node.name}" (${type.name}) exited ${res.code}.`);
      setOutput(node, { code: res.code, stdout: res.stdout, stderr: res.stderr });
      return settle(res.code === 0 ? "success" : "failure");
    }

    if (!deps.httpFetch) {
      emit("error", `Node "${node.name}" (${type.name}): HTTP not enabled.`);
      return "failure";
    }
    let spec: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown };
    try {
      spec = JSON.parse(rendered);
    } catch {
      emit("error", `Node "${node.name}" (${type.name}): template did not render valid JSON.`);
      return "failure";
    }
    if (!spec.url) {
      emit("error", `Node "${node.name}" (${type.name}): no url.`);
      return "failure";
    }
    try {
      const res = await deps.httpFetch(spec.url, {
        method: spec.method ?? "GET",
        headers: spec.headers,
        body: spec.body != null ? JSON.stringify(spec.body) : undefined,
      });
      emit(res.ok ? "info" : "warn", `Node "${node.name}" (${type.name}) -> ${res.status}.`);
      setOutput(node, { status: res.status, ok: res.ok, body: await readResponseBody(res) });
      return settle(res.ok ? "success" : "failure");
    } catch (e) {
      emit("error", `Node "${node.name}" (${type.name}) error: ${String(e)}`);
      return "failure";
    }
  };

  // Outcome-driven traversal: follow the edge matching each node's outcome
  // (success / failure), or an 'always' edge. Supports failure branches, pause,
  // and recovery paths — not just a linear happy path.
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const resumeNode = input.startNodeId ? byId.get(input.startNodeId) : undefined;
  let current: WorkflowNode | undefined =
    resumeNode ?? workflow.nodes.find((n) => n.type === "start") ?? workflow.nodes[0];
  if (resumeNode) emit("info", `Resuming from "${resumeNode.name}".`);
  const maxSteps = workflow.nodes.length * 4 + 10;
  let steps = 0;
  let currentStep: string | undefined;
  try {
    while (current && steps++ < maxSteps) {
      const node = current;
      currentStep = node.name;
      deps.onProgress?.(node.id, node.name);
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
        (node.type === "switch" && switchChoice
          ? outEdges.find((e) => e.condition === `case:${switchChoice}`)
          : undefined) ??
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
    currentStep,
    pausedReason: finalStatus === "paused" ? pausedReason : undefined,
    pausedAsk: finalStatus === "paused" ? pausedAsk : undefined,
  };
}
