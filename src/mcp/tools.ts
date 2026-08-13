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
import { listEvidenceByAutomation, listEvidenceByRun } from "../lib/fleet/db/evidence-repo";
import { getTakeover, listTakeovers, resolveTakeover } from "../lib/fleet/db/takeovers-repo";
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
    description: "List recent runs (newest first).",
    shape: { limit: z.number().optional() },
    run: (db, a) => listRuns(db, (a.limit as number) ?? 50),
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
      const automation = a.automation as Automation;
      if (!automation?.id || !automation.name || !automation.workflowId) {
        return { ok: false, errors: ["automation needs id, name and workflowId"] };
      }
      saveAutomation(db, {
        successCriteria: [],
        requiredSecrets: [],
        riskNotes: [],
        goal: "",
        category: "general",
        target: "",
        specMarkdown: "",
        artifactPolicy: "",
        retryPolicy: "",
        takeoverPolicy: "",
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...automation,
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
    description: "Enqueue a run of an automation (linked to its environment + run history). Returns the queued run.",
    shape: { id: z.string(), params: z.record(z.string(), z.unknown()).optional() },
    run: (db, a) => {
      const automation = getAutomation(db, a.id as string);
      if (!automation) return { error: "not found" };
      return enqueueManualRun(automation.workflowId, {
        db,
        params: a.params as Record<string, string | number | boolean | null> | undefined,
        automationId: automation.id,
        environmentId: automation.environmentId,
        triggerSource: "api",
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
    description: "List evidence (screenshots, files, logs, criteria reviews) for a run or an automation.",
    shape: {
      runId: z.string().optional(),
      automationId: z.string().optional(),
      type: z.enum(["screenshot", "file", "log", "criteria_review"]).optional(),
    },
    run: (db, a) => {
      const type = a.type as EvidenceType | undefined;
      if (a.runId) return listEvidenceByRun(db, a.runId as string, { type });
      if (a.automationId) return listEvidenceByAutomation(db, a.automationId as string, { type });
      return { error: "runId or automationId is required" };
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
    description: "Mark a takeover resolved with optional operator notes. Optionally resume (re-queue) or cancel the paused run.",
    shape: {
      id: z.string(),
      operatorNotes: z.string().optional(),
      action: z.enum(["resume", "cancel"]).optional(),
    },
    run: (db, a) => {
      const ok = resolveTakeover(db, a.id as string, { operatorNotes: a.operatorNotes as string | undefined });
      if (!ok) return { ok: false, error: "takeover not found or already resolved" };
      const takeover = getTakeover(db, a.id as string);
      if (takeover && a.action === "resume") retryRun(db, takeover.runId);
      else if (takeover && a.action === "cancel") cancelRun(db, takeover.runId);
      return { ok: true, takeover };
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
