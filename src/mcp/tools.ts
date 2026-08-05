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
import type { Workflow } from "../lib/fleet/types";

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
