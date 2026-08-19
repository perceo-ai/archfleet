// Fleet MCP tools — one registry, reused by the stdio server and the tests. Each
// tool has a zod input shape and a handler that operates on an injected Db, so the
// handlers are unit tested without any MCP transport.

import { z } from "zod";
import type { Db } from "../lib/fleet/db/db";
import { listRuns, getRun, retryRun, cancelRun } from "../lib/fleet/db/runs-repo";
import { listWorkflows, getWorkflow, saveWorkflow } from "../lib/fleet/db/workflows-repo";
import { validateWorkflow } from "../lib/fleet/workflow-validation";
import { listVms } from "../lib/fleet/db/vms-repo";
import { listSecretMeta, saveSecret } from "../lib/fleet/db/secrets-repo";
import { deleteNodeType, listNodeTypes, saveNodeType } from "../lib/fleet/db/node-types-repo";
import { validateNodeType, type CustomNodeType } from "../lib/fleet/node-types";
import { checkExpr, evalExpr, type ExprContext } from "../lib/fleet/expr";
import { createTrigger, listTriggers } from "../lib/fleet/triggers/triggers-repo";
import { enqueueManualRun, processPendingRuns } from "../lib/fleet/server-runtime";
import { realVmsFromEnv } from "../lib/fleet/vm-daemon/fleet-config";
import {
  automationHealth,
  getAutomation,
  listAutomations,
  saveAutomation,
} from "../lib/fleet/db/automations-repo";
import { listEnvironments } from "../lib/fleet/db/environments-repo";
import {
  listEvidenceByAutomation,
  listEvidenceByRun,
  listEvidenceByRunAssociation,
} from "../lib/fleet/db/evidence-repo";
import {
  getOpenTakeoverForRun,
  getTakeover,
  listTakeovers,
  openTakeover,
  resolveTakeover,
} from "../lib/fleet/db/takeovers-repo";
import { pauseRunIfActive } from "../lib/fleet/db/runs-repo";
import { resumeRunAfterPause } from "../lib/fleet/run-resume";
import { parseAsk, validateAnswers } from "../lib/fleet/human-ask";
import { applyAskAnswers } from "../lib/fleet/ask-answers";
import type { Automation, AutomationStatus, EvidenceType, TakeoverStatus, Workflow } from "../lib/fleet/types";

