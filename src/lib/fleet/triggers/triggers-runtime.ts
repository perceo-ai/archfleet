// Trigger firing logic, decoupled from HTTP + the real orchestrator via an
// injected `execute`. Unit tested with a fake executor; the API routes pass the
// real `executeManualRun`.

import type { Db } from "../db/db";
import type { Trigger, WorkflowRun } from "../types";
import { dueScheduleTriggers, findByWebhookToken, updateNextRun } from "./triggers-repo";
import { nextRun } from "./cron";

export type TriggerExecute = (
  trigger: Trigger,
  payload?: Record<string, unknown>,
) => Promise<WorkflowRun>;

export type FiredTrigger = { triggerId: string; runId: string; status: string };

/**
 * Fire every schedule trigger due at/before `nowIso`, then advance its next_run_at.
 * Returns what fired. `execute` runs (and persists) the workflow.
 */
export async function runDueTriggers(
  db: Db,
  nowIso: string,
  execute: TriggerExecute,
): Promise<FiredTrigger[]> {
  const due = dueScheduleTriggers(db, nowIso);
  const fired: FiredTrigger[] = [];
  for (const trigger of due) {
    const run = await execute(trigger);
    fired.push({ triggerId: trigger.id, runId: run.id, status: run.status });
    const next = trigger.cron ? nextRun(trigger.cron, new Date(nowIso)) : null;
    updateNextRun(db, trigger.id, next);
  }
  return fired;
}

/** Validate a webhook token and fire its trigger. Null when no enabled match. */
export async function runWebhook(
  db: Db,
  token: string,
  execute: TriggerExecute,
  payload?: Record<string, unknown>,
): Promise<WorkflowRun | null> {
  const trigger = findByWebhookToken(db, token);
  if (!trigger) return null;
  return execute(trigger, payload);
}
