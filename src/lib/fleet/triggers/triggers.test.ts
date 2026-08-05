import { describe, expect, it, vi } from "vitest";
import { openDb } from "../db/db";
import type { Trigger, WorkflowRun } from "../types";
import {
  createTrigger,
  dueScheduleTriggers,
  findByWebhookToken,
  listTriggers,
} from "./triggers-repo";
import { runDueTriggers, runWebhook } from "./triggers-runtime";

const T0 = "2026-08-04T10:15:00.000Z";

function fakeRun(triggerId: string): WorkflowRun {
  return {
    id: `run_${triggerId}`,
    workflowId: "wf1",
    workflowName: "WF",
    status: "queued",
    startedAt: T0,
    events: [],
  };
}
const fakeExecute = (t: Trigger) => Promise.resolve(fakeRun(t.id));

describe("triggers repo", () => {
  it("creates a schedule trigger and computes next_run_at", () => {
    const db = openDb(":memory:");
    const { trigger } = createTrigger(db, {
      workflowId: "wf1",
      type: "schedule",
      cron: "0 9 * * *",
      now: T0,
    });
    expect(trigger.type).toBe("schedule");
    expect(trigger.nextRunAt).toBe("2026-08-05T09:00:00.000Z"); // 09:00 already passed today
    db.close();
  });

  it("schedule trigger requires cron", () => {
    const db = openDb(":memory:");
    expect(() => createTrigger(db, { workflowId: "wf1", type: "schedule" })).toThrow(/requires a cron/);
    db.close();
  });

  it("webhook trigger returns a one-time token, matched only by its hash", () => {
    const db = openDb(":memory:");
    const { trigger, webhookToken } = createTrigger(db, { workflowId: "wf1", type: "webhook" });
    expect(webhookToken).toBeTypeOf("string");
    expect(findByWebhookToken(db, webhookToken!)?.id).toBe(trigger.id);
    expect(findByWebhookToken(db, "wrong-token")).toBeUndefined();
    db.close();
  });

  it("lists triggers for a workflow", () => {
    const db = openDb(":memory:");
    createTrigger(db, { workflowId: "wf1", type: "manual" });
    createTrigger(db, { workflowId: "wf2", type: "manual" });
    expect(listTriggers(db, "wf1")).toHaveLength(1);
    db.close();
  });
});

describe("runDueTriggers", () => {
  it("fires only due schedule triggers and advances next_run_at", async () => {
    const db = openDb(":memory:");
    createTrigger(db, { workflowId: "wf1", type: "schedule", cron: "* * * * *", now: T0 });
    // nothing due one second before the first fire
    expect(dueScheduleTriggers(db, T0)).toHaveLength(0);

    const later = "2026-08-04T10:17:00.000Z";
    const fired = await runDueTriggers(db, later, fakeExecute);
    expect(fired).toHaveLength(1);
    expect(fired[0].runId).toMatch(/^run_trg_/);

    // next_run_at advanced past `later`
    const after = dueScheduleTriggers(db, later);
    expect(after).toHaveLength(0);
    db.close();
  });

  it("does not fire disabled or webhook triggers on tick", async () => {
    const db = openDb(":memory:");
    createTrigger(db, { workflowId: "wf1", type: "webhook" });
    const fired = await runDueTriggers(db, "2027-01-01T00:00:00.000Z", fakeExecute);
    expect(fired).toHaveLength(0);
    db.close();
  });
});

describe("runWebhook", () => {
  it("fires on a valid token, no-op on invalid", async () => {
    const db = openDb(":memory:");
    const exec = vi.fn(fakeExecute);
    const { webhookToken } = createTrigger(db, { workflowId: "wf1", type: "webhook" });
    const run = await runWebhook(db, webhookToken!, exec);
    expect(run?.status).toBe("queued");
    expect(await runWebhook(db, "nope", exec)).toBeNull();
    expect(exec).toHaveBeenCalledTimes(1);
    db.close();
  });
});