export type FleetTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (db: Db, args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export const FLEET_TOOLS: FleetTool[] = [
  {
    name: "list_workflows",
    description: "List all workflows (visual automation graphs).",
    shape: {},
    run: (db) => listWorkflows(db),
  },
  {
    name: "get_workflow",
    description: "Get one workflow graph by id.",
    shape: { id: z.string() },
    run: (db, a) => getWorkflow(db, a.id as string) ?? { error: "not found" },
  },
  {
    name: "upsert_workflow",
    description: "Create or update a workflow graph (nodes + edges). Validated before saving.",
    shape: { workflow: z.record(z.string(), z.unknown()) },
    run: (db, a) => {
      const wf = a.workflow as Workflow;
      const errors = validateWorkflow(wf);
      if (errors.length) return { ok: false, errors };
      saveWorkflow(db, wf);
      return { ok: true, id: wf.id };
    },
  },
  {
    name: "plan_workflow",
    description: "Draft a workflow graph from a plain-language task (agent planner). Returns {workflow, errors}; the draft is disabled until reviewed. Set save=true to persist a valid draft.",
    shape: { task: z.string(), save: z.boolean().optional() },
    run: async (db, a) => {
      const { planWorkflow } = await import("../lib/fleet/planner");
      const { spawnAgentExec } = await import("../lib/fleet/ssh-exec");
      const result = await planWorkflow(a.task as string, spawnAgentExec);
      if (a.save && result.errors.length === 0) saveWorkflow(db, result.workflow);
      return result;
    },
  },
  {
    name: "run_workflow",
    description: "Enqueue a manual run of a workflow, optionally with run-level params. Returns the queued run (a worker executes it).",
    shape: { workflowId: z.string().optional(), params: z.record(z.string(), z.unknown()).optional() },
    run: (db, a) =>
      enqueueManualRun(a.workflowId as string | undefined, {
        db,
        params: a.params as Record<string, string | number | boolean | null> | undefined,
        triggerSource: "api",
      }),
  },
  {
    name: "process_runs",
    description: "Execute queued runs now (drains the queue). Returns how many ran.",
    shape: {},
    run: async (db) => ({ processed: await processPendingRuns(db) }),
  },
  {
    name: "get_run",
    description: "Get a run with its events + artifacts (logs, status, XRDP-takeover state).",
    shape: { id: z.string() },
    run: (db, a) => getRun(db, a.id as string) ?? { error: "not found" },
  },
  {
    name: "list_runs",
    description: "List recent runs (newest first). Filter by PR or branch association.",
    shape: { limit: z.number().optional(), pr: z.string().optional(), branch: z.string().optional() },
    run: (db, a) =>
      listRuns(db, (a.limit as number) ?? 50, {
        prRef: a.pr as string | undefined,
        branchRef: a.branch as string | undefined,
      }),
  },
  {
    name: "retry_run",
    description: "Re-queue a failed / paused (human-takeover) / canceled run for another attempt.",
    shape: { id: z.string() },
    run: (db, a) => ({ ok: retryRun(db, a.id as string) }),
  },
  {
    name: "cancel_run",
    description: "Cancel a queued / running / paused run.",
    shape: { id: z.string() },
    run: (db, a) => ({ ok: cancelRun(db, a.id as string) }),
  },
  {
    name: "list_triggers",
    description: "List triggers (manual / schedule / webhook).",
    shape: { workflowId: z.string().optional() },
    run: (db, a) => listTriggers(db, a.workflowId as string | undefined),
  },
  {
    name: "create_trigger",
    description: "Create a trigger. For webhook, the token is returned ONCE. For schedule, pass a cron.",
    shape: {
      workflowId: z.string(),
      type: z.enum(["manual", "schedule", "webhook"]),
      cron: z.string().optional(),
    },
    run: (db, a) =>
      createTrigger(db, {
        workflowId: a.workflowId as string,
        type: a.type as "manual" | "schedule" | "webhook",
        cron: a.cron as string | undefined,
      }),
  },
  {
    name: "list_secrets",
    description: "List secret names + scopes (never values).",
    shape: {},
    run: (db) => listSecretMeta(db),
  },
  {
    name: "create_secret",
    description: "Create an encrypted secret (requires CUF_SECRET_KEY).",
    shape: {
      name: z.string(),
      scope: z.enum(["global", "workflow", "vm", "run"]),
      value: z.string(),
      scopeId: z.string().optional(),
    },
    run: (db, a) => {
      const id = saveSecret(db, {
        name: a.name as string,
        scope: a.scope as "global" | "workflow" | "vm" | "run",
        value: a.value as string,
        scopeId: a.scopeId as string | undefined,
      });
      return { id, name: a.name };
    },
  },
  {
    name: "list_automations",
    description: "List automations (the user-facing objects: intent + workflow + environment + criteria) with derived health.",
    shape: {
      status: z.enum(["draft", "active", "disabled"]).optional(),
      category: z.string().optional(),
    },
    run: (db, a) =>
      listAutomations(db, {
        status: a.status as AutomationStatus | undefined,
        category: a.category as string | undefined,
      }).map((auto) => ({ ...auto, ...automationHealth(db, auto.id) })),
  },
  {
    name: "get_automation",
    description: "Get one automation with its derived health, last run, and workflow graph.",
    shape: { id: z.string() },
    run: (db, a) => {
      const automation = getAutomation(db, a.id as string);
      if (!automation) return { error: "not found" };
      return {
        automation,
        workflow: getWorkflow(db, automation.workflowId),
        runs: listRuns(db, 10, { automationId: automation.id }),
        ...automationHealth(db, automation.id),
      };
    },
  },
  {
    name: "upsert_automation",
    description: "Create or update an automation. Pass the full Automation object (id, name, workflowId, ...).",
    shape: { automation: z.record(z.string(), z.unknown()) },
    run: (db, a) => {
      const automation = a.automation as Partial<Automation>;
      if (!automation?.id || !automation.name || !automation.workflowId) {
        return { ok: false, errors: ["automation needs id, name and workflowId"] };
      }
      // Same guard as POST /api/automations: an automation pointing at a missing
      // workflow would be accepted here but rejected by every run attempt.
      if (!getWorkflow(db, automation.workflowId)) {
        return {
          ok: false,
          errors: [`workflow ${automation.workflowId} not found — save it first with upsert_workflow`],
        };
      }
      const now = new Date().toISOString();
      saveAutomation(db, {
        id: automation.id,
        name: automation.name,
        workflowId: automation.workflowId,
        goal: automation.goal ?? "",
        category: automation.category ?? "general",
        target: automation.target ?? "",
        specMarkdown: automation.specMarkdown ?? "",
        environmentId: automation.environmentId,
        successCriteria: automation.successCriteria ?? [],
        requiredSecrets: automation.requiredSecrets ?? [],
        mfaExpectation: automation.mfaExpectation,
        artifactPolicy: automation.artifactPolicy ?? "",
        retryPolicy: automation.retryPolicy ?? "",
        takeoverPolicy: automation.takeoverPolicy ?? "",
        triggerSuggestion: automation.triggerSuggestion,
        riskNotes: automation.riskNotes ?? [],
        status: automation.status ?? "draft",
        createdAt: automation.createdAt ?? now,
        updatedAt: now,
      });
      return { ok: true, id: automation.id };
    },
  },
  {
    name: "draft_automation",
    description:
      "Draft a full automation (goal, spec, success criteria, secrets, policies, workflow graph, clarifying questions) from a plain-language description. Set save=true to persist a valid draft (status stays 'draft' until reviewed).",
    shape: { prompt: z.string(), save: z.boolean().optional() },
    run: async (db, a) => {
      const { draftAutomation } = await import("../lib/fleet/automation-draft");
      const { spawnAgentExec } = await import("../lib/fleet/ssh-exec");
      const draft = await draftAutomation(a.prompt as string, spawnAgentExec);
      if (a.save && draft.errors.length === 0) {
        saveWorkflow(db, draft.workflow);
        saveAutomation(db, draft.automation);
      }
      return draft;
    },
  },
  {
    name: "run_automation",
    description:
      "Enqueue a run of an automation (linked to its environment + run history). Pass pr/branch to associate the run's evidence with a change (Archductor / release checks). Returns the queued run.",
    shape: {
      id: z.string(),
      params: z.record(z.string(), z.unknown()).optional(),
      pr: z.string().optional(),
      branch: z.string().optional(),
    },
    run: (db, a) => {
      const automation = getAutomation(db, a.id as string);
      if (!automation) return { error: "not found" };
      try {
        return enqueueManualRun(automation.workflowId, {
          db,
          params: a.params as Record<string, string | number | boolean | null> | undefined,
          automationId: automation.id,
          environmentId: automation.environmentId,
          triggerSource: "api",
          prRef: a.pr as string | undefined,
          branchRef: a.branch as string | undefined,
        });
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    name: "run_semantic_tests",
    description:
      "Enqueue every active semantic_test automation against a PR/branch (the Archductor trigger path). Returns the queued runs; evidence attaches to the PR/branch for pr_evidence_summary.",
    shape: { pr: z.string().optional(), branch: z.string().optional() },
    run: (db, a) => {
      const tests = listAutomations(db, { status: "active", category: "semantic_test" });
      const runs = tests.map((t) => {
        try {
          return enqueueManualRun(t.workflowId, {
            db,
            automationId: t.id,
            environmentId: t.environmentId,
            triggerSource: "api",
            prRef: a.pr as string | undefined,
            branchRef: a.branch as string | undefined,
          });
        } catch (e) {
          return { automationId: t.id, error: e instanceof Error ? e.message : String(e) };
        }
      });
      return { enqueued: runs.length, runs };
    },
  },
  {
    name: "pr_evidence_summary",
    description:
      "Markdown evidence summary (statuses, criteria reviews, automated checks, screenshots) for every run associated with a PR or branch. Set publish=true to post it as a GitHub PR comment (needs CUF_GITHUB_TOKEN).",
    shape: { pr: z.string().optional(), branch: z.string().optional(), publish: z.boolean().optional() },
    run: async (db, a) => {
      const { buildPrEvidenceSummary, publishPrComment } = await import("../lib/fleet/pr-evidence");
      if (!a.pr && !a.branch) return { error: "pr or branch is required" };
      if (a.publish && a.pr) return publishPrComment(db, a.pr as string);
      return buildPrEvidenceSummary(db, {
        prRef: a.pr as string | undefined,
        branchRef: a.branch as string | undefined,
      });
    },
  },
  {
    name: "list_environments",
    description: "List prepared environments (reusable logged-in browser/desktop state backed by fleet profiles).",
    shape: {},
    run: (db) => listEnvironments(db),
  },
  {
    name: "list_evidence",
    description:
      "List evidence (screenshots, files, logs, criteria reviews, automated checks) for a run, an automation, or every run associated with a PR/branch.",
    shape: {
      runId: z.string().optional(),
      automationId: z.string().optional(),
      pr: z.string().optional(),
      branch: z.string().optional(),
      type: z.enum(["screenshot", "file", "log", "criteria_review", "check"]).optional(),
    },
    run: (db, a) => {
      const type = a.type as EvidenceType | undefined;
      if (a.runId) return listEvidenceByRun(db, a.runId as string, { type });
      if (a.automationId) return listEvidenceByAutomation(db, a.automationId as string, { type });
      if (a.pr || a.branch) {
        return listEvidenceByRunAssociation(db, {
          prRef: a.pr as string | undefined,
          branchRef: a.branch as string | undefined,
          type,
        });
      }
      return { error: "runId, automationId, pr or branch is required" };
    },
  },
  {
    name: "list_takeovers",
    description: "List human takeover requests (why a run paused + what the operator should do).",
    shape: { status: z.enum(["open", "resolved"]).optional() },
    run: (db, a) => listTakeovers(db, { status: a.status as TakeoverStatus | undefined }),
  },
  {
    name: "resolve_takeover",
    description:
      "Answer a run's question and resolve the takeover. `answers` is keyed by the ask's field/answer names; values the ask marked secret are stored encrypted. Optionally resume (re-queue) or cancel the paused run.",
    shape: {
      id: z.string(),
      operatorNotes: z.string().optional(),
      action: z.enum(["resume", "cancel"]).optional(),
      answers: z.record(z.string(), z.string()).optional(),
    },
    run: (db, a) => {
      const takeover = getTakeover(db, a.id as string);
      if (!takeover || takeover.status !== "open") {
        return { ok: false, error: "takeover not found or already resolved" };
      }
      // A paused run must be transitioned, not just have its takeover closed.
      if (!a.action && getRun(db, takeover.runId)?.status === "paused") {
        return { ok: false, error: 'run is still paused — pass action: "resume" or "cancel"' };
      }
      const ask = parseAsk(takeover.ask ?? takeover.requestedAction, takeover.reason);
      const answers = (a.answers as Record<string, string> | undefined) ?? {};
      if (a.action !== "cancel") {
        const errors = validateAnswers(ask, answers);
        if (errors.length) return { ok: false, error: errors.join(" ") };
        const landed = applyAskAnswers(db, takeover.runId, ask, answers);
        if (landed.dropped.length) {
          return {
            ok: false,
            error: `cannot store ${landed.dropped.join(", ")} securely — set CUF_SECRET_KEY. The run is still paused.`,
          };
        }
      }
      // Transition the run first — if it already moved on, keep the takeover open.
      // Resuming continues after the step that asked, so the same question is
      // not put again.
      if (a.action === "resume" && !resumeRunAfterPause(db, takeover.runId)) {
        return { ok: false, error: "run not in a state to resume" };
      }
      if (a.action === "cancel" && !cancelRun(db, takeover.runId)) {
        return { ok: false, error: "run not in a state to cancel" };
      }
      resolveTakeover(db, a.id as string, {
        operatorNotes: a.operatorNotes as string | undefined,
        answers: a.action === "cancel" ? undefined : answers,
      });
      return { ok: true, takeover: getTakeover(db, a.id as string) };
    },
  },
  {
    name: "ask_human",
    description:
      "Stop a run and ask a human for something — a value, a choice, an approval, or just a hand. " +
      "The desktop is held where it is, and the answer comes back to the run as {{param.name}} " +
      "(or {{secret.name}} for fields marked secret). Use this instead of guessing or failing.",
    shape: {
      runId: z.string(),
      question: z.string(),
      detail: z.string().optional(),
      kind: z.enum(["input", "choice", "approval", "acknowledge"]).optional(),
      fields: z
        .array(
          z.object({
            name: z.string(),
            label: z.string().optional(),
            type: z.enum(["text", "textarea", "password", "code", "number", "url", "email"]).optional(),
            secret: z.boolean().optional(),
            required: z.boolean().optional(),
          }),
        )
        .optional(),
      options: z.array(z.string()).optional(),
    },
    run: (db, a) => {
      const run = getRun(db, a.runId as string);
      if (!run) return { ok: false, error: "run not found" };
      if (run.status !== "running" && run.status !== "queued" && run.status !== "paused") {
        return { ok: false, error: `run is ${run.status} — only an in-flight run can ask for help` };
      }
      const existing = getOpenTakeoverForRun(db, run.id);
      if (existing) return { ok: true, alreadyOpen: true, takeover: existing };

      const ask = parseAsk(a, `The run needs a human at "${run.currentStep ?? "this step"}".`);
      // Conditional, so a run that settled in the meantime is not resurrected.
      if (run.status !== "paused" && !pauseRunIfActive(db, run.id, ask.question)) {
        return {
          ok: false,
          error: `run finished as ${getRun(db, run.id)?.status ?? "unknown"} before the question could be asked`,
        };
      }
      const now = new Date().toISOString();
      const takeover = {
        id: `tk_${run.id}_${now}`,
        runId: run.id,
        environmentId: run.environmentId,
        vmId: run.vmId,
        reason: `Asked at "${run.currentStep ?? "unknown step"}"`,
        requestedAction: ask.question,
        ask,
        status: "open" as const,
        openedAt: now,
      };
      openTakeover(db, takeover);
      return { ok: true, takeover };
    },
  },
  {
    name: "list_node_types",
    description: "List user-defined node types available to workflows (custom steps).",
    shape: {},
    run: (db) => listNodeTypes(db),
  },
  {
    name: "upsert_node_type",
    description:
      "Create or replace a custom node type. `base` picks what runs it: http (template is JSON with url/method/headers/body), shell (template is a command), or expression (template is an expression). Fields are declared inputs, referenced in the template as {{field.name}}.",
    shape: {
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      icon: z.string().optional(),
      base: z.enum(["http", "shell", "expression"]),
      fields: z
        .array(
          z.object({
            name: z.string(),
            label: z.string().optional(),
            type: z.enum(["text", "textarea", "number", "secret", "select", "boolean"]).optional(),
            required: z.boolean().optional(),
            options: z.array(z.string()).optional(),
            default: z.string().optional(),
          }),
        )
        .optional(),
      template: z.string(),
      successExpr: z.string().optional(),
    },
    run: (db, a) => {
      const candidate = {
        ...a,
        description: (a.description as string) ?? "",
        fields: ((a.fields as CustomNodeType["fields"]) ?? []).map((f) => ({
          ...f,
          label: f.label || f.name,
          type: f.type ?? "text",
        })),
      } as CustomNodeType;
      const errors = validateNodeType(candidate);
      if (errors.length) return { ok: false, errors };
      return { ok: true, nodeType: saveNodeType(db, candidate) };
    },
  },
  {
    name: "delete_node_type",
    description: "Remove a custom node type. Workflows still using it will fail that step.",
    shape: { id: z.string() },
    run: (db, a) => ({ ok: deleteNodeType(db, a.id as string) }),
  },
  {
    name: "eval_expression",
    description:
      "Check or try a workflow expression (the language used by condition/switch/wait/set steps) against a sample context. Use it to verify a rule before saving it into a graph.",
    shape: { expression: z.string(), context: z.record(z.string(), z.unknown()).optional() },
    run: (_db, a) => {
      const problem = checkExpr(a.expression as string);
      if (problem) return { ok: false, error: problem };
      try {
        return { ok: true, value: evalExpr(a.expression as string, (a.context ?? {}) as ExprContext) };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  },
  {
    name: "list_vms",
    description: "List the VM fleet: real domain-bound VMs (env) + the persisted registry.",
    shape: {},
    run: (db) => {
      const real = realVmsFromEnv();
      const realIds = new Set(real.map((v) => v.id));
      return [...real, ...listVms(db).filter((v) => !realIds.has(v.id))];
    },
  },
];
